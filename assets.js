const express = require('express');
const db = require('./db');
const { auth } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth);

function activoDeEmpresa(id, empresa) {
  return db.prepare('SELECT * FROM activos WHERE id=? AND empresa=?').get(id, empresa);
}

// ---------- Activos ----------
router.get('/', (req, res) => {
  const activos = db.prepare('SELECT * FROM activos WHERE empresa=? ORDER BY nombre').all(req.empresa);
  for (const a of activos) {
    const km = db.prepare('SELECT km, fecha FROM activo_kilometrajes WHERE activo_id=? ORDER BY fecha DESC, id DESC LIMIT 1').get(a.id);
    a.km_actual = km ? km.km : null;
    a.km_fecha = km ? km.fecha : null;
  }
  res.json(activos);
});
router.post('/', (req, res) => {
  const b = req.body;
  if (!b.codigo || !b.nombre) return res.status(400).json({ error: 'codigo y nombre requeridos' });
  try {
    const r = db.prepare(`INSERT INTO activos (codigo,nombre,categoria,marca,modelo,patente,fecha_compra,valor_compra,proveedor,factura,estado,empresa)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.codigo, b.nombre, b.categoria || null, b.marca || null, b.modelo || null, b.patente || null, b.fecha_compra || null, Number(b.valor_compra) || 0, b.proveedor || null, b.factura || null, b.estado || 'EN_USO', req.empresa);
    audit(req, 'Activos', 'Crear activo', (b.codigo || '') + ' - ' + (b.nombre || ''));
    res.json(db.prepare('SELECT * FROM activos WHERE id=?').get(r.lastInsertRowid));
  } catch (e) { res.status(400).json({ error: 'codigo duplicado' }); }
});
router.put('/:id', (req, res) => {
  const b = req.body; const a = activoDeEmpresa(req.params.id, req.empresa);
  if (!a) return res.status(404).json({ error: 'No existe' });
  db.prepare(`UPDATE activos SET codigo=?,nombre=?,categoria=?,marca=?,modelo=?,patente=?,fecha_compra=?,valor_compra=?,proveedor=?,factura=?,estado=? WHERE id=? AND empresa=?`)
    .run(b.codigo != null ? b.codigo : a.codigo, b.nombre != null ? b.nombre : a.nombre, b.categoria != null ? b.categoria : a.categoria,
      b.marca != null ? b.marca : a.marca, b.modelo != null ? b.modelo : a.modelo, b.patente != null ? b.patente : a.patente,
      b.fecha_compra != null ? b.fecha_compra : a.fecha_compra, b.valor_compra != null ? Number(b.valor_compra) : a.valor_compra,
      b.proveedor != null ? b.proveedor : a.proveedor, b.factura != null ? b.factura : a.factura, b.estado || a.estado, req.params.id, req.empresa);
  audit(req, 'Activos', 'Editar activo', (a.codigo || '') + ' - ' + (b.nombre != null ? b.nombre : a.nombre));
  res.json(db.prepare('SELECT * FROM activos WHERE id=?').get(req.params.id));
});
router.get('/:id', (req, res) => {
  const a = activoDeEmpresa(req.params.id, req.empresa);
  if (!a) return res.status(404).json({ error: 'No existe' });
  a.kilometrajes = db.prepare('SELECT * FROM activo_kilometrajes WHERE activo_id=? ORDER BY fecha DESC, id DESC').all(a.id);
  a.seguros = db.prepare('SELECT * FROM activo_seguros WHERE activo_id=? ORDER BY fecha_vencimiento').all(a.id);
  a.documentos = db.prepare('SELECT * FROM activo_documentos WHERE activo_id=? ORDER BY fecha_vencimiento').all(a.id);
  res.json(a);
});
router.delete('/:id', (req, res) => {
  const a = activoDeEmpresa(req.params.id, req.empresa);
  if (!a) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM activos WHERE id=?').run(req.params.id);
  audit(req, 'Activos', 'Eliminar activo', (a.codigo || '') + ' - ' + (a.nombre || ''));
  res.json({ ok: true });
});

// ---------- Kilometrajes ----------
router.post('/:id/kilometrajes', (req, res) => {
  const { fecha, km, glosa } = req.body;
  if (km == null) return res.status(400).json({ error: 'km requerido' });
  if (!activoDeEmpresa(req.params.id, req.empresa)) return res.status(404).json({ error: 'Activo no existe' });
  const r = db.prepare('INSERT INTO activo_kilometrajes (activo_id,fecha,km,glosa,empresa) VALUES (?,?,?,?,?)')
    .run(req.params.id, fecha || new Date().toISOString().slice(0,10), Number(km), glosa || null, req.empresa);
  audit(req, 'Activos', 'Registrar kilometraje', 'Activo ' + req.params.id + ': ' + Number(km) + ' km');
  res.json(db.prepare('SELECT * FROM activo_kilometrajes WHERE id=?').get(r.lastInsertRowid));
});

// ---------- Seguros ----------
router.post('/:id/seguros', (req, res) => {
  const { compania, poliza, fecha_inicio, fecha_vencimiento, prima, glosa } = req.body;
  if (!fecha_vencimiento) return res.status(400).json({ error: 'fecha_vencimiento requerida' });
  if (!activoDeEmpresa(req.params.id, req.empresa)) return res.status(404).json({ error: 'Activo no existe' });
  const r = db.prepare(`INSERT INTO activo_seguros (activo_id,compania,poliza,fecha_inicio,fecha_vencimiento,prima,glosa,empresa)
    VALUES (?,?,?,?,?,?,?,?)`).run(req.params.id, compania || null, poliza || null, fecha_inicio || null, fecha_vencimiento, Number(prima) || 0, glosa || null, req.empresa);
  audit(req, 'Activos', 'Agregar seguro', 'Activo ' + req.params.id + ' vence ' + fecha_vencimiento);
  res.json(db.prepare('SELECT * FROM activo_seguros WHERE id=?').get(r.lastInsertRowid));
});
router.delete('/seguros/:sid', (req, res) => {
  const s = db.prepare('SELECT id FROM activo_seguros WHERE id=? AND empresa=?').get(req.params.sid, req.empresa);
  if (!s) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM activo_seguros WHERE id=?').run(req.params.sid); res.json({ ok: true });
});

// ---------- Documentos ----------
router.post('/:id/documentos', (req, res) => {
  const { tipo, numero, fecha_emision, fecha_vencimiento, glosa } = req.body;
  if (!tipo || !fecha_vencimiento) return res.status(400).json({ error: 'tipo y fecha_vencimiento requeridos' });
  if (!activoDeEmpresa(req.params.id, req.empresa)) return res.status(404).json({ error: 'Activo no existe' });
  const r = db.prepare(`INSERT INTO activo_documentos (activo_id,tipo,numero,fecha_emision,fecha_vencimiento,glosa,empresa)
    VALUES (?,?,?,?,?,?,?)`).run(req.params.id, tipo, numero || null, fecha_emision || null, fecha_vencimiento, glosa || null, req.empresa);
  audit(req, 'Activos', 'Agregar documento', tipo + ' (activo ' + req.params.id + ') vence ' + fecha_vencimiento);
  res.json(db.prepare('SELECT * FROM activo_documentos WHERE id=?').get(r.lastInsertRowid));
});
router.delete('/documentos/:did', (req, res) => {
  const d = db.prepare('SELECT id FROM activo_documentos WHERE id=? AND empresa=?').get(req.params.did, req.empresa);
  if (!d) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM activo_documentos WHERE id=?').run(req.params.did); res.json({ ok: true });
});

// ---------- Alertas de vencimientos ----------
router.get('/alertas/vencimientos', (req, res) => {
  const dias = Number(req.query.dias) || 30;
  const hoy = new Date().toISOString().slice(0, 10);
  const limite = new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
  const seguros = db.prepare(`SELECT s.*, a.nombre AS activo, a.patente, 'SEGURO' AS clase
    FROM activo_seguros s JOIN activos a ON a.id=s.activo_id
    WHERE s.empresa=? AND s.fecha_vencimiento <= ? ORDER BY s.fecha_vencimiento`).all(req.empresa, limite);
  const docs = db.prepare(`SELECT d.*, a.nombre AS activo, a.patente, 'DOCUMENTO' AS clase
    FROM activo_documentos d JOIN activos a ON a.id=d.activo_id
    WHERE d.empresa=? AND d.fecha_vencimiento <= ? ORDER BY d.fecha_vencimiento`).all(req.empresa, limite);
  const map = (x) => ({
    clase: x.clase, activo: x.activo, patente: x.patente,
    detalle: x.clase === 'SEGURO' ? ('Seguro ' + (x.compania || '')) : (x.tipo + ' ' + (x.numero || '')),
    fecha_vencimiento: x.fecha_vencimiento,
    estado: x.fecha_vencimiento < hoy ? 'VENCIDO' : 'POR_VENCER',
    id: x.id
  });
  const alertas = [...seguros.map(map), ...docs.map(map)].sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento));
  res.json(alertas);
});

module.exports = router;
