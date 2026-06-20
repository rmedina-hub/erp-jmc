const express = require('express');
const db = require('./db');
const { auth } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth);

function bodegaFija(req) { return req.user && req.user.rol === 'bodeguero' ? (req.user.bodega_id || 0) : null; }

router.get('/', (req, res) => {
  let sql = `SELECT e.*, (c.nombre || ' ' || COALESCE(c.apellido,'')) AS colaborador, c.rut AS colab_rut,
    b.nombre AS bodega, p.sku, p.nombre AS producto
    FROM entregas e LEFT JOIN colaboradores c ON c.id=e.colaborador_id
    LEFT JOIN bodegas b ON b.id=e.bodega_id LEFT JOIN productos p ON p.id=e.producto_id
    WHERE e.empresa=?`;
  const pr = [req.empresa];
  const bf = bodegaFija(req);
  if (bf) { sql += ' AND e.bodega_id=?'; pr.push(bf); }
  else if (req.query.bodega_id) { sql += ' AND e.bodega_id=?'; pr.push(req.query.bodega_id); }
  if (req.query.colaborador_id) { sql += ' AND e.colaborador_id=?'; pr.push(req.query.colaborador_id); }
  if (req.query.tipo) { sql += ' AND e.tipo=?'; pr.push(String(req.query.tipo).toUpperCase()); }
  if (req.query.estado) { sql += ' AND e.estado=?'; pr.push(String(req.query.estado).toUpperCase()); }
  sql += ' ORDER BY e.fecha_entrega DESC, e.id DESC LIMIT 1000';
  res.json(db.prepare(sql).all(...pr));
});

// Resumen: material entregado por colaborador
router.get('/resumen-colaborador', (req, res) => {
  const bf = bodegaFija(req);
  let sql = `SELECT e.colaborador_id, (c.nombre || ' ' || COALESCE(c.apellido,'')) AS colaborador,
    COUNT(*) entregas, COALESCE(SUM(e.cantidad),0) total_cantidad
    FROM entregas e LEFT JOIN colaboradores c ON c.id=e.colaborador_id
    WHERE e.empresa=? AND e.tipo='MATERIAL'`;
  const pr = [req.empresa];
  if (bf) { sql += ' AND e.bodega_id=?'; pr.push(bf); }
  sql += ' GROUP BY e.colaborador_id ORDER BY total_cantidad DESC';
  res.json(db.prepare(sql).all(...pr));
});

const crearEntrega = db.transaction((data, req) => {
  const empresa = req.empresa;
  let bodegaId = data.bodega_id; const bf = bodegaFija(req); if (bf) bodegaId = bf;
  const tipo = (data.tipo || 'MATERIAL').toUpperCase() === 'HERRAMIENTA' ? 'HERRAMIENTA' : 'MATERIAL';
  const cantidad = Math.abs(Number(data.cantidad)) || 0;
  const fecha = data.fecha_entrega || new Date().toISOString().slice(0, 10);
  let movId = null, descripcion = data.descripcion || null, productoId = null;
  if (tipo === 'MATERIAL' && data.producto_id) {
    const p = db.prepare('SELECT * FROM productos WHERE id=? AND empresa=?').get(data.producto_id, empresa);
    if (!p) throw new Error('Producto no existe');
    const bod = db.prepare('SELECT id FROM bodegas WHERE id=? AND empresa=?').get(bodegaId, empresa);
    if (!bod) throw new Error('Bodega no existe');
    if (cantidad <= 0) throw new Error('Cantidad invalida');
    if (cantidad > p.stock + 1e-9) throw new Error('Stock insuficiente (disponible: ' + p.stock + ')');
    const pmp = p.costo_promedio; const nuevoStock = p.stock - cantidad; const valor = nuevoStock * pmp;
    db.prepare('UPDATE productos SET stock=? WHERE id=?').run(nuevoStock, p.id);
    const r = db.prepare(`INSERT INTO inv_movimientos
      (fecha,producto_id,bodega_id,tipo,cantidad,costo_unitario,costo_total,saldo_cantidad,saldo_costo_prom,saldo_valor,documento,glosa,usuario_id,empresa)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(fecha, p.id, bodegaId, 'SALIDA', -cantidad, pmp, cantidad * pmp, nuevoStock, pmp, valor, null, 'Entrega a colaborador', req.user.id, empresa);
    movId = r.lastInsertRowid; productoId = p.id; descripcion = descripcion || p.nombre;
  }
  const r = db.prepare(`INSERT INTO entregas
    (empresa,bodega_id,colaborador_id,tipo,producto_id,descripcion,cantidad,fecha_entrega,estado,movimiento_id,glosa,usuario_id)
    VALUES (?,?,?,?,?,?,?,?, 'ENTREGADO', ?,?,?)`)
    .run(empresa, bodegaId, data.colaborador_id || null, tipo, productoId, descripcion, cantidad, fecha, movId, data.glosa || null, req.user.id);
  return r.lastInsertRowid;
});
router.post('/', (req, res) => {
  try {
    const id = crearEntrega(req.body, req);
    audit(req, 'Bodega', 'Entrega ' + ((req.body.tipo || 'MATERIAL').toUpperCase()), (req.body.descripcion || '') + ' x' + (req.body.cantidad || 0));
    res.json(db.prepare('SELECT * FROM entregas WHERE id=?').get(id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/:id/devolver', (req, res) => {
  const bf = bodegaFija(req);
  const e = db.prepare('SELECT * FROM entregas WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!e || (bf && e.bodega_id !== bf)) return res.status(404).json({ error: 'No existe' });
  db.prepare("UPDATE entregas SET estado='DEVUELTO', fecha_devolucion=? WHERE id=?")
    .run(req.body.fecha_devolucion || new Date().toISOString().slice(0, 10), e.id);
  audit(req, 'Bodega', 'Devolucion', (e.descripcion || '') + ' x' + e.cantidad);
  res.json({ ok: true });
});
router.delete('/:id', (req, res) => {
  const bf = bodegaFija(req);
  const e = db.prepare('SELECT * FROM entregas WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!e || (bf && e.bodega_id !== bf)) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM entregas WHERE id=?').run(e.id);
  audit(req, 'Bodega', 'Eliminar entrega', (e.descripcion || ''));
  res.json({ ok: true });
});
module.exports = router;
