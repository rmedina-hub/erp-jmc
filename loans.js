const express = require('express');
const db = require('./db');
const { auth } = require('./auth');
const router = express.Router();
router.use(auth);

function addMonths(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}
const r2 = (x) => Math.round(x * 100) / 100;

// Genera la tabla de amortizacion. Soporta pie inicial e IVA (leasing).
function generarTabla({ monto, pie, tasa_mensual, n_cuotas, sistema, fecha_inicio, iva_pct }) {
  const i = Number(tasa_mensual) / 100;
  const n = Number(n_cuotas);
  const ivap = (Number(iva_pct) || 0) / 100;
  const P = Number(monto) - (Number(pie) || 0); // monto financiado (descontado el pie)
  const filas = [];
  let saldo = P;
  const row = (k, capital, interes) => {
    const neta = capital + interes;
    const iva = neta * ivap;
    saldo = saldo - capital;
    filas.push({ numero: k, fecha_venc: addMonths(fecha_inicio, k), cuota_neta: r2(neta), interes: r2(interes),
      amortizacion: r2(capital), iva: r2(iva), cuota: r2(neta + iva), saldo: r2(Math.max(saldo, 0)) });
  };
  if (sistema === 'ALEMAN') {
    const amortFija = P / n;
    for (let k = 1; k <= n; k++) { const interes = saldo * i; row(k, (k === n ? saldo : amortFija), interes); }
  } else {
    const cuota = i === 0 ? P / n : P * i / (1 - Math.pow(1 + i, -n));
    for (let k = 1; k <= n; k++) { const interes = saldo * i; let amort = cuota - interes; if (k === n) amort = saldo; row(k, amort, interes); }
  }
  return filas;
}

// Calcula la tasa mensual (%) a partir del valor de la cuota neta (metodo de Newton).
function tasaDesdeCuota(P, n, cuotaNeta) {
  P = Number(P); n = Number(n); const c = Number(cuotaNeta);
  if (!(P > 0 && n > 0 && c > 0)) return 0;
  if (c * n <= P + 0.5) return 0; // sin interes
  let i = 0.01;
  for (let it = 0; it < 200; it++) {
    const f = P * i / (1 - Math.pow(1 + i, -n)) - c;
    const d = 1e-7;
    const f2 = P * (i + d) / (1 - Math.pow(1 + (i + d), -n)) - c;
    const der = (f2 - f) / d;
    if (Math.abs(der) < 1e-12) break;
    let ni = i - f / der;
    if (ni <= 0) ni = i / 2;
    i = ni;
    if (Math.abs(f) < 0.01) break;
  }
  return i * 100;
}

router.get('/', (req, res) => {
  const creditos = db.prepare('SELECT * FROM creditos ORDER BY created_at DESC').all();
  for (const c of creditos) {
    const ag = db.prepare(`SELECT COUNT(*) tot, SUM(pagado) pagadas,
      COALESCE(SUM(CASE WHEN pagado=0 THEN amortizacion ELSE 0 END),0) saldo_pendiente,
      COALESCE(SUM(cuota),0) total_pagar FROM credito_cuotas WHERE credito_id=?`).get(c.id);
    c.cuotas_total = ag.tot; c.cuotas_pagadas = ag.pagadas || 0;
    c.saldo_pendiente = r2(ag.saldo_pendiente); c.total_pagar = r2(ag.total_pagar);
  }
  res.json(creditos);
});

