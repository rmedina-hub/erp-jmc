const express = require('express');
const db = require('./db');
const { auth, noBodeguero } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth, noBodeguero);

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
const TIPOS = ['ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO'];

// ---------- Plan de cuentas ----------
router.get('/cuentas', (req, res) => {
  res.json(db.prepare('SELECT * FROM plan_cuentas WHERE empresa=? AND activo=1 ORDER BY codigo').all(req.empresa));
});
router.post('/cuentas', (req, res) => {
  const { codigo, nombre, tipo, imputable } = req.body;
  if (!codigo || !nombre || !TIPOS.includes(tipo)) return res.status(400).json({ error: 'codigo, nombre y tipo validos requeridos' });
  try {
    const r = db.prepare('INSERT INTO plan_cuentas (empresa,codigo,nombre,tipo,imputable) VALUES (?,?,?,?,?)')
      .run(req.empresa, String(codigo).trim(), String(nombre).trim(), tipo, imputable === 0 ? 0 : 1);
    audit(req, 'Contabilidad', 'Crear cuenta', codigo + ' ' + nombre);
    res.json(db.prepare('SELECT * FROM plan_cuentas WHERE id=?').get(r.lastInsertRowid));
  } catch (e) { res.status(400).json({ error: 'No se pudo crear la cuenta (codigo duplicado?)' }); }
});
router.put('/cuentas/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM plan_cuentas WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!c) return res.status(404).json({ error: 'No existe' });
  const { codigo, nombre, tipo, imputable, activo } = req.body;
  db.prepare('UPDATE plan_cuentas SET codigo=?, nombre=?, tipo=?, imputable=?, activo=? WHERE id=?')
    .run(codigo ?? c.codigo, nombre ?? c.nombre, TIPOS.includes(tipo) ? tipo : c.tipo,
      imputable == null ? c.imputable : (imputable ? 1 : 0), activo == null ? c.activo : (activo ? 1 : 0), c.id);
  audit(req, 'Contabilidad', 'Editar cuenta', (codigo ?? c.codigo));
  res.json({ ok: true });
});
router.delete('/cuentas/:id', (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede eliminar' });
  const c = db.prepare('SELECT * FROM plan_cuentas WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!c) return res.status(404).json({ error: 'No existe' });
  const usos = db.prepare('SELECT COUNT(*) n FROM asiento_lineas WHERE empresa=? AND cuenta_codigo=?').get(req.empresa, c.codigo).n;
  if (usos) { db.prepare('UPDATE plan_cuentas SET activo=0 WHERE id=?').run(c.id); audit(req, 'Contabilidad', 'Desactivar cuenta', c.codigo); return res.json({ ok: true, desactivada: true }); }
  db.prepare('DELETE FROM plan_cuentas WHERE id=?').run(c.id);
  audit(req, 'Contabilidad', 'Eliminar cuenta', c.codigo);
  res.json({ ok: true });
});

// ---------- Asientos (libro diario) ----------
const lineasDe = (id) => db.prepare('SELECT * FROM asiento_lineas WHERE asiento_id=? ORDER BY id').all(id);

router.get('/asientos', (req, res) => {
  const { desde, hasta, tipo } = req.query;
  let q = 'SELECT * FROM asientos WHERE empresa=?'; const p = [req.empresa];
  if (desde) { q += ' AND fecha>=?'; p.push(desde); }
  if (hasta) { q += ' AND fecha<=?'; p.push(hasta); }
  if (tipo) { q += ' AND tipo=?'; p.push(tipo); }
  q += ' ORDER BY fecha, numero, id';
  const rows = db.prepare(q).all(...p).map(a => {
    const ls = lineasDe(a.id);
    return { ...a, lineas: ls, debe: r2(ls.reduce((s, l) => s + (l.debe || 0), 0)), haber: r2(ls.reduce((s, l) => s + (l.haber || 0), 0)) };
  });
  res.json(rows);
});

router.post('/asientos', (req, res) => {
  const { fecha, glosa, tipo, lineas } = req.body;
  if (!fecha || !Array.isArray(lineas) || lineas.length < 2) return res.status(400).json({ error: 'Se requiere fecha y al menos 2 lineas' });
  let td = 0, th = 0;
  const norm = lineas.map(l => { const d = r2(l.debe), h = r2(l.haber); td += d; th += h; return { cuenta_codigo: String(l.cuenta_codigo || '').trim(), debe: d, haber: h, glosa: l.glosa || '' }; });
  if (norm.some(l => !l.cuenta_codigo)) return res.status(400).json({ error: 'Todas las lineas requieren una cuenta' });
  if (r2(td) !== r2(th)) return res.status(400).json({ error: 'El asiento no cuadra: Debe ' + r2(td) + ' distinto de Haber ' + r2(th) });
  if (r2(td) === 0) return res.status(400).json({ error: 'El asiento no puede ser en cero' });
  const numero = (db.prepare('SELECT MAX(numero) m FROM asientos WHERE empresa=?').get(req.empresa).m || 0) + 1;
  const r = db.prepare('INSERT INTO asientos (empresa,numero,fecha,glosa,tipo,origen,ref,creado_por) VALUES (?,?,?,?,?,?,?,?)')
    .run(req.empresa, numero, fecha, glosa || '', tipo || 'MANUAL', req.body.origen || 'MANUAL', req.body.ref || null, req.user.nombre || req.user.email);
  const insL = db.prepare('INSERT INTO asiento_lineas (asiento_id,empresa,cuenta_codigo,cuenta_nombre,glosa,debe,haber) VALUES (?,?,?,?,?,?,?)');
  for (const l of norm) {
    const cta = db.prepare('SELECT nombre FROM plan_cuentas WHERE empresa=? AND codigo=?').get(req.empresa, l.cuenta_codigo);
    insL.run(r.lastInsertRowid, req.empresa, l.cuenta_codigo, cta ? cta.nombre : '', l.glosa, l.debe, l.haber);
  }
  audit(req, 'Contabilidad', 'Registrar asiento', 'N' + numero + ' ' + (glosa || ''));
  res.json({ ok: true, id: r.lastInsertRowid, numero });
});

router.delete('/asientos/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM asientos WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!a) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM asiento_lineas WHERE asiento_id=?').run(a.id);
  db.prepare('DELETE FROM asientos WHERE id=?').run(a.id);
  audit(req, 'Contabilidad', 'Eliminar asiento', 'N' + a.numero);
  res.json({ ok: true });
});

