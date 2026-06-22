const express = require('express');
const db = require('./db');
const { auth } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth);

// El bodeguero queda atado a su bodega
function bodegaFija(req) { return req.user && req.user.rol === 'bodeguero' ? (req.user.bodega_id || 0) : null; }


// ---------- Bodegas ----------
router.get('/bodegas', (req, res) => {
  const bf = bodegaFija(req);
  if (bf) return res.json(db.prepare('SELECT * FROM bodegas WHERE empresa=? AND id=? ORDER BY nombre').all(req.empresa, bf));
  res.json(db.prepare('SELECT * FROM bodegas WHERE empresa=? ORDER BY nombre').all(req.empresa));
});
router.post('/bodegas', (req, res) => {
  if (bodegaFija(req)) return res.status(403).json({ error: 'El bodeguero no puede crear bodegas' });
  const { codigo, nombre, ubicacion, tipo } = req.body;
  if (!codigo || !nombre) return res.status(400).json({ error: 'codigo y nombre requeridos' });
  try {
    const r = db.prepare('INSERT INTO bodegas (codigo,nombre,ubicacion,tipo,empresa) VALUES (?,?,?,?,?)').run(codigo, nombre, ubicacion || null, tipo || 'CENTRAL', req.empresa);
    audit(req, 'Inventario', 'Crear bodega', codigo + ' - ' + nombre + ' (' + (tipo || 'CENTRAL') + ')');
    res.json(db.prepare('SELECT * FROM bodegas WHERE id=?').get(r.lastInsertRowid));
  } catch (e) { res.status(400).json({ error: 'codigo duplicado' }); }
});
router.put('/bodegas/:id', (req, res) => {
  if (bodegaFija(req)) return res.status(403).json({ error: 'No autorizado' });
  const b = req.body; const bod = db.prepare('SELECT * FROM bodegas WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!bod) return res.status(404).json({ error: 'No existe' });
  db.prepare('UPDATE bodegas SET codigo=?, nombre=?, ubicacion=?, tipo=? WHERE id=? AND empresa=?')
    .run(b.codigo != null ? b.codigo : bod.codigo, b.nombre != null ? b.nombre : bod.nombre, b.ubicacion != null ? b.ubicacion : bod.ubicacion, b.tipo || bod.tipo, req.params.id, req.empresa);
  audit(req, 'Inventario', 'Editar bodega', (b.codigo != null ? b.codigo : bod.codigo) + ' - ' + (b.nombre != null ? b.nombre : bod.nombre));
  res.json(db.prepare('SELECT * FROM bodegas WHERE id=?').get(req.params.id));
});

// ---------- Productos ----------
router.get('/productos', (req, res) => {
  const rows = db.prepare('SELECT * FROM productos WHERE empresa=? ORDER BY nombre').all(req.empresa);
  const fa = db.prepare("SELECT 1 FROM archivos WHERE entidad='producto' AND entidad_id=? LIMIT 1");
  rows.forEach(p => { p.tiene_foto = fa.get(p.id) ? 1 : 0; });
  res.json(rows);
});
// ---- Foto de producto ----
router.post('/productos/:id/foto', (req, res) => {
  const p = db.prepare('SELECT * FROM productos WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!p) return res.status(404).json({ error: 'Producto no existe' });
  const { nombre, mime, base64 } = req.body;
  if (!base64) return res.status(400).json({ error: 'imagen requerida' });
  let buf; try { buf = Buffer.from(String(base64).replace(/^data:[^,]*,/, ''), 'base64'); } catch (e) { return res.status(400).json({ error: 'imagen invalida' }); }
  if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'imagen demasiado grande (max 8MB)' });
  db.prepare("DELETE FROM archivos WHERE entidad='producto' AND entidad_id=?").run(p.id);
  db.prepare("INSERT INTO archivos (empresa,entidad,entidad_id,nombre,mime,contenido) VALUES (?,?,?,?,?,?)")
    .run(req.empresa, 'producto', p.id, nombre || 'foto.jpg', mime || 'image/jpeg', buf);
  audit(req, 'Inventario', 'Foto de producto', p.sku + ' - ' + p.nombre);
  res.json({ ok: true });
});
router.get('/productos/:id/foto', (req, res) => {
  const p = db.prepare('SELECT id FROM productos WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!p) return res.status(404).json({ error: 'Producto no existe' });
  const ar = db.prepare("SELECT * FROM archivos WHERE entidad='producto' AND entidad_id=? ORDER BY id DESC LIMIT 1").get(p.id);
  if (!ar) return res.status(404).json({ error: 'Sin foto' });
  res.setHeader('Content-Type', ar.mime || 'image/jpeg');
  res.send(Buffer.from(ar.contenido));
});
router.post('/productos', (req, res) => {
  const { sku, nombre, unidad, stock_minimo } = req.body;
  if (!sku || !nombre) return res.status(400).json({ error: 'sku y nombre requeridos' });
  try {
    const r = db.prepare('INSERT INTO productos (sku,nombre,unidad,stock_minimo,empresa) VALUES (?,?,?,?,?)')
      .run(sku, nombre, unidad || 'UN', Number(stock_minimo) || 0, req.empresa);
    audit(req, 'Inventario', 'Crear producto', sku + ' - ' + nombre);
    res.json(db.prepare('SELECT * FROM productos WHERE id=?').get(r.lastInsertRowid));
  } catch (e) { res.status(400).json({ error: 'sku duplicado' }); }
});
router.put('/productos/:id', (req, res) => {
  const { nombre, unidad, stock_minimo, activo } = req.body;
  const p = db.prepare('SELECT * FROM productos WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!p) return res.status(404).json({ error: 'No existe' });
  db.prepare('UPDATE productos SET nombre=?, unidad=?, stock_minimo=?, activo=? WHERE id=? AND empresa=?')
    .run(nombre, unidad, Number(stock_minimo) || 0, activo ? 1 : 0, req.params.id, req.empresa);
  audit(req, 'Inventario', 'Editar producto', (p.sku || '') + ' - ' + (nombre || ''));
  res.json(db.prepare('SELECT * FROM productos WHERE id=?').get(req.params.id));
});

// ---------- Movimientos con PMP ----------
const crearMovimiento = db.transaction((data, userId, empresa) => {
  const p = db.prepare('SELECT * FROM productos WHERE id=? AND empresa=?').get(data.producto_id, empresa);
  if (!p) throw new Error('Producto no existe');
  const bod = db.prepare('SELECT id FROM bodegas WHERE id=? AND empresa=?').get(data.bodega_id, empresa);
  if (!bod) throw new Error('Bodega no existe');

  let stock = p.stock;
  let pmp = p.costo_promedio;
  let valor = stock * pmp;

  let cantidad = Number(data.cantidad);
  let tipo = data.tipo;
  let costoUnit = Number(data.costo_unitario) || 0;
  let costoTotal = 0;

  if (tipo === 'ENTRADA' || (tipo === 'AJUSTE' && cantidad > 0)) {
    if (cantidad <= 0) throw new Error('Cantidad debe ser > 0');
    if (tipo === 'ENTRADA' && costoUnit <= 0) throw new Error('ENTRADA requiere costo_unitario > 0');
    if (tipo === 'AJUSTE' && costoUnit <= 0) costoUnit = pmp;
    costoTotal = cantidad * costoUnit;
    const nuevoStock = stock + cantidad;
    const nuevoValor = valor + costoTotal;
    pmp = nuevoStock !== 0 ? nuevoValor / nuevoStock : costoUnit;
    stock = nuevoStock;
    valor = nuevoValor;
  } else if (tipo === 'SALIDA' || (tipo === 'AJUSTE' && cantidad < 0)) {
    const salida = Math.abs(cantidad);
    if (salida <= 0) throw new Error('Cantidad invalida');
    if (salida > stock + 1e-9) throw new Error('Stock insuficiente (disponible: ' + stock + ')');
    costoUnit = pmp;
    costoTotal = salida * pmp;
    stock = stock - salida;
    valor = stock * pmp;
    cantidad = -salida;
  } else {
    throw new Error('Tipo invalido');
  }

  db.prepare(`UPDATE productos SET stock=?, costo_promedio=? WHERE id=?`).run(stock, pmp, p.id);
  const r = db.prepare(`INSERT INTO inv_movimientos
    (fecha,producto_id,bodega_id,tipo,cantidad,costo_unitario,costo_total,saldo_cantidad,saldo_costo_prom,saldo_valor,documento,glosa,usuario_id,empresa)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(data.fecha, p.id, data.bodega_id, tipo, cantidad, costoUnit, costoTotal, stock, pmp, valor,
         data.documento || null, data.glosa || null, userId, empresa);
  return db.prepare('SELECT * FROM inv_movimientos WHERE id=?').get(r.lastInsertRowid);
});

router.post('/movimientos', (req, res) => {
  try {
    if (!req.body.fecha) req.body.fecha = new Date().toISOString().slice(0, 10);
    const bf = bodegaFija(req); if (bf) req.body.bodega_id = bf;
    const mov = crearMovimiento(req.body, req.user.id, req.empresa);
    audit(req, 'Inventario', 'Movimiento ' + (req.body.tipo || ''), 'Cant: ' + req.body.cantidad + (req.body.documento ? ' Doc: ' + req.body.documento : ''));
    res.json(mov);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/movimientos', (req, res) => {
  const { producto_id } = req.query;
  let sql = `SELECT m.*, p.sku, p.nombre AS producto, b.nombre AS bodega
             FROM inv_movimientos m
             JOIN productos p ON p.id=m.producto_id
             JOIN bodegas b ON b.id=m.bodega_id
             WHERE m.empresa=?`;
  const params = [req.empresa];
  const bf = bodegaFija(req); if (bf) { sql += ' AND m.bodega_id=?'; params.push(bf); }
  if (producto_id) { sql += ' AND m.producto_id=?'; params.push(producto_id); }
  sql += ' ORDER BY m.id DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

// Kardex (ascendente) de un producto
router.get('/kardex/:id', (req, res) => {
  const rows = db.prepare(`SELECT m.*, b.nombre AS bodega FROM inv_movimientos m
    JOIN bodegas b ON b.id=m.bodega_id WHERE m.producto_id=? AND m.empresa=? ORDER BY m.id ASC`).all(req.params.id, req.empresa);
  res.json(rows);
});

// Inventario valorizado
router.get('/valorizado', (req, res) => {
  const rows = db.prepare(`SELECT id, sku, nombre, unidad, stock, costo_promedio,
    (stock*costo_promedio) AS valor, stock_minimo,
    CASE WHEN stock <= stock_minimo THEN 1 ELSE 0 END AS bajo_minimo
    FROM productos WHERE activo=1 AND empresa=? ORDER BY nombre`).all(req.empresa);
  const total = rows.reduce((a, r) => a + r.valor, 0);
  res.json({ items: rows, total });
});

// Stock critico (productos en o bajo el minimo)
router.get('/stock-critico', (req, res) => {
  res.json(db.prepare(`SELECT id, sku, nombre, unidad, stock, stock_minimo, costo_promedio,
    (stock*costo_promedio) AS valor FROM productos WHERE empresa=? AND activo=1 AND stock <= stock_minimo ORDER BY nombre`).all(req.empresa));
});

// Stock por bodega
router.get('/stock-bodega', (req, res) => {
  const rows = db.prepare(`SELECT p.sku, p.nombre AS producto, b.nombre AS bodega,
    SUM(m.cantidad) AS stock
    FROM inv_movimientos m JOIN productos p ON p.id=m.producto_id JOIN bodegas b ON b.id=m.bodega_id
    WHERE m.empresa=?
    GROUP BY m.producto_id, m.bodega_id HAVING stock <> 0 ORDER BY p.nombre, b.nombre`).all(req.empresa);
  res.json(rows);
});

module.exports = router;
