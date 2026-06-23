const express = require('express');
const db = require('./db');
const { auth, noBodeguero, admin, soloAdminDelete } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth, noBodeguero, soloAdminDelete);

function activoDeEmpresa(id, empresa) {
  return db.prepare('SELECT * FROM activos WHERE id=? AND empresa=?').get(id, empresa);
}

function mantencionInfo(a) {
  const intervalo = Number(a.mantencion_intervalo_km) > 0 ? Number(a.mantencion_intervalo_km) : 10000;
  const kmRow = db.prepare('SELECT km FROM activo_kilometrajes WHERE activo_id=? ORDER BY fecha DESC, id DESC LIMIT 1').get(a.id);
  const km_actual = kmRow ? Number(kmRow.km) : null;
  const ult = db.prepare('SELECT km, proximo_km, fecha FROM activo_mantenciones WHERE activo_id=? ORDER BY fecha DESC, id DESC LIMIT 1').get(a.id);
  let proximo_km = null;
  if (ult) {
    if (ult.proximo_km != null && Number(ult.proximo_km) > 0) proximo_km = Number(ult.proximo_km);
    else if (ult.km != null) proximo_km = Number(ult.km) + intervalo;
  }
  let estado = 'SIN_DATOS', km_restante = null;
  if (proximo_km != null && km_actual != null) {
    km_restante = proximo_km - km_actual;
    if (km_restante <= 0) estado = 'VENCIDA';
    else if (km_restante <= 500) estado = 'POR_VENCER';
    else estado = 'OK';
  } else if (proximo_km != null) { estado = 'OK'; }
  return { intervalo, km_actual, ultima_km: ult ? ult.km : null, ultima_fecha: ult ? ult.fecha : null, proximo_km, km_restante, estado };
}

