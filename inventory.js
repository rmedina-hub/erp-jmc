const express = require('express');
const db = require('./db');
const { auth } = require('./auth');
const router = express.Router();
router.use(auth);

// ---------- Bodegas ----------
router.get('/bodegas', (req, res) => {
  res.json(db.prepare('SELECT * FROM bodegas ORDER BY nombre').all());
});
router.post('/bodegas', (req, res) => {
  const { codigo, nombre, ubicacion } = req.body;
  if (!codigo || !nombre) return res.status(400).json({ error: 'codigo y nombre requeridos' });
  try {
    const r = db.prepare('INSERT INTO bodegas (codigo,nombre,ubicacion) VALUES (?,?,?)').run(codigo, nombre, ubicacion || null);
    res.json(db.prepare('SELECT * FROM bodegas WHERE id=?').get(r.lastInsertRowid));
  } catch (e) { res.status(400).json({ error: 'codigo duplicado' }); }
});

// ---------- Productos ----------
router.get('/productos', (req, res) => {
  res.json(db.prepare('SELECT * FROM productos ORDER BY nombre').all());
});
router.post('/productos', (req, res) => {
  const { sku, nombre, unidad, stock_minimo } = req.body;
  if (!sku || !nombre) return res.status(400).json({ error: 'sku y nombre requeridos' });
  try {
    const r = db.prepare('INSERT INTO productos (sku,nombre,unidad,stock_minimo) VALUES (?,?,?,?)')
      .run(sku, nombre, unidad || 'UN', Number(stock_minimo) || 0);
    res.json(db.prepare('SELECT * FROM productos WHERE id=?').get(r.lastInsertRowid));
  } catch (e) { res.status(400).json({ error: 'sku duplicado' }); }
});
router.put('/productos/:id', (req, res) => {
  const { nombre, unidad, stock_minimo, activo } = req.body;
  db.prepare('UPDATE productos SET nombre=?, unidad=?, stock_minimo=?, activo=? WHERE id=?')
    .run(nombre, unidad, Number(stock_minimo) || 0, activo ? 1 : 0, req.params.id);
  res.json(db.prepare('SELECT * FROM productos WHERE id=?').get(req.params.id));
});

// ---------- Movimientos con PMP ----------
// tipo: ENTRADA (suma stock al costo_unitario, recalcula PMP)
//       SALIDA  (resta stock al PMP vigente)
//       AJUSTE  (cantidad con signo; + entra al costo dado/PMP, - sale al PMP)
const crearMovimiento = db.transaction((data, userId) => {
  const p = db.prepare('SELECT * FROM productos WHERE id=?').get(data.producto_id);
  if (!p) throw new Error('Producto no existe');
  const bod = db.prepare('SELECT id FROM bodegas WHERE id=?').get(data.bodega_id);
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
    if (tipo === 'AJUSTE' && costoUnit <= 0) costoUnit = pmp; // ajuste positivo al PMP vigente
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
    costoUnit = pmp;                 // salida valorizada al PMP
    costoTotal = salida * pmp;
    stock = stock - salida;
    valor = stock * pmp;             // PMP no cambia en salidas
    cantidad = -salida;
  } else {
    throw new Error('Tipo invalido');
  }

  db.prepare(`UPDATE productos SET stock=?, costo_promedio=? WHERE id=?`).run(stock, pmp, p.id);
  const r = db.prepare(`INSERT INTO inv_movimientos
    (fecha,producto_id,bodega_id,tipo,cantidad,costo_unitario,costo_total,saldo_cantidad,saldo_costo_prom,saldo_valor,documento,glosa,usuario_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(data.fecha, p.id, data.bodega_id, tipo, cantidad, costoUnit, costoTotal, stock, pmp, valor,
         data.documento || null, data.glosa || null, userId);
  return db.prepare('SELECT * FROM inv_movimientos WHERE id=?').get(r.lastInsertRowid);
});

router.post('/movimientos', (req, res) => {
  try {
    if (!req.body.fecha) req.body.fecha = new Date().toISOString().slice(0, 10);
    const mov = crearMovimiento(req.body, req.user.id);
    res.json(mov);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/movimientos', (req, res) => {
  const { producto_id } = req.query;
  let sql = `SELECT m.*, p.sku, p.nombre AS producto, b.nombre AS bodega
             FROM inv_movimientos m
             JOIN productos p ON p.id=m.producto_id
             JOIN bodegas b ON b.id=m.bodega_id`;
  const params = [];
  if (producto_id) { sql += ' WHERE m.producto_id=?'; params.push(producto_id); }
  sql += ' ORDER BY m.id DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

// Kardex (ascendente) de un producto
router.get('/kardex/:id', (req, res) => {
  const rows = db.prepare(`SELECT m.*, b.nombre AS bodega FROM inv_movimientos m
    JOIN bodegas b ON b.id=m.bodega_id WHERE m.producto_id=? ORDER BY m.id ASC`).all(req.params.id);
  res.json(rows);
});

// Inventario valorizado
router.get('/valorizado', (req, res) => {
  const rows = db.prepare(`SELECT id, sku, nombre, unidad, stock, costo_promedio,
    (stock*costo_promedio) AS valor, stock_minimo,
    CASE WHEN stock <= stock_minimo THEN 1 ELSE 0 END AS bajo_minimo
    FROM productos WHERE activo=1 ORDER BY nombre`).all();
  const total = rows.reduce((a, r) => a + r.valor, 0);
  res.json({ items: rows, total });
});

// Stock por bodega
router.get('/stock-bodega', (req, res) => {
  const rows = db.prepare(`SELECT p.sku, p.nombre AS producto, b.nombre AS bodega,
    SUM(m.cantidad) AS stock
    FROM inv_movimientos m JOIN productos p ON p.id=m.producto_id JOIN bodegas b ON b.id=m.bodega_id
    GROUP BY m.producto_id, m.bodega_id HAVING stock <> 0 ORDER BY p.nombre, b.nombre`).all();
  res.json(rows);
});

module.exports = router;
