const express = require('express');
const db = require('./db');
const { auth, noBodeguero, soloAdminDelete } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth, noBodeguero, soloAdminDelete);

// ===================== MOTOR FLUJO DE CAJA (compartido) =====================
function flujoInferActividad(mv) {
  if (mv.actividad) return mv.actividad;
  if (mv.credito_cuota_id) return 'FINANCIAMIENTO';
  const c = ((mv.categoria || '') + ' ' + (mv.glosa || '')).toLowerCase();
  if (/credit|prestamo|interes|leasing|cuota|dividendo|aporte de capital|capital propio/.test(c)) return 'FINANCIAMIENTO';
  if (/activo|inversion|maquina|vehiculo|equipo|terreno|propiedad|compra de bien/.test(c)) return 'INVERSION';
  return 'OPERACIONAL';
}
function flujoPeriodo(fecha, gran) {
  if (!fecha) return { key: 'zzz', label: 'Sin fecha' };
  if (gran === 'diario') return { key: fecha, label: fecha };
  if (gran === 'semanal') {
    const d = new Date(fecha + 'T00:00:00'); const off = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - off); const k = d.toISOString().slice(0, 10); return { key: k, label: 'Sem. ' + k };
  }
  return { key: fecha.slice(0, 7), label: fecha.slice(0, 7) };
}
function flujoConstruir(eventos, gran, saldoInicial, saldoMinimo) {
  const acts = ['OPERACIONAL', 'INVERSION', 'FINANCIAMIENTO'];
  const pm = {};
  const totales = { real: { ing: 0, egr: 0 }, proy: { ing: 0, egr: 0 } };
  const actividades = {}; acts.forEach(a => actividades[a] = { real: 0, proy: 0 });
  for (const e of eventos) {
    const pk = flujoPeriodo(e.fecha, gran);
    if (!pm[pk.key]) pm[pk.key] = { key: pk.key, label: pk.label, real: { ing: 0, egr: 0 }, proy: { ing: 0, egr: 0 } };
    const slot = e.clase === 'REAL' ? 'real' : 'proy';
    const dir = e.tipo === 'INGRESO' ? 'ing' : 'egr';
    pm[pk.key][slot][dir] += e.monto;
    totales[slot][dir] += e.monto;
    const signo = e.tipo === 'INGRESO' ? 1 : -1;
    if (actividades[e.actividad]) actividades[e.actividad][slot] += signo * e.monto;
  }
  const periodos = Object.values(pm).sort((a, b) => a.key.localeCompare(b.key));
  let saldo = saldoInicial; const alertas = [];
  for (const p of periodos) {
    p.neto_real = p.real.ing - p.real.egr;
    p.neto_proy = p.proy.ing - p.proy.egr;
    saldo += p.neto_proy;
    p.saldo_acum = Math.round(saldo);
    p.deficit = saldo < saldoMinimo;
    if (p.deficit) alertas.push({ periodo: p.label, saldo: Math.round(saldo) });
  }
  return {
    periodos, actividades, alertas, saldoInicial: Math.round(saldoInicial), saldoMinimo,
    totales: {
      ingreso_real: totales.real.ing, egreso_real: totales.real.egr, neto_real: totales.real.ing - totales.real.egr,
      ingreso_proy: totales.proy.ing, egreso_proy: totales.proy.egr, neto_proy: totales.proy.ing - totales.proy.egr
    }
  };
}

function saldoActualBancos(empresa) {
  const cuentas = db.prepare('SELECT * FROM cuentas_bancarias WHERE empresa=?').all(empresa);
  let total = 0;
  for (const c of cuentas) {
    const ing = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM tes_movimientos WHERE cuenta_id=? AND tipo='INGRESO'").get(c.id).s;
    const egr = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM tes_movimientos WHERE cuenta_id=? AND tipo='EGRESO'").get(c.id).s;
    total += c.saldo_inicial + ing - egr;
  }
  return total;
}

function flujoReporte(b, empresa) {
  const gran = b.granularidad || 'mensual';
  const desde = b.desde || '0000-01-01', hasta = b.hasta || '9999-12-31';
  const minimo = Number(b.saldo_minimo) || 0;
  const excluir = new Set((b.excluir || []).map(String));
  const eventos = [];
  db.prepare('SELECT * FROM tes_movimientos WHERE empresa=? AND fecha>=? AND fecha<=?').all(empresa, desde, hasta).forEach(m =>
    eventos.push({ fecha: m.fecha, tipo: m.tipo, monto: m.monto, actividad: flujoInferActividad(m), clase: 'REAL' }));
  db.prepare('SELECT * FROM flujo_proyeccion WHERE empresa=? AND fecha>=? AND fecha<=?').all(empresa, desde, hasta).forEach(i => {
    if (excluir.has(String(i.id))) return;
    const monto = i.monto * ((i.probabilidad == null ? 100 : i.probabilidad) / 100);
    eventos.push({ fecha: i.fecha, tipo: i.tipo, monto, actividad: i.actividad, clase: 'PROY' });
  });
  db.prepare('SELECT * FROM credito_cuotas WHERE empresa=? AND pagado=0 AND fecha_venc>=? AND fecha_venc<=?').all(empresa, desde, hasta).forEach(q =>
    eventos.push({ fecha: q.fecha_venc, tipo: 'EGRESO', monto: q.cuota, actividad: 'FINANCIAMIENTO', clase: 'PROY' }));
  // Cuentas por cobrar / por pagar pendientes -> flujo proyectado
  db.prepare("SELECT * FROM facturas WHERE empresa=? AND estado='PENDIENTE' AND fecha_vencimiento>=? AND fecha_vencimiento<=?").all(empresa, desde, hasta).forEach(fa =>
    eventos.push({ fecha: fa.fecha_vencimiento, tipo: fa.tipo === 'COBRAR' ? 'INGRESO' : 'EGRESO', monto: fa.monto, actividad: 'OPERACIONAL', clase: 'PROY' }));
  return flujoConstruir(eventos, gran, saldoActualBancos(empresa), minimo);
}

