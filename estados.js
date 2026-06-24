const express = require('express');
const db = require('./db');
const { auth, noBodeguero } = require('./auth');
const router = express.Router();
router.use(auth, noBodeguero);

function r2(n) { return Math.round(Number(n) || 0); }
function inferActividad(mv) {
  if (mv.actividad) return mv.actividad;
  const c = ((mv.categoria || '') + ' ' + (mv.glosa || '')).toLowerCase();
  if (/credit|prestamo|interes|leasing|cuota|dividendo|aporte de capital|capital propio/.test(c)) return 'FINANCIAMIENTO';
  if (/activo|inversion|maquina|vehiculo|equipo|terreno|propiedad|compra de bien/.test(c)) return 'INVERSION';
  return 'OPERACIONAL';
}
function rangoMeses(n) {
  const arr = []; const d = new Date();
  for (let i = n - 1; i >= 0; i--) { const dd = new Date(d.getFullYear(), d.getMonth() - i, 1); arr.push(dd.toISOString().slice(0, 7)); }
  return arr;
}

// ---- Estado de Resultados (base caja) mes a mes ----
router.get('/resultados', (req, res) => {
  const n = Math.min(Math.max(Number(req.query.meses) || 12, 1), 36);
  const meses = rangoMeses(n);
  const desde = meses[0] + '-01';
  const movs = db.prepare("SELECT fecha, tipo, categoria, monto FROM tes_movimientos WHERE empresa=? AND fecha>=?").all(req.empresa, desde);
  const data = {}; meses.forEach(m => data[m] = { ingresos: {}, egresos: {}, totIng: 0, totEg: 0 });
  const catsIng = new Set(), catsEg = new Set();
  movs.forEach(m => {
    const ym = (m.fecha || '').slice(0, 7); if (!data[ym]) return;
    const cat = m.categoria || 'Sin categoria';
    if (m.tipo === 'INGRESO') { data[ym].ingresos[cat] = (data[ym].ingresos[cat] || 0) + m.monto; data[ym].totIng += m.monto; catsIng.add(cat); }
    else { data[ym].egresos[cat] = (data[ym].egresos[cat] || 0) + m.monto; data[ym].totEg += m.monto; catsEg.add(cat); }
  });
  res.json({
    meses,
    categoriasIngreso: [...catsIng].sort(), categoriasEgreso: [...catsEg].sort(),
    data: meses.map(m => ({ mes: m, ingresos: data[m].ingresos, egresos: data[m].egresos,
      totalIngresos: r2(data[m].totIng), totalEgresos: r2(data[m].totEg), resultado: r2(data[m].totIng - data[m].totEg) }))
  });
});

// ---- Estado de Flujos de Efectivo (operacion / inversion / financiacion) mes a mes ----
router.get('/flujo-efectivo', (req, res) => {
  const n = Math.min(Math.max(Number(req.query.meses) || 12, 1), 36);
  const meses = rangoMeses(n);
  const desde = meses[0] + '-01';
  let saldoInicialPeriodo = 0;
  db.prepare('SELECT * FROM cuentas_bancarias WHERE empresa=?').all(req.empresa).forEach(c => {
    const ingA = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM tes_movimientos WHERE cuenta_id=? AND tipo='INGRESO' AND fecha<?").get(c.id, desde).s;
    const egrA = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM tes_movimientos WHERE cuenta_id=? AND tipo='EGRESO' AND fecha<?").get(c.id, desde).s;
    saldoInicialPeriodo += (c.saldo_inicial || 0) + ingA - egrA;
  });
  const movs = db.prepare("SELECT fecha, tipo, categoria, glosa, monto, actividad FROM tes_movimientos WHERE empresa=? AND fecha>=?").all(req.empresa, desde);
  const data = {}; meses.forEach(m => data[m] = { OPERACIONAL: 0, INVERSION: 0, FINANCIAMIENTO: 0 });
  movs.forEach(m => {
    const ym = (m.fecha || '').slice(0, 7); if (!data[ym]) return;
    const signed = m.tipo === 'INGRESO' ? m.monto : -m.monto;
    data[ym][inferActividad(m)] += signed;
  });
  let saldo = saldoInicialPeriodo;
  const rows = meses.map(m => {
    const op = data[m].OPERACIONAL, inv = data[m].INVERSION, fin = data[m].FINANCIAMIENTO;
    const neto = op + inv + fin; const saldoIni = saldo; saldo += neto;
    return { mes: m, operacion: r2(op), inversion: r2(inv), financiacion: r2(fin), flujoNeto: r2(neto), saldoInicial: r2(saldoIni), saldoFinal: r2(saldo) };
  });
  res.json({ meses, saldoInicialPeriodo: r2(saldoInicialPeriodo), data: rows });
});

module.exports = router;