// ---------- Libro mayor ----------
router.get('/mayor', (req, res) => {
  const { cuenta, desde, hasta } = req.query;
  if (!cuenta) return res.status(400).json({ error: 'cuenta requerida' });
  let saldo = 0;
  if (desde) {
    const a = db.prepare('SELECT IFNULL(SUM(l.debe),0) d, IFNULL(SUM(l.haber),0) h FROM asiento_lineas l JOIN asientos a ON a.id=l.asiento_id WHERE l.empresa=? AND l.cuenta_codigo=? AND a.fecha<?').get(req.empresa, cuenta, desde);
    saldo = r2((a.d || 0) - (a.h || 0));
  }
  const saldoAnterior = saldo;
  let q = 'SELECT a.fecha, a.numero, a.glosa ag, l.glosa lg, l.debe, l.haber FROM asiento_lineas l JOIN asientos a ON a.id=l.asiento_id WHERE l.empresa=? AND l.cuenta_codigo=?';
  const p = [req.empresa, cuenta];
  if (desde) { q += ' AND a.fecha>=?'; p.push(desde); }
  if (hasta) { q += ' AND a.fecha<=?'; p.push(hasta); }
  q += ' ORDER BY a.fecha, a.numero, l.id';
  const movs = db.prepare(q).all(...p).map(m => { saldo = r2(saldo + (m.debe || 0) - (m.haber || 0)); return { fecha: m.fecha, numero: m.numero, glosa: m.lg || m.ag, debe: r2(m.debe), haber: r2(m.haber), saldo }; });
  const cta = db.prepare('SELECT * FROM plan_cuentas WHERE empresa=? AND codigo=?').get(req.empresa, cuenta);
  res.json({ cuenta, nombre: cta ? cta.nombre : '', saldoAnterior, movimientos: movs, saldoFinal: saldo, totalDebe: r2(movs.reduce((s, m) => s + m.debe, 0)), totalHaber: r2(movs.reduce((s, m) => s + m.haber, 0)) });
});

