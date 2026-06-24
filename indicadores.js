const express = require('express');
const db = require('./db');
const { auth, noBodeguero } = require('./auth');
const router = express.Router();
router.use(auth, noBodeguero);

function r2(n) { return Math.round(Number(n) || 0); }

router.get('/', (req, res) => {
  const empresa = req.empresa;
  const hoy = new Date().toISOString().slice(0, 10);
  const hace12 = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const en12 = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

  // ---- Efectivo y equivalentes (Tesoreria: bancos + caja chica) ----
  let efectivoBancos = 0;
  db.prepare('SELECT * FROM cuentas_bancarias WHERE empresa=?').all(empresa).forEach(c => {
    const ing = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM tes_movimientos WHERE cuenta_id=? AND tipo='INGRESO'").get(c.id).s;
    const egr = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM tes_movimientos WHERE cuenta_id=? AND tipo='EGRESO'").get(c.id).s;
    efectivoBancos += (c.saldo_inicial || 0) + ing - egr;
  });
  let cajaChica = 0;
  db.prepare('SELECT * FROM caja_chica WHERE empresa=? AND IFNULL(activo,1)=1').all(empresa).forEach(c => {
    const g = db.prepare("SELECT COALESCE(SUM(CASE WHEN tipo='GASTO' THEN monto ELSE 0 END),0) gastos, COALESCE(SUM(CASE WHEN tipo='REPOSICION' THEN monto ELSE 0 END),0) repos FROM caja_chica_mov WHERE caja_id=?").get(c.id);
    cajaChica += (c.monto_asignado || 0) + g.repos - g.gastos;
  });
  const efectivo = efectivoBancos + cajaChica;

  // ---- Cuentas por cobrar / pagar pendientes ----
  const cxc = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM facturas WHERE empresa=? AND tipo='COBRAR' AND estado='PENDIENTE'").get(empresa).s;
  const cxp = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM facturas WHERE empresa=? AND tipo='PAGAR' AND estado='PENDIENTE'").get(empresa).s;

  // ---- Inventario valorizado (Inventario PMP) ----
  const inventario = db.prepare("SELECT COALESCE(SUM(stock*costo_promedio),0) s FROM productos WHERE empresa=? AND activo=1").get(empresa).s;

  // ---- Activos fijos (valor de compra) ----
  const activosFijos = db.prepare("SELECT COALESCE(SUM(valor_compra),0) s FROM activos WHERE empresa=? AND IFNULL(eliminado,0)=0").get(empresa).s;

  // ---- Deuda de creditos bancarios ----
  const cuotas12 = db.prepare("SELECT COALESCE(SUM(amortizacion),0) s FROM credito_cuotas WHERE empresa=? AND pagado=0 AND fecha_venc<=?").get(empresa, en12).s;
  const deudaCreditos = db.prepare("SELECT COALESCE(SUM(amortizacion),0) s FROM credito_cuotas WHERE empresa=? AND pagado=0").get(empresa).s;

  // ---- Flujo de los ultimos 12 meses (Tesoreria / Cuentas C-P) ----
  const ingresos12 = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM tes_movimientos WHERE empresa=? AND tipo='INGRESO' AND fecha>=? AND fecha<=?").get(empresa, hace12, hoy).s;
  const egresos12 = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM tes_movimientos WHERE empresa=? AND tipo='EGRESO' AND fecha>=? AND fecha<=?").get(empresa, hace12, hoy).s;
  const ventasCredito12 = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM facturas WHERE empresa=? AND tipo='COBRAR' AND IFNULL(fecha_emision,fecha_vencimiento)>=? AND IFNULL(fecha_emision,fecha_vencimiento)<=?").get(empresa, hace12, hoy).s;
  const compras12 = db.prepare("SELECT COALESCE(SUM(monto),0) s FROM facturas WHERE empresa=? AND tipo='PAGAR' AND IFNULL(fecha_emision,fecha_vencimiento)>=? AND IFNULL(fecha_emision,fecha_vencimiento)<=?").get(empresa, hace12, hoy).s;

  // ---- Agregados ----
  const activosCorrientes = efectivo + cxc + inventario;
  const activosTotales = activosCorrientes + activosFijos;
  const pasivosCorrientes = cxp + cuotas12;
  const pasivosTotales = cxp + deudaCreditos;
  const patrimonio = activosTotales - pasivosTotales;
  const ventasTotales = ingresos12;
  const beneficioNeto = ingresos12 - egresos12;

  const div = (a, b) => (b && Number(b) !== 0) ? a / b : null;

  res.json({
    periodo: { desde: hace12, hasta: hoy },
    componentes: {
      efectivoBancos: r2(efectivoBancos), cajaChica: r2(cajaChica), efectivo: r2(efectivo),
      cxc: r2(cxc), inventario: r2(inventario), activosCorrientes: r2(activosCorrientes),
      activosFijos: r2(activosFijos), activosTotales: r2(activosTotales),
      cxp: r2(cxp), cuotasCredito12m: r2(cuotas12), pasivosCorrientes: r2(pasivosCorrientes),
      deudaCreditos: r2(deudaCreditos), pasivosTotales: r2(pasivosTotales),
      patrimonio: r2(patrimonio),
      ingresos12: r2(ingresos12), egresos12: r2(egresos12), beneficioNeto: r2(beneficioNeto),
      ventasTotales: r2(ventasTotales), ventasCredito12: r2(ventasCredito12), compras12: r2(compras12)
    },
    ratios: {
      razonCorriente: div(activosCorrientes, pasivosCorrientes),
      cashRatio: div(efectivo, pasivosCorrientes),
      capitalTrabajo: r2(activosCorrientes - pasivosCorrientes),
      solvencia: div(activosTotales, pasivosTotales),
      apalancamiento: div(activosTotales, patrimonio),
      margenNeto: div(beneficioNeto, ventasTotales),
      roi: div(beneficioNeto, activosTotales),
      rotacionCxC: div(ventasCredito12, cxc),
      periodoPago: (compras12 && Number(compras12) !== 0) ? (cxp * 365 / compras12) : null
    }
  });
});

module.exports = router;
