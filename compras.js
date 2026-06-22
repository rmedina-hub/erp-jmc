const express = require('express');
const db = require('./db');
const { auth, noBodeguero, admin } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth, noBodeguero); // modulo de oficina

const r2 = (x) => Math.round(Number(x) || 0);
function nextNum(table, empresa) {
  const r = db.prepare(`SELECT COALESCE(MAX(CAST(numero AS INTEGER)),0)+1 n FROM ${table} WHERE empresa=?`).get(empresa);
  return String(r.n);
}

// ===================== SOLICITUDES DE MATERIALES =====================
router.get('/solicitudes', (req, res) => {
  let sql = `SELECT s.*, b.nombre AS bodega FROM solicitudes s LEFT JOIN bodegas b ON b.id=s.bodega_id WHERE s.empresa=?`;
  const p = [req.empresa];
  if (req.query.estado) { sql += ' AND s.estado=?'; p.push(String(req.query.estado).toUpperCase()); }
  sql += ' ORDER BY s.id DESC';
  res.json(db.prepare(sql).all(...p));
});
router.post('/solicitudes', (req, res) => {
  const b = req.body;
  if (!Array.isArray(b.items) || !b.items.length) return res.status(400).json({ error: 'agregue al menos un item' });
  const tx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO solicitudes (empresa,numero,fecha,solicitante,bodega_id,glosa,estado,usuario_id)
      VALUES (?,?,?,?,?,?, 'PENDIENTE', ?)`).run(req.empresa, nextNum('solicitudes', req.empresa),
      b.fecha || new Date().toISOString().slice(0, 10), b.solicitante || null, b.bodega_id || null, b.glosa || null, req.user.id);
    const sid = r.lastInsertRowid;
    const ins = db.prepare('INSERT INTO solicitud_items (solicitud_id,producto_id,descripcion,cantidad,unidad) VALUES (?,?,?,?,?)');
    for (const it of b.items) ins.run(sid, it.producto_id || null, it.descripcion || null, Number(it.cantidad) || 0, it.unidad || null);
    return sid;
  });
  const id = tx();
  audit(req, 'Compras', 'Crear solicitud', '#' + db.prepare('SELECT numero FROM solicitudes WHERE id=?').get(id).numero);
  res.json(db.prepare('SELECT * FROM solicitudes WHERE id=?').get(id));
});
router.get('/solicitudes/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM solicitudes WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!s) return res.status(404).json({ error: 'No existe' });
  s.items = db.prepare(`SELECT i.*, p.sku, p.nombre AS producto FROM solicitud_items i LEFT JOIN productos p ON p.id=i.producto_id WHERE i.solicitud_id=?`).all(s.id);
  s.cotizaciones = db.prepare(`SELECT c.*, t.nombre AS proveedor FROM cotizaciones c LEFT JOIN terceros t ON t.id=c.proveedor_id WHERE c.solicitud_id=? ORDER BY c.total`).all(s.id);
  res.json(s);
});
router.post('/solicitudes/:id/aprobar', admin, (req, res) => {
  const s = db.prepare('SELECT * FROM solicitudes WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!s) return res.status(404).json({ error: 'No existe' });
  db.prepare("UPDATE solicitudes SET estado='APROBADA', aprobada_por=?, fecha_aprob=? WHERE id=?").run(req.user.nombre, new Date().toISOString().slice(0, 10), s.id);
  audit(req, 'Compras', 'Aprobar solicitud', '#' + s.numero); res.json({ ok: true });
});
router.post('/solicitudes/:id/rechazar', admin, (req, res) => {
  const s = db.prepare('SELECT * FROM solicitudes WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!s) return res.status(404).json({ error: 'No existe' });
  db.prepare("UPDATE solicitudes SET estado='RECHAZADA', aprobada_por=?, fecha_aprob=? WHERE id=?").run(req.user.nombre, new Date().toISOString().slice(0, 10), s.id);
  audit(req, 'Compras', 'Rechazar solicitud', '#' + s.numero); res.json({ ok: true });
});
router.delete('/solicitudes/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM solicitudes WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!s) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM solicitudes WHERE id=?').run(s.id);
  audit(req, 'Compras', 'Eliminar solicitud', '#' + s.numero); res.json({ ok: true });
});

// ---- Cotizaciones (cuadro comparativo a nivel total) ----
router.post('/solicitudes/:id/cotizaciones', (req, res) => {
  const s = db.prepare('SELECT * FROM solicitudes WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!s) return res.status(404).json({ error: 'Solicitud no existe' });
  const b = req.body;
  const r = db.prepare(`INSERT INTO cotizaciones (empresa,solicitud_id,proveedor_id,fecha,total,plazo,glosa) VALUES (?,?,?,?,?,?,?)`)
    .run(req.empresa, s.id, b.proveedor_id || null, b.fecha || new Date().toISOString().slice(0, 10), r2(b.total), b.plazo || null, b.glosa || null);
  audit(req, 'Compras', 'Agregar cotizacion', 'Solicitud #' + s.numero);
  res.json(db.prepare('SELECT * FROM cotizaciones WHERE id=?').get(r.lastInsertRowid));
});
router.post('/cotizaciones/:id/seleccionar', (req, res) => {
  const c = db.prepare('SELECT * FROM cotizaciones WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!c) return res.status(404).json({ error: 'No existe' });
  db.prepare('UPDATE cotizaciones SET seleccionada=0 WHERE solicitud_id=?').run(c.solicitud_id);
  db.prepare('UPDATE cotizaciones SET seleccionada=1 WHERE id=?').run(c.id);
  res.json({ ok: true });
});
router.delete('/cotizaciones/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM cotizaciones WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!c) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM cotizaciones WHERE id=?').run(c.id); res.json({ ok: true });
});

// ===================== ORDENES DE COMPRA =====================
router.get('/ordenes', (req, res) => {
  let sql = `SELECT o.*, t.nombre AS proveedor FROM ordenes_compra o LEFT JOIN terceros t ON t.id=o.proveedor_id WHERE o.empresa=?`;
  const p = [req.empresa];
  if (req.query.estado) { sql += ' AND o.estado=?'; p.push(String(req.query.estado).toUpperCase()); }
  sql += ' ORDER BY o.id DESC';
  res.json(db.prepare(sql).all(...p));
});
router.post('/ordenes', (req, res) => {
  const b = req.body;
  if (!Array.isArray(b.items) || !b.items.length) return res.status(400).json({ error: 'agregue al menos un item' });
  const ivaPct = b.iva_pct != null ? Number(b.iva_pct) : 19;
  const tx = db.transaction(() => {
    let neto = 0;
    const items = b.items.map(it => {
      const cant = Number(it.cantidad) || 0, precio = Number(it.precio_unitario) || 0;
      neto += cant * precio;
      return { producto_id: it.producto_id || null, descripcion: it.descripcion || null, cantidad: cant, precio_unitario: precio, unidad: it.unidad || null };
    });
    const iva = neto * ivaPct / 100, total = neto + iva;
    const r = db.prepare(`INSERT INTO ordenes_compra (empresa,numero,fecha,proveedor_id,solicitud_id,cotizacion_id,bodega_id,glosa,neto,iva,total,condicion_pago,estado,usuario_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'PENDIENTE', ?)`).run(req.empresa, nextNum('ordenes_compra', req.empresa),
      b.fecha || new Date().toISOString().slice(0, 10), b.proveedor_id || null, b.solicitud_id || null, b.cotizacion_id || null,
      b.bodega_id || null, b.glosa || null, r2(neto), r2(iva), r2(total), b.condicion_pago || null, req.user.id);
    const oid = r.lastInsertRowid;
    const ins = db.prepare('INSERT INTO oc_items (oc_id,producto_id,descripcion,cantidad,precio_unitario,unidad) VALUES (?,?,?,?,?,?)');
    for (const it of items) ins.run(oid, it.producto_id, it.descripcion, it.cantidad, it.precio_unitario, it.unidad);
    return oid;
  });
  const id = tx();
  audit(req, 'Compras', 'Crear orden de compra', '#' + db.prepare('SELECT numero FROM ordenes_compra WHERE id=?').get(id).numero);
  res.json(db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(id));
});
router.get('/ordenes/:id', (req, res) => {
  const o = db.prepare(`SELECT o.*, t.nombre AS proveedor, t.rut AS proveedor_rut, b.nombre AS bodega FROM ordenes_compra o
    LEFT JOIN terceros t ON t.id=o.proveedor_id LEFT JOIN bodegas b ON b.id=o.bodega_id WHERE o.id=? AND o.empresa=?`).get(req.params.id, req.empresa);
  if (!o) return res.status(404).json({ error: 'No existe' });
  o.items = db.prepare(`SELECT i.*, p.sku, p.nombre AS producto FROM oc_items i LEFT JOIN productos p ON p.id=i.producto_id WHERE i.oc_id=?`).all(o.id);
  if (o.solicitud_id) o.solicitud = db.prepare('SELECT numero, estado FROM solicitudes WHERE id=?').get(o.solicitud_id);
  if (o.factura_id) o.factura = db.prepare('SELECT id, numero, estado, monto FROM facturas WHERE id=?').get(o.factura_id);
  res.json(o);
});
router.post('/ordenes/:id/aprobar', admin, (req, res) => {
  const o = db.prepare('SELECT * FROM ordenes_compra WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!o) return res.status(404).json({ error: 'No existe' });
  db.prepare("UPDATE ordenes_compra SET estado='APROBADA', aprobada_por=?, fecha_aprob=? WHERE id=?").run(req.user.nombre, new Date().toISOString().slice(0, 10), o.id);
  audit(req, 'Compras', 'Aprobar OC', '#' + o.numero + ' ' + r2(o.total)); res.json({ ok: true });
});
router.post('/ordenes/:id/rechazar', admin, (req, res) => {
  const o = db.prepare('SELECT * FROM ordenes_compra WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!o) return res.status(404).json({ error: 'No existe' });
  db.prepare("UPDATE ordenes_compra SET estado='RECHAZADA', aprobada_por=?, fecha_aprob=? WHERE id=?").run(req.user.nombre, new Date().toISOString().slice(0, 10), o.id);
  audit(req, 'Compras', 'Rechazar OC', '#' + o.numero); res.json({ ok: true });
});
router.delete('/ordenes/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM ordenes_compra WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!o) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM ordenes_compra WHERE id=?').run(o.id);
  audit(req, 'Compras', 'Eliminar OC', '#' + o.numero); res.json({ ok: true });
});

// ---- Recepcion: ingresa al inventario (ENTRADA con PMP) ----
router.post('/ordenes/:id/recibir', (req, res) => {
  const o = db.prepare('SELECT * FROM ordenes_compra WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!o) return res.status(404).json({ error: 'No existe' });
  if (o.estado !== 'APROBADA' && o.estado !== 'RECIBIDA') return res.status(400).json({ error: 'La OC debe estar aprobada para recibir' });
  const bodegaId = req.body.bodega_id || o.bodega_id;
  if (!bodegaId) return res.status(400).json({ error: 'indique la bodega de recepcion' });
  const bod = db.prepare('SELECT id FROM bodegas WHERE id=? AND empresa=?').get(bodegaId, req.empresa);
  if (!bod) return res.status(400).json({ error: 'bodega invalida' });
  const lineas = Array.isArray(req.body.items) ? req.body.items : [];
  if (!lineas.length) return res.status(400).json({ error: 'indique cantidades a recibir' });
  const fecha = req.body.fecha || new Date().toISOString().slice(0, 10);
  const tx = db.transaction(() => {
    for (const l of lineas) {
      const it = db.prepare('SELECT * FROM oc_items WHERE id=? AND oc_id=?').get(l.oc_item_id, o.id);
      if (!it) continue;
      const cant = Number(l.cantidad) || 0;
      if (cant <= 0) continue;
      if (it.producto_id) {
        const p = db.prepare('SELECT * FROM productos WHERE id=? AND empresa=?').get(it.producto_id, req.empresa);
        if (p) {
          const costo = it.precio_unitario || 0;
          const nuevoStock = p.stock + cant;
          const nuevoValor = p.stock * p.costo_promedio + cant * costo;
          const pmp = nuevoStock !== 0 ? nuevoValor / nuevoStock : costo;
          db.prepare('UPDATE productos SET stock=?, costo_promedio=? WHERE id=?').run(nuevoStock, pmp, p.id);
          db.prepare(`INSERT INTO inv_movimientos
            (fecha,producto_id,bodega_id,tipo,cantidad,costo_unitario,costo_total,saldo_cantidad,saldo_costo_prom,saldo_valor,documento,glosa,usuario_id,empresa)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(fecha, p.id, bodegaId, 'ENTRADA', cant, costo, cant * costo, nuevoStock, pmp, nuevoStock * pmp, 'OC #' + o.numero, 'Recepcion OC', req.user.id, req.empresa);
        }
      }
      db.prepare('UPDATE oc_items SET cantidad_recibida = cantidad_recibida + ? WHERE id=?').run(cant, it.id);
    }
    // estado de recepcion
    const its = db.prepare('SELECT cantidad, cantidad_recibida FROM oc_items WHERE oc_id=?').all(o.id);
    const totalPend = its.reduce((a, x) => a + (x.cantidad - x.cantidad_recibida), 0);
    const algo = its.some(x => x.cantidad_recibida > 0);
    const recibida = totalPend <= 1e-9 ? 'TOTAL' : (algo ? 'PARCIAL' : 'NO');
    db.prepare("UPDATE ordenes_compra SET recibida=?, estado=CASE WHEN ?='TOTAL' THEN 'RECIBIDA' ELSE estado END WHERE id=?").run(recibida, recibida, o.id);
  });
  tx();
  audit(req, 'Compras', 'Recepcion OC', '#' + o.numero);
  res.json(db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(o.id));
});

