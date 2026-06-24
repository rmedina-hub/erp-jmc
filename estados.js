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

// ---- Balance General (situacion financiera) a fin de cada mes ----
router.get('/balance', (req, res) => {
  const empresa = req.empresa;
  const n = Math.min(Math.max(Number(req.query.meses) || 12, 1), 36);
  const meses = rangoMeses(n);
  const inventarioActual = db.prepare("SELECT COALESCE(SUM(stock*costo_promedio),0) s FROM productos WHERE empresa=? AND activo=1").get(empresa).s;
  const cuentas = db.prepare('SELECT * FROM cuentas_bancarias WHERE empresa=?').all(empresa);
  const cajas = db.prepare('SELECT * FROM caja_chica WHERE empresa=? AND IFNULL(activo,1)=1').all(empresa);
  const finMes = (ym) => { const p = ym.split('-').map(Number); return new Date(p[0], p[1], 0).toISOString().slice(0, 10); };
  const add12 = (ymd) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); };
  const data = meses.map(ym => {
    const fin = finMes(ym);
    let efBancos = 0;
    cuentas.forEach(c => {
      const ing = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM tes_movimientos WHERE cuenta_id=? AND tipo='INGRESO' AND fecha<=?").get(c.id, fin).s;
      const egr = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM tes_movimientos WHERE cuenta_id=? AND tipo='EGRESO' AND fecha<=?").get(c.id, fin).s;
      efBancos += (c.saldo_inicial || 0) + ing - egr;
    });
    let efCaja = 0;
    cajas.forEach(c => {
      const g = db.prepare("SELECT COALESCE(SUM(CASE WHEN tipo='GASTO' THEN monto ELSE 0 END),0) gastos, COALESCE(SUM(CASE WHEN tipo='REPOSICION' THEN monto ELSE 0 END),0) repos FROM caja_chica_mov WHERE caja_id=? AND fecha<=?").get(c.id, fin);
      efCaja += (c.monto_asignado || 0) + g.repos - g.gastos;
    });
    const efectivo = efBancos + efCaja;
    const cxc = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM facturas WHERE empresa=? AND tipo='COBRAR' AND IFNULL(fecha_emision,fecha_vencimiento)<=? AND (fecha_pago IS NULL OR fecha_pago>?)").get(empresa, fin, fin).s;
    const cxp = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM facturas WHERE empresa=? AND tipo='PAGAR' AND IFNULL(fecha_emision,fecha_vencimiento)<=? AND (fecha_pago IS NULL OR fecha_pago>?)").get(empresa, fin, fin).s;
    const activosFijos = db.prepare("SELECT COALESCE(SUM(valor_compra),0) s FROM activos WHERE empresa=? AND IFNULL(eliminado,0)=0 AND IFNULL(fecha_compra,'0000-01-01')<=?").get(empresa, fin).s;
    const fin12 = add12(fin);
    const deudaTotal = db.prepare("SELECT COALESCE(SUM(q.amortizacion),0) s FROM credito_cuotas q JOIN creditos c ON c.id=q.credito_id WHERE q.empresa=? AND c.fecha_inicio<=? AND (q.fecha_pago IS NULL OR q.fecha_pago>?)").get(empresa, fin, fin).s;
    const cuotas12 = db.prepare("SELECT COALESCE(SUM(q.amortizacion),0) s FROM credito_cuotas q JOIN creditos c ON c.id=q.credito_id WHERE q.empresa=? AND c.fecha_inicio<=? AND (q.fecha_pago IS NULL OR q.fecha_pago>?) AND q.fecha_venc<=?").get(empresa, fin, fin, fin12).s;
    const activosCorrientes = efectivo + cxc + inventarioActual;
    const activosTotales = activosCorrientes + activosFijos;
    const pasivosCorrientes = cxp + cuotas12;
    const deudaLargoPlazo = deudaTotal - cuotas12;
    const pasivosTotales = cxp + deudaTotal;
    const patrimonio = activosTotales - pasivosTotales;
    return { mes: ym, efectivo: r2(efectivo), cxc: r2(cxc), inventario: r2(inventarioActual), activosCorrientes: r2(activosCorrientes),
      activosFijos: r2(activosFijos), activosTotales: r2(activosTotales),
      cxp: r2(cxp), cuotas12: r2(cuotas12), pasivosCorrientes: r2(pasivosCorrientes),
      deudaLargoPlazo: r2(deudaLargoPlazo), pasivosTotales: r2(pasivosTotales), patrimonio: r2(patrimonio) };
  });
  res.json({ meses, inventarioAprox: r2(inventarioActual), data });
});

module.exports = router;