// ---------- Agregado por cuenta (helper) ----------
function aggregate(empresa, desde, hasta) {
  let q = 'SELECT l.cuenta_codigo codigo, IFNULL(SUM(l.debe),0) debe, IFNULL(SUM(l.haber),0) haber FROM asiento_lineas l JOIN asientos a ON a.id=l.asiento_id WHERE l.empresa=?';
  const p = [empresa];
  if (desde) { q += ' AND a.fecha>=?'; p.push(desde); }
  if (hasta) { q += ' AND a.fecha<=?'; p.push(hasta); }
  q += ' GROUP BY l.cuenta_codigo';
  return db.prepare(q).all(...p).map(r => {
    const cta = db.prepare('SELECT tipo,nombre FROM plan_cuentas WHERE empresa=? AND codigo=?').get(empresa, r.codigo);
    return { codigo: r.codigo, nombre: cta ? cta.nombre : '', tipo: cta ? cta.tipo : '', debe: r2(r.debe), haber: r2(r.haber), saldo: r2(r.debe - r.haber) };
  });
}

// ---------- Balance de comprobacion ----------
router.get('/balance', (req, res) => {
  const { desde, hasta } = req.query;
  const rows = aggregate(req.empresa, desde, hasta).sort((a, b) => a.codigo.localeCompare(b.codigo)).map(r => ({
    codigo: r.codigo, nombre: r.nombre, tipo: r.tipo, debe: r.debe, haber: r.haber,
    deudor: r.saldo > 0 ? r.saldo : 0, acreedor: r.saldo < 0 ? -r.saldo : 0
  }));
  res.json({ cuentas: rows, totalDebe: r2(rows.reduce((s, r) => s + r.debe, 0)), totalHaber: r2(rows.reduce((s, r) => s + r.haber, 0)), totalDeudor: r2(rows.reduce((s, r) => s + r.deudor, 0)), totalAcreedor: r2(rows.reduce((s, r) => s + r.acreedor, 0)) });
});

// ---------- Estado de resultados ----------
router.get('/eerr', (req, res) => {
  const { desde, hasta } = req.query;
  const ag = aggregate(req.empresa, desde, hasta);
  const ingresos = ag.filter(c => c.tipo === 'INGRESO').map(c => ({ codigo: c.codigo, nombre: c.nombre, monto: r2(-c.saldo) }));
  const gastos = ag.filter(c => c.tipo === 'GASTO').map(c => ({ codigo: c.codigo, nombre: c.nombre, monto: r2(c.saldo) }));
  const totalIngresos = r2(ingresos.reduce((s, c) => s + c.monto, 0));
  const totalGastos = r2(gastos.reduce((s, c) => s + c.monto, 0));
  res.json({ ingresos, gastos, totalIngresos, totalGastos, resultado: r2(totalIngresos - totalGastos) });
});

// ---------- Balance general ----------
router.get('/balance-general', (req, res) => {
  const { hasta } = req.query;
  const ag = aggregate(req.empresa, null, hasta);
  const activos = ag.filter(c => c.tipo === 'ACTIVO').map(c => ({ codigo: c.codigo, nombre: c.nombre, monto: r2(c.saldo) }));
  const pasivos = ag.filter(c => c.tipo === 'PASIVO').map(c => ({ codigo: c.codigo, nombre: c.nombre, monto: r2(-c.saldo) }));
  const patrimonio = ag.filter(c => c.tipo === 'PATRIMONIO').map(c => ({ codigo: c.codigo, nombre: c.nombre, monto: r2(-c.saldo) }));
  const totalIngresos = r2(ag.filter(c => c.tipo === 'INGRESO').reduce((s, c) => s + (-c.saldo), 0));
  const totalGastos = r2(ag.filter(c => c.tipo === 'GASTO').reduce((s, c) => s + c.saldo, 0));
  const resultado = r2(totalIngresos - totalGastos);
  const totalActivo = r2(activos.reduce((s, c) => s + c.monto, 0));
  const totalPasivo = r2(pasivos.reduce((s, c) => s + c.monto, 0));
  const totalPatrimonio = r2(patrimonio.reduce((s, c) => s + c.monto, 0));
  res.json({ activos, pasivos, patrimonio, resultado, totalActivo, totalPasivo, totalPatrimonio, totalPasivoPatrimonio: r2(totalPasivo + totalPatrimonio + resultado), cuadra: r2(totalActivo) === r2(totalPasivo + totalPatrimonio + resultado) });
});

module.exports = router;