// ---- Generar factura por pagar (CxP) desde la OC ----
router.post('/ordenes/:id/facturar', (req, res) => {
  const o = db.prepare('SELECT o.*, t.nombre AS proveedor, t.rut AS proveedor_rut FROM ordenes_compra o LEFT JOIN terceros t ON t.id=o.proveedor_id WHERE o.id=? AND o.empresa=?').get(req.params.id, req.empresa);
  if (!o) return res.status(404).json({ error: 'No existe' });
  if (o.factura_id) return res.status(400).json({ error: 'La OC ya tiene factura asociada' });
  const venc = req.body.fecha_vencimiento || new Date().toISOString().slice(0, 10);
  const tx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO facturas (empresa,tipo,contraparte,rut,numero,glosa,fecha_emision,fecha_vencimiento,monto,estado)
      VALUES (?, 'PAGAR', ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE')`).run(req.empresa, o.proveedor || null, o.proveedor_rut || null,
      req.body.numero || ('OC' + o.numero), 'Orden de compra #' + o.numero, req.body.fecha_emision || new Date().toISOString().slice(0, 10), venc, o.total);
    db.prepare('UPDATE ordenes_compra SET factura_id=? WHERE id=?').run(r.lastInsertRowid, o.id);
    return r.lastInsertRowid;
  });
  const fid = tx();
  audit(req, 'Compras', 'Facturar OC', '#' + o.numero + ' -> CxP ' + r2(o.total));
  res.json({ ok: true, factura_id: fid });
});

module.exports = router;
