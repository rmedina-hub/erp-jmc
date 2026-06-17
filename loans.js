const express = require('express');
const db = require('./db');
const { auth } = require('./auth');
const router = express.Router();
router.use(auth);

function addMonths(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < day) d.setDate(0); // ajusta fin de mes
  return d.toISOString().slice(0, 10);
}
const r2 = (x) => Math.round(x * 100) / 100;

// Genera la tabla de amortizacion
function generarTabla({ monto, tasa_mensual, n_cuotas, sistema, fecha_inicio }) {
  const i = Number(tasa_mensual) / 100;
  const n = Number(n_cuotas);
  const P = Number(monto);
  const filas = [];
  let saldo = P;

  if (sistema === 'ALEMAN') {
    const amortFija = P / n;
    for (let k = 1; k <= n; k++) {
      const interes = saldo * i;
      const amortizacion = (k === n) ? saldo : amortFija;
      const cuota = amortizacion + interes;
      saldo = saldo - amortizacion;
      filas.push({ numero: k, fecha_venc: addMonths(fecha_inicio, k), cuota: r2(cuota), interes: r2(interes), amortizacion: r2(amortizacion), saldo: r2(Math.max(saldo, 0)) });
    }
  } else { // FRANCES (cuota fija)
    const cuota = i === 0 ? P / n : P * i / (1 - Math.pow(1 + i, -n));
    for (let k = 1; k <= n; k++) {
      const interes = saldo * i;
      let amortizacion = cuota - interes;
      if (k === n) amortizacion = saldo; // cuadra ultima cuota
      const cuotaReal = (k === n) ? amortizacion + interes : cuota;
      saldo = saldo - amortizacion;
      filas.push({ numero: k, fecha_venc: addMonths(fecha_inicio, k), cuota: r2(cuotaReal), interes: r2(interes), amortizacion: r2(amortizacion), saldo: r2(Math.max(saldo, 0)) });
    }
  }
  return filas;
}

router.get('/', (req, res) => {
  const creditos = db.prepare('SELECT * FROM creditos ORDER BY created_at DESC').all();
  for (const c of creditos) {
    const ag = db.prepare(`SELECT COUNT(*) tot, SUM(pagado) pagadas,
      COALESCE(SUM(CASE WHEN pagado=0 THEN amortizacion ELSE 0 END),0) saldo_pendiente,
      COALESCE(SUM(cuota),0) total_pagar
      FROM credito_cuotas WHERE credito_id=?`).get(c.id);
    c.cuotas_total = ag.tot; c.cuotas_pagadas = ag.pagadas || 0;
    c.saldo_pendiente = r2(ag.saldo_pendiente); c.total_pagar = r2(ag.total_pagar);
  }
  res.json(creditos);
});

router.post('/', (req, res) => {
  const { banco, nombre, monto, tasa_mensual, n_cuotas, sistema, fecha_inicio, cuenta_id } = req.body;
  if (!banco || !monto || !tasa_mensual || !n_cuotas || !fecha_inicio)
    return res.status(400).json({ error: 'banco, monto, tasa_mensual, n_cuotas y fecha_inicio requeridos' });
  const sis = (sistema || 'FRANCES').toUpperCase();
  const tx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO creditos (banco,nombre,monto,tasa_mensual,n_cuotas,sistema,fecha_inicio,cuenta_id)
      VALUES (?,?,?,?,?,?,?,?)`).run(banco, nombre || banco, Number(monto), Number(tasa_mensual), Number(n_cuotas), sis, fecha_inicio, cuenta_id || null);
    const cid = r.lastInsertRowid;
    const filas = generarTabla({ monto, tasa_mensual, n_cuotas, sistema: sis, fecha_inicio });
    const ins = db.prepare(`INSERT INTO credito_cuotas (credito_id,numero,fecha_venc,cuota,interes,amortizacion,saldo) VALUES (?,?,?,?,?,?,?)`);
    for (const f of filas) ins.run(cid, f.numero, f.fecha_venc, f.cuota, f.interes, f.amortizacion, f.saldo);
    return cid;
  });
  const id = tx();
  res.json(db.prepare('SELECT * FROM creditos WHERE id=?').get(id));
});

router.get('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM creditos WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No existe' });
  c.cuotas = db.prepare('SELECT * FROM credito_cuotas WHERE credito_id=? ORDER BY numero').all(c.id);
  res.json(c);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM creditos WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Pagar una cuota (opcionalmente genera egreso en tesoreria)
router.post('/:id/cuotas/:numero/pagar', (req, res) => {
  const c = db.prepare('SELECT * FROM creditos WHERE id=?').get(req.params.id);
  const cuota = db.prepare('SELECT * FROM credito_cuotas WHERE credito_id=? AND numero=?').get(req.params.id, req.params.numero);
  if (!cuota) return res.status(404).json({ error: 'Cuota no existe' });
  const fecha = req.body.fecha_pago || new Date().toISOString().slice(0, 10);
  const tx = db.transaction(() => {
    let movId = null;
    if (c.cuenta_id) {
      const r = db.prepare(`INSERT INTO tes_movimientos (fecha,cuenta_id,tipo,categoria,monto,glosa,credito_cuota_id,usuario_id)
        VALUES (?,?,?,?,?,?,?,?)`).run(fecha, c.cuenta_id, 'EGRESO', 'Credito ' + c.banco, cuota.cuota,
        'Cuota ' + cuota.numero + '/' + c.n_cuotas + ' ' + c.nombre, cuota.id, req.user.id);
      movId = r.lastInsertRowid;
    }
    db.prepare('UPDATE credito_cuotas SET pagado=1, fecha_pago=?, movimiento_id=? WHERE id=?').run(fecha, movId, cuota.id);
    const pend = db.prepare('SELECT COUNT(*) n FROM credito_cuotas WHERE credito_id=? AND pagado=0').get(c.id).n;
    if (pend === 0) db.prepare("UPDATE creditos SET estado='PAGADO' WHERE id=?").run(c.id);
  });
  tx();
  res.json({ ok: true });
});

// Simulador sin guardar
router.post('/simular', (req, res) => {
  try {
    res.json(generarTabla(req.body));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