// ---------- Activos ----------
router.get('/', (req, res) => {
  const activos = db.prepare('SELECT * FROM activos WHERE empresa=? AND IFNULL(eliminado,0)=0 ORDER BY nombre').all(req.empresa);
  for (const a of activos) {
    const km = db.prepare('SELECT km, fecha FROM activo_kilometrajes WHERE activo_id=? ORDER BY fecha DESC, id DESC LIMIT 1').get(a.id);
    a.km_actual = km ? km.km : null;
    a.km_fecha = km ? km.fecha : null;
    const mi = mantencionInfo(a);
    a.mant_estado = mi.estado; a.mant_proximo_km = mi.proximo_km; a.mant_km_restante = mi.km_restante; a.mant_intervalo = mi.intervalo;
  }
  res.json(activos);
});
router.post('/', (req, res) => {
  const b = req.body;
  if (!b.codigo || !b.nombre) return res.status(400).json({ error: 'codigo y nombre requeridos' });
  try {
    const r = db.prepare(`INSERT INTO activos (codigo,nombre,categoria,marca,modelo,patente,fecha_compra,valor_compra,proveedor,factura,estado,empresa,depreciable,vida_util_meses,valor_residual,mantencion_intervalo_km)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.codigo, b.nombre, b.categoria || null, b.marca || null, b.modelo || null, b.patente || null, b.fecha_compra || null, Number(b.valor_compra) || 0, b.proveedor || null, b.factura || null, b.estado || 'EN_USO', req.empresa, b.depreciable ? 1 : 0, Number(b.vida_util_meses) || 0, Number(b.valor_residual) || 0, Number(b.mantencion_intervalo_km) || 0);
    audit(req, 'Activos', 'Crear activo', (b.codigo || '') + ' - ' + (b.nombre || ''));
    res.json(db.prepare('SELECT * FROM activos WHERE id=?').get(r.lastInsertRowid));
  } catch (e) { res.status(400).json({ error: 'codigo duplicado' }); }
});
router.put('/:id', (req, res) => {
  const b = req.body; const a = activoDeEmpresa(req.params.id, req.empresa);
  if (!a) return res.status(404).json({ error: 'No existe' });
  db.prepare(`UPDATE activos SET codigo=?,nombre=?,categoria=?,marca=?,modelo=?,patente=?,fecha_compra=?,valor_compra=?,proveedor=?,factura=?,estado=?,depreciable=?,vida_util_meses=?,valor_residual=?,mantencion_intervalo_km=? WHERE id=? AND empresa=?`)
    .run(b.codigo != null ? b.codigo : a.codigo, b.nombre != null ? b.nombre : a.nombre, b.categoria != null ? b.categoria : a.categoria,
      b.marca != null ? b.marca : a.marca, b.modelo != null ? b.modelo : a.modelo, b.patente != null ? b.patente : a.patente,
      b.fecha_compra != null ? b.fecha_compra : a.fecha_compra, b.valor_compra != null ? Number(b.valor_compra) : a.valor_compra,
      b.proveedor != null ? b.proveedor : a.proveedor, b.factura != null ? b.factura : a.factura, b.estado || a.estado,
      b.depreciable != null ? (b.depreciable ? 1 : 0) : a.depreciable, b.vida_util_meses != null ? Number(b.vida_util_meses) : a.vida_util_meses, b.valor_residual != null ? Number(b.valor_residual) : a.valor_residual, b.mantencion_intervalo_km != null ? Number(b.mantencion_intervalo_km) : a.mantencion_intervalo_km, req.params.id, req.empresa);
  audit(req, 'Activos', 'Editar activo', (a.codigo || '') + ' - ' + (b.nombre != null ? b.nombre : a.nombre));
  res.json(db.prepare('SELECT * FROM activos WHERE id=?').get(req.params.id));
});
router.get('/:id', (req, res) => {
  const a = activoDeEmpresa(req.params.id, req.empresa);
  if (!a) return res.status(404).json({ error: 'No existe' });
  a.kilometrajes = db.prepare('SELECT * FROM activo_kilometrajes WHERE activo_id=? ORDER BY fecha DESC, id DESC').all(a.id);
  a.seguros = db.prepare('SELECT * FROM activo_seguros WHERE activo_id=? ORDER BY fecha_vencimiento').all(a.id);
  a.documentos = db.prepare('SELECT * FROM activo_documentos WHERE activo_id=? ORDER BY fecha_vencimiento').all(a.id);
  const tieneArch = db.prepare("SELECT nombre FROM archivos WHERE entidad=? AND entidad_id=? LIMIT 1");
  a.seguros.forEach(x => { const ar = tieneArch.get('seguro', x.id); x.archivo = ar ? ar.nombre : null; });
  a.documentos.forEach(x => { const ar = tieneArch.get('documento', x.id); x.archivo = ar ? ar.nombre : null; });
  a.mantenciones = db.prepare('SELECT * FROM activo_mantenciones WHERE activo_id=? ORDER BY fecha DESC, id DESC').all(a.id);
  a.mantenciones.forEach(x => { const ar = tieneArch.get('mantencion', x.id); x.archivo = ar ? ar.nombre : null; });
  a.mantencion = mantencionInfo(a);
  res.json(a);
});
router.delete('/:id', admin, (req, res) => {
  const a = activoDeEmpresa(req.params.id, req.empresa);
  if (!a) return res.status(404).json({ error: 'No existe' });
  db.prepare('UPDATE activos SET eliminado=1, eliminado_at=?, eliminado_por=? WHERE id=?')
    .run(new Date().toISOString(), req.user.nombre, req.params.id);
  audit(req, 'Activos', 'Enviar a papelera', (a.codigo || '') + ' - ' + (a.nombre || ''));
  res.json({ ok: true });
});
// Papelera (solo admin)
router.get('/papelera/lista', admin, (req, res) => {
  res.json(db.prepare('SELECT * FROM activos WHERE empresa=? AND eliminado=1 ORDER BY eliminado_at DESC').all(req.empresa));
});
router.post('/:id/restaurar', admin, (req, res) => {
  const a = activoDeEmpresa(req.params.id, req.empresa);
  if (!a) return res.status(404).json({ error: 'No existe' });
  db.prepare('UPDATE activos SET eliminado=0, eliminado_at=NULL, eliminado_por=NULL WHERE id=?').run(req.params.id);
  audit(req, 'Activos', 'Restaurar activo', (a.codigo || '') + ' - ' + (a.nombre || ''));
  res.json({ ok: true });
});
router.delete('/:id/definitivo', admin, (req, res) => {
  const a = activoDeEmpresa(req.params.id, req.empresa);
  if (!a) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM activos WHERE id=?').run(req.params.id);
  audit(req, 'Activos', 'Eliminar definitivo', (a.codigo || '') + ' - ' + (a.nombre || ''));
  res.json({ ok: true });
});

// ---------- Depreciacion (lineal) ----------
router.get('/:id/depreciacion', (req, res) => {
  const a = activoDeEmpresa(req.params.id, req.empresa);
  if (!a) return res.status(404).json({ error: 'No existe' });
  const n = Number(a.vida_util_meses) || 0;
  const base = (Number(a.valor_compra) || 0) - (Number(a.valor_residual) || 0);
  if (!a.depreciable || n <= 0 || base <= 0) return res.json({ depreciable: false, valor_compra: a.valor_compra, valor_libro: a.valor_compra });
  const mensual = base / n;
  let meses = 0;
  if (a.fecha_compra) { const d0 = new Date(a.fecha_compra + 'T00:00:00'); const hoy = new Date();
    meses = (hoy.getFullYear() - d0.getFullYear()) * 12 + (hoy.getMonth() - d0.getMonth()); if (meses < 0) meses = 0; if (meses > n) meses = n; }
  const acumulada = Math.round(mensual * meses);
  const valor_libro = Math.round((Number(a.valor_compra) || 0) - acumulada);
  res.json({ depreciable: true, vida_util_meses: n, valor_compra: a.valor_compra, valor_residual: a.valor_residual,
    depreciacion_mensual: Math.round(mensual), meses_transcurridos: meses, depreciacion_acumulada: acumulada, valor_libro });
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

// ---------- Mantenciones (por kilometraje) ----------
router.post('/:id/mantenciones', (req, res) => {
  const { fecha, km, tipo, costo, proximo_km, glosa } = req.body;
  if (!activoDeEmpresa(req.params.id, req.empresa)) return res.status(404).json({ error: 'Activo no existe' });
  const r = db.prepare('INSERT INTO activo_mantenciones (activo_id,fecha,km,tipo,costo,proximo_km,glosa,empresa) VALUES (?,?,?,?,?,?,?,?)')
    .run(req.params.id, fecha || new Date().toISOString().slice(0,10), km != null && km !== '' ? Number(km) : null, tipo || null, Number(costo) || 0, proximo_km != null && proximo_km !== '' ? Number(proximo_km) : null, glosa || null, req.empresa);
  audit(req, 'Activos', 'Registrar mantencion', 'Activo ' + req.params.id + ': ' + (tipo || '') + ' ' + (km != null ? Number(km) + ' km' : ''));
  res.json(db.prepare('SELECT * FROM activo_mantenciones WHERE id=?').get(r.lastInsertRowid));
});
router.delete('/mantenciones/:mid', (req, res) => {
  const m = db.prepare('SELECT id FROM activo_mantenciones WHERE id=? AND empresa=?').get(req.params.mid, req.empresa);
  if (!m) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM activo_mantenciones WHERE id=?').run(req.params.mid); res.json({ ok: true });
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
  const noVence = ['PADRON', 'PRIMERA_INSCRIPCION'].includes(String(tipo || '').toUpperCase());
  if (!tipo) return res.status(400).json({ error: 'tipo requerido' });
  if (!noVence && !fecha_vencimiento) return res.status(400).json({ error: 'fecha_vencimiento requerida' });
  if (!activoDeEmpresa(req.params.id, req.empresa)) return res.status(404).json({ error: 'Activo no existe' });
  const r = db.prepare(`INSERT INTO activo_documentos (activo_id,tipo,numero,fecha_emision,fecha_vencimiento,glosa,empresa)
    VALUES (?,?,?,?,?,?,?)`).run(req.params.id, tipo, numero || null, fecha_emision || null, fecha_vencimiento || '', glosa || null, req.empresa);
  audit(req, 'Activos', 'Agregar documento', tipo + ' (activo ' + req.params.id + ') vence ' + fecha_vencimiento);
  res.json(db.prepare('SELECT * FROM activo_documentos WHERE id=?').get(r.lastInsertRowid));
});
router.delete('/documentos/:did', (req, res) => {
  const d = db.prepare('SELECT id FROM activo_documentos WHERE id=? AND empresa=?').get(req.params.did, req.empresa);
  if (!d) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM activo_documentos WHERE id=?').run(req.params.did); res.json({ ok: true });
});

// ---------- Adjuntos PDF (seguros / documentos) ----------
function guardarArchivo(req, res, entidad, fila) {
  if (!fila) return res.status(404).json({ error: 'Registro no existe' });
  const { nombre, mime, base64 } = req.body;
  if (!base64) return res.status(400).json({ error: 'archivo requerido' });
  let buf;
  try { buf = Buffer.from(String(base64).replace(/^data:[^,]*,/, ''), 'base64'); }
  catch (e) { return res.status(400).json({ error: 'archivo invalido' }); }
  if (buf.length > 12 * 1024 * 1024) return res.status(400).json({ error: 'archivo demasiado grande (max 12MB)' });
  db.prepare('DELETE FROM archivos WHERE entidad=? AND entidad_id=?').run(entidad, fila.id);
  db.prepare('INSERT INTO archivos (empresa,entidad,entidad_id,nombre,mime,contenido) VALUES (?,?,?,?,?,?)')
    .run(req.empresa, entidad, fila.id, nombre || (entidad + '.pdf'), mime || 'application/pdf', buf);
  audit(req, 'Activos', 'Adjuntar PDF', entidad + ' #' + fila.id + ' (' + (nombre || '') + ')');
  res.json({ ok: true });
}
function descargarArchivo(req, res, entidad, fila) {
  if (!fila) return res.status(404).json({ error: 'Registro no existe' });
  const ar = db.prepare('SELECT * FROM archivos WHERE entidad=? AND entidad_id=? ORDER BY id DESC LIMIT 1').get(entidad, fila.id);
  if (!ar) return res.status(404).json({ error: 'Sin archivo' });
  res.setHeader('Content-Type', ar.mime || 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="' + (ar.nombre || 'archivo.pdf').replace(/[^\w.\-]/g, '_') + '"');
  res.send(Buffer.from(ar.contenido));
}

router.post('/seguros/:sid/archivo', (req, res) =>
  guardarArchivo(req, res, 'seguro', db.prepare('SELECT * FROM activo_seguros WHERE id=? AND empresa=?').get(req.params.sid, req.empresa)));
router.get('/seguros/:sid/archivo', (req, res) =>
  descargarArchivo(req, res, 'seguro', db.prepare('SELECT * FROM activo_seguros WHERE id=? AND empresa=?').get(req.params.sid, req.empresa)));
router.post('/documentos/:did/archivo', (req, res) =>
  guardarArchivo(req, res, 'documento', db.prepare('SELECT * FROM activo_documentos WHERE id=? AND empresa=?').get(req.params.did, req.empresa)));
router.get('/documentos/:did/archivo', (req, res) =>
  descargarArchivo(req, res, 'documento', db.prepare('SELECT * FROM activo_documentos WHERE id=? AND empresa=?').get(req.params.did, req.empresa)));
router.post('/mantenciones/:mid/archivo', (req, res) =>
  guardarArchivo(req, res, 'mantencion', db.prepare('SELECT * FROM activo_mantenciones WHERE id=? AND empresa=?').get(req.params.mid, req.empresa)));
router.get('/mantenciones/:mid/archivo', (req, res) =>
  descargarArchivo(req, res, 'mantencion', db.prepare('SELECT * FROM activo_mantenciones WHERE id=? AND empresa=?').get(req.params.mid, req.empresa)));

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
    WHERE d.empresa=? AND d.fecha_vencimiento <> '' AND d.fecha_vencimiento IS NOT NULL AND d.tipo NOT IN ('PADRON','PRIMERA_INSCRIPCION') AND d.fecha_vencimiento <= ? ORDER BY d.fecha_vencimiento`).all(req.empresa, limite);
  const map = (x) => ({
    clase: x.clase, activo: x.activo, patente: x.patente,
    detalle: x.clase === 'SEGURO' ? ('Seguro ' + (x.compania || '')) : (x.tipo + ' ' + (x.numero || '')),
    fecha_vencimiento: x.fecha_vencimiento,
    estado: x.fecha_vencimiento < hoy ? 'VENCIDO' : 'POR_VENCER',
    id: x.id
  });
  const alertas = [...seguros.map(map), ...docs.map(map)].sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento));
  const activos = db.prepare('SELECT * FROM activos WHERE empresa=? AND IFNULL(eliminado,0)=0').all(req.empresa);
  for (const a of activos) {
    const mi = mantencionInfo(a);
    if (mi.estado === 'VENCIDA' || mi.estado === 'POR_VENCER') {
      alertas.push({ clase: 'MANTENCION', activo: a.nombre, patente: a.patente,
        detalle: 'Mantencion a ' + (mi.proximo_km != null ? Math.round(mi.proximo_km).toLocaleString('es-CL') : '?') + ' km' + (mi.km_restante != null ? (mi.km_restante <= 0 ? ' (pasada ' + Math.abs(Math.round(mi.km_restante)).toLocaleString('es-CL') + ' km)' : ' (faltan ' + Math.round(mi.km_restante).toLocaleString('es-CL') + ' km)') : ''),
        fecha_vencimiento: hoy, estado: mi.estado === 'VENCIDA' ? 'VENCIDO' : 'POR_VENCER', id: a.id, km: true });
    }
  }
  res.json(alertas);
});

module.exports = router;
