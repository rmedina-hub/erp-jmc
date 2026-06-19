const express = require('express');
const db = require('./db');
const { auth } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth);

const r2 = (x) => Math.round((Number(x) || 0));

// Listado: ?tipo=COBRAR|PAGAR  ?estado=PENDIENTE|PAGADA
router.get('/', (req, res) => {
  let sql = 'SELECT * FROM facturas WHERE empresa=?';
  const p = [req.empresa];
  if (req.query.tipo) { sql += ' AND tipo=?'; p.push(String(req.query.tipo).toUpperCase()); }
  if (req.query.estado) { sql += ' AND estado=?'; p.push(String(req.query.estado).toUpperCase()); }
  sql += ' ORDER BY fecha_vencimiento, id';
  const rows = db.prepare(sql).all(...p);
  // resumen
  const resumen = { cobrar_pend: 0, pagar_pend: 0 };
  for (const f of rows) {
    if (f.estado === 'PENDIENTE') {
      if (f.tipo === 'COBRAR') resumen.cobrar_pend += f.monto;
      else resumen.pagar_pend += f.monto;
    }
  }
  res.json({ items: rows, resumen });
});

router.post('/', (req, res) => {
  const b = req.body;
  const tipo = (b.tipo || 'COBRAR').toUpperCase() === 'PAGAR' ? 'PAGAR' : 'COBRAR';
  if (!b.fecha_vencimiento || !b.monto) return res.status(400).json({ error: 'fecha de vencimiento y monto requeridos' });
  const r = db.prepare(`INSERT INTO facturas (empresa,tipo,contraparte,rut,numero,glosa,fecha_emision,fecha_vencimiento,monto,estado)
    VALUES (?,?,?,?,?,?,?,?,?,'PENDIENTE')`).run(req.empresa, tipo, b.contraparte || null, b.rut || null, b.numero || null,
    b.glosa || null, b.fecha_emision || null, b.fecha_vencimiento, Math.abs(Number(b.monto)) || 0);
  audit(req, 'Cuentas C/P', tipo === 'COBRAR' ? 'Crear cuenta por cobrar' : 'Crear cuenta por pagar',
    (b.contraparte || '') + ' ' + (b.numero ? 'Fac ' + b.numero + ' ' : '') + r2(b.monto));
  res.json(db.prepare('SELECT * FROM facturas WHERE id=?').get(r.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const b = req.body;
  const f = db.prepare('SELECT * FROM facturas WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!f) return res.status(404).json({ error: 'No existe' });
  db.prepare(`UPDATE facturas SET contraparte=?, rut=?, numero=?, glosa=?, fecha_emision=?, fecha_vencimiento=?, monto=?, tipo=? WHERE id=? AND empresa=?`)
    .run(b.contraparte != null ? b.contraparte : f.contraparte, b.rut != null ? b.rut : f.rut,
      b.numero != null ? b.numero : f.numero, b.glosa != null ? b.glosa : f.glosa,
      b.fecha_emision != null ? b.fecha_emision : f.fecha_emision,
      b.fecha_vencimiento || f.fecha_vencimiento, b.monto != null ? Math.abs(Number(b.monto)) : f.monto,
      b.tipo ? b.tipo.toUpperCase() : f.tipo, req.params.id, req.empresa);
  audit(req, 'Cuentas C/P', 'Editar factura', (b.contraparte != null ? b.contraparte : f.contraparte) || '');
  res.json(db.prepare('SELECT * FROM facturas WHERE id=?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM facturas WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!f) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM facturas WHERE id=? AND empresa=?').run(req.params.id, req.empresa);
  audit(req, 'Cuentas C/P', 'Eliminar factura', (f.contraparte || '') + ' ' + (f.numero || ''));
  res.json({ ok: true });
});

// Marcar pagada/cobrada. Si se indica cuenta_id, genera el movimiento en tesoreria.
router.post('/:id/pagar', (req, res) => {
  const f = db.prepare('SELECT * FROM facturas WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!f) return res.status(404).json({ error: 'No existe' });
  const fecha = req.body.fecha_pago || new Date().toISOString().slice(0, 10);
  let cuentaId = req.body.cuenta_id || null;
  if (cuentaId) {
    const cta = db.prepare('SELECT id FROM cuentas_bancarias WHERE id=? AND empresa=?').get(cuentaId, req.empresa);
    if (!cta) cuentaId = null;
  }
  const tx = db.transaction(() => {
    let movId = null;
    if (cuentaId) {
      const tipoMov = f.tipo === 'COBRAR' ? 'INGRESO' : 'EGRESO';
      const r = db.prepare(`INSERT INTO tes_movimientos (fecha,cuenta_id,tipo,categoria,monto,glosa,usuario_id,empresa)
        VALUES (?,?,?,?,?,?,?,?)`).run(fecha, cuentaId, tipoMov, f.tipo === 'COBRAR' ? 'Cobro cliente' : 'Pago proveedor',
        f.monto, (f.contraparte || '') + (f.numero ? ' Fac ' + f.numero : ''), req.user.id, req.empresa);
      movId = r.lastInsertRowid;
    }
    db.prepare("UPDATE facturas SET estado='PAGADA', fecha_pago=?, cuenta_id=?, movimiento_id=? WHERE id=?")
      .run(fecha, cuentaId, movId, f.id);
  });
  tx();
  audit(req, 'Cuentas C/P', f.tipo === 'COBRAR' ? 'Registrar cobro' : 'Registrar pago',
    (f.contraparte || '') + ' ' + r2(f.monto) + (cuentaId ? ' (movimiento creado)' : ''));
  res.json({ ok: true });
});

module.exports = router;