function flujoEventos(b, empresa) {
  const desde = b.desde || '0000-01-01', hasta = b.hasta || '9999-12-31';
  const excluir = new Set((b.excluir || []).map(String));
  const ev = [];
  db.prepare('SELECT * FROM tes_movimientos WHERE empresa=? AND fecha>=? AND fecha<=?').all(empresa, desde, hasta).forEach(m =>
    ev.push({ fecha: m.fecha, tipo: m.tipo, monto: m.monto, actividad: flujoInferActividad(m), categoria: m.categoria || '', glosa: m.glosa || '', clase: 'REAL' }));
  db.prepare('SELECT * FROM flujo_proyeccion WHERE empresa=? AND fecha>=? AND fecha<=?').all(empresa, desde, hasta).forEach(i => {
    if (excluir.has(String(i.id))) return;
    const monto = i.monto * ((i.probabilidad == null ? 100 : i.probabilidad) / 100);
    ev.push({ fecha: i.fecha, tipo: i.tipo, monto, actividad: i.actividad, categoria: i.categoria || '', glosa: i.descripcion || '', clase: 'PROY' });
  });
  db.prepare('SELECT * FROM credito_cuotas WHERE empresa=? AND pagado=0 AND fecha_venc>=? AND fecha_venc<=?').all(empresa, desde, hasta).forEach(q =>
    ev.push({ fecha: q.fecha_venc, tipo: 'EGRESO', monto: q.cuota, actividad: 'FINANCIAMIENTO', categoria: 'Cuota crédito', glosa: '', clase: 'PROY' }));
  db.prepare("SELECT * FROM facturas WHERE empresa=? AND estado='PENDIENTE' AND fecha_vencimiento>=? AND fecha_vencimiento<=?").all(empresa, desde, hasta).forEach(fa =>
    ev.push({ fecha: fa.fecha_vencimiento, tipo: fa.tipo === 'COBRAR' ? 'INGRESO' : 'EGRESO', monto: fa.monto, actividad: 'OPERACIONAL', categoria: fa.tipo === 'COBRAR' ? 'Cobro cliente (CxC)' : 'Pago proveedor (CxP)', glosa: (fa.contraparte || '') + (fa.numero ? ' Fac ' + fa.numero : ''), clase: 'PROY' }));
  return { saldoInicial: saldoActualBancos(empresa), eventos: ev };
}

// ---- Endpoints ----
router.get('/proyeccion', (req, res) => {
  res.json(db.prepare('SELECT * FROM flujo_proyeccion WHERE empresa=? ORDER BY fecha').all(req.empresa));
});
router.post('/proyeccion', (req, res) => {
  const b = req.body;
  if (!b.fecha || !b.tipo || !b.monto) return res.status(400).json({ error: 'fecha, tipo y monto requeridos' });
  const r = db.prepare(`INSERT INTO flujo_proyeccion (fecha,tipo,actividad,categoria,descripcion,monto,probabilidad,cliente,extra_contable,empresa)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(b.fecha, b.tipo, b.actividad || 'OPERACIONAL', b.categoria || null, b.descripcion || null,
    Math.abs(Number(b.monto)) || 0, b.probabilidad == null ? 100 : Number(b.probabilidad), b.cliente || null, b.extra_contable ? 1 : 0, req.empresa);
  audit(req, 'Flujo', 'Proyeccion ' + b.tipo, (b.descripcion || b.categoria || '') + ' ' + Math.abs(Number(b.monto)));
  res.json(db.prepare('SELECT * FROM flujo_proyeccion WHERE id=?').get(r.lastInsertRowid));
});
router.delete('/proyeccion/:id', (req, res) => {
  const r = db.prepare('SELECT id FROM flujo_proyeccion WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!r) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM flujo_proyeccion WHERE id=? AND empresa=?').run(req.params.id, req.empresa);
  audit(req, 'Flujo', 'Eliminar proyeccion', 'id ' + req.params.id);
  res.json({ ok: true });
});
router.post('/reporte', (req, res) => res.json(flujoReporte(req.body || {}, req.empresa)));
router.post('/eventos', (req, res) => res.json(flujoEventos(req.body || {}, req.empresa)));
router.get('/whatif', (req, res) => {
  res.json(db.prepare("SELECT * FROM flujo_proyeccion WHERE empresa=? AND tipo='INGRESO' ORDER BY fecha").all(req.empresa));
});

module.exports = router;