router.post('/', (req, res) => {
  const b = req.body;
  if (!b.banco || !b.fecha_inicio) return res.status(400).json({ error: 'banco y fecha_inicio requeridos' });
  const tipo = (b.tipo || 'CREDITO').toUpperCase();
  const sis = (b.sistema || 'FRANCES').toUpperCase();
  const pie = Number(b.pie) || 0;
  const ivaPct = Number(b.iva_pct) || 0;
  const tx = db.transaction(() => {
    let tasa = Number(b.tasa_mensual) || 0;
    let monto = Number(b.monto) || 0;
    let nCuotas = Number(b.n_cuotas) || 0;
    let filas;
    if (Array.isArray(b.tabla) && b.tabla.length) {
      // Importar tabla tal cual
      filas = b.tabla.map((r, idx) => ({
        numero: Number(r.numero) || (idx + 1),
        fecha_venc: r.fecha_venc || r.fecha || null,
        amortizacion: Number(r.amortizacion ?? r.capital) || 0,
        interes: Number(r.interes) || 0,
        cuota_neta: Number(r.cuota_neta ?? r.neta) || (Number(r.amortizacion ?? r.capital) || 0) + (Number(r.interes) || 0),
        iva: Number(r.iva) || 0,
        cuota: Number(r.cuota ?? r.total) || 0,
        saldo: Number(r.saldo) || 0,
        pagado: (r.fecha_pago || r.pagado) ? 1 : 0,
        fecha_pago: r.fecha_pago || null
      }));
      filas.forEach(f => { if (!f.cuota) f.cuota = r2(f.cuota_neta + f.iva); });
      nCuotas = filas.length;
      monto = monto || filas.reduce((a, f) => a + f.amortizacion, 0);
      // derivar tasa de una cuota regular
      const reg = filas.find(f => f.interes > 0 && f.saldo > 0);
      if (reg && !tasa) { const prev = filas[filas.indexOf(reg) - 1]; const base = prev ? prev.saldo : monto; if (base > 0) tasa = r2(reg.interes / base * 100); }
    } else {
      filas = generarTabla({ monto, pie, tasa_mensual: tasa, n_cuotas: nCuotas, sistema: sis, fecha_inicio: b.fecha_inicio, iva_pct: ivaPct });
    }
    const r = db.prepare(`INSERT INTO creditos (banco,nombre,monto,tasa_mensual,n_cuotas,sistema,fecha_inicio,cuenta_id,tipo,pie,iva_pct,glosa)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.banco, b.nombre || b.banco, monto, tasa, nCuotas, sis, b.fecha_inicio,
      b.cuenta_id || null, tipo, pie, ivaPct, b.glosa || null);
    const cid = r.lastInsertRowid;
    const ins = db.prepare(`INSERT INTO credito_cuotas (credito_id,numero,fecha_venc,cuota,interes,amortizacion,saldo,iva,cuota_neta,pagado,fecha_pago)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    for (const f of filas) ins.run(cid, f.numero, f.fecha_venc, f.cuota, f.interes, f.amortizacion, f.saldo, f.iva || 0, f.cuota_neta || 0, f.pagado || 0, f.fecha_pago || null);
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

router.delete('/:id', (req, res) => { db.prepare('DELETE FROM creditos WHERE id=?').run(req.params.id); res.json({ ok: true }); });

router.post('/:id/cuotas/:numero/pagar', (req, res) => {
  const c = db.prepare('SELECT * FROM creditos WHERE id=?').get(req.params.id);
  const cuota = db.prepare('SELECT * FROM credito_cuotas WHERE credito_id=? AND numero=?').get(req.params.id, req.params.numero);
  if (!cuota) return res.status(404).json({ error: 'Cuota no existe' });
  const fecha = req.body.fecha_pago || new Date().toISOString().slice(0, 10);
  const tx = db.transaction(() => {
    let movId = null;
    if (c.cuenta_id) {
      const r = db.prepare(`INSERT INTO tes_movimientos (fecha,cuenta_id,tipo,categoria,monto,glosa,credito_cuota_id,usuario_id)
        VALUES (?,?,?,?,?,?,?,?)`).run(fecha, c.cuenta_id, 'EGRESO', (c.tipo === 'LEASING' ? 'Leasing ' : 'Credito ') + c.banco, cuota.cuota,
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

router.post('/simular', (req, res) => { try { res.json(generarTabla(req.body)); } catch (e) { res.status(400).json({ error: e.message }); } });
router.post('/tasa-desde-cuota', (req, res) => {
  const P = (Number(req.body.monto) || 0) - (Number(req.body.pie) || 0);
  res.json({ tasa_mensual: r2(tasaDesdeCuota(P, req.body.n_cuotas, req.body.cuota_neta)) });
});

router.put('/:id', (req, res) => {
  const b = req.body; const c = db.prepare('SELECT * FROM creditos WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No existe' });
  db.prepare('UPDATE creditos SET banco=?, nombre=?, glosa=?, tipo=?, cuenta_id=?, estado=? WHERE id=?')
    .run(b.banco != null ? b.banco : c.banco, b.nombre != null ? b.nombre : c.nombre, b.glosa != null ? b.glosa : c.glosa,
      b.tipo || c.tipo, (b.cuenta_id === '' ? null : (b.cuenta_id != null ? b.cuenta_id : c.cuenta_id)), b.estado || c.estado, req.params.id);
  res.json(db.prepare('SELECT * FROM creditos WHERE id=?').get(req.params.id));
});

module.exports = router;
