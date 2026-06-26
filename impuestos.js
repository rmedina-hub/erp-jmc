const express = require('express');
const db = require('./db');
const { auth, noBodeguero } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth, noBodeguero);

function r2(n) { return Math.round(Number(n) || 0); }
function cfg(empresa) {
  let c = db.prepare('SELECT * FROM impuesto_config WHERE empresa=?').get(empresa);
  if (!c) { db.prepare('INSERT OR IGNORE INTO impuesto_config (empresa,ppm_tasa,iva_tasa,remanente) VALUES (?,0,19,0)').run(empresa); c = db.prepare('SELECT * FROM impuesto_config WHERE empresa=?').get(empresa); }
  return c;
}
function finMes(mes) { const p = mes.split('-').map(Number); return new Date(p[0], p[1], 0).toISOString().slice(0, 10); }
function docsMes(empresa, clase, mes) {
  const desde = mes + '-01', hasta = finMes(mes);
  const tipoFac = clase === 'VENTA' ? 'COBRAR' : 'PAGAR';
  const rows = [];
  db.prepare("SELECT * FROM facturas WHERE empresa=? AND tipo=? AND IFNULL(fecha_emision,fecha_vencimiento)>=? AND IFNULL(fecha_emision,fecha_vencimiento)<=?").all(empresa, tipoFac, desde, hasta).forEach(f => {
    const neto = Number(f.neto) || 0, iva = Number(f.iva) || 0, exento = Number(f.exento) || 0;
    rows.push({ id: 'F' + f.id, fecha: f.fecha_emision || f.fecha_vencimiento, rut: f.rut || '', razon_social: f.contraparte || '', tipo_doc: f.tipo_doc || 'FACTURA', folio: f.numero || '', neto: r2(neto), iva: r2(iva), exento: r2(exento), total: r2(neto + iva + exento) || r2(f.monto), giro: f.giro || 'GIRO', origen: 'FACTURA' });
  });
  db.prepare("SELECT * FROM libro_iva WHERE empresa=? AND clase=? AND fecha>=? AND fecha<=?").all(empresa, clase, desde, hasta).forEach(d => {
    const neto = Number(d.neto) || 0, iva = Number(d.iva) || 0, exento = Number(d.exento) || 0;
    rows.push({ id: 'L' + d.id, fecha: d.fecha, rut: d.rut || '', razon_social: d.razon_social || '', tipo_doc: d.tipo_doc || '', folio: d.folio || '', neto: r2(neto), iva: r2(iva), exento: r2(exento), total: r2(d.total || (neto + iva + exento)), giro: d.giro || 'GIRO', origen: d.origen || 'IMPORT' });
  });
  rows.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  return rows;
}

router.get('/config', (req, res) => res.json(cfg(req.empresa)));
router.post('/config', (req, res) => {
  const c = cfg(req.empresa), b = req.body;
  db.prepare('UPDATE impuesto_config SET ppm_tasa=?, iva_tasa=?, remanente=? WHERE empresa=?')
    .run(b.ppm_tasa != null ? Number(b.ppm_tasa) : c.ppm_tasa, b.iva_tasa != null ? Number(b.iva_tasa) : c.iva_tasa, b.remanente != null ? Number(b.remanente) : c.remanente, req.empresa);
  audit(req, 'Impuestos', 'Editar config PPM/IVA', 'PPM ' + (b.ppm_tasa) + '%');
  res.json(cfg(req.empresa));
});

router.get('/libro', (req, res) => {
  const clase = String(req.query.clase || 'VENTA').toUpperCase() === 'COMPRA' ? 'COMPRA' : 'VENTA';
  const mes = req.query.mes || new Date().toISOString().slice(0, 7);
  const docs = docsMes(req.empresa, clase, mes);
  const tot = docs.reduce((a, d) => ({ neto: a.neto + d.neto, iva: a.iva + d.iva, exento: a.exento + d.exento, total: a.total + d.total }), { neto: 0, iva: 0, exento: 0, total: 0 });
  res.json({ clase, mes, docs, totales: { neto: r2(tot.neto), iva: r2(tot.iva), exento: r2(tot.exento), total: r2(tot.total) } });
});
router.post('/libro', (req, res) => {
  const b = req.body;
  const clase = String(b.clase || 'VENTA').toUpperCase() === 'COMPRA' ? 'COMPRA' : 'VENTA';
  if (!b.fecha) return res.status(400).json({ error: 'fecha requerida' });
  const neto = Number(b.neto) || 0, iva = b.iva != null && b.iva !== '' ? Number(b.iva) : Math.round(neto * 0.19), exento = Number(b.exento) || 0;
  const r = db.prepare("INSERT INTO libro_iva (empresa,clase,fecha,rut,razon_social,tipo_doc,folio,neto,iva,exento,total,giro,origen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'MANUAL')")
    .run(req.empresa, clase, b.fecha, b.rut || null, b.razon_social || null, b.tipo_doc || 'FACTURA', b.folio || null, neto, iva, exento, neto + iva + exento, b.giro || 'GIRO');
  audit(req, 'Impuestos', 'Agregar doc ' + clase, (b.razon_social || '') + ' ' + (neto + iva + exento));
  res.json(db.prepare('SELECT * FROM libro_iva WHERE id=?').get(r.lastInsertRowid));
});
router.delete('/libro/:id', (req, res) => {
  const d = db.prepare('SELECT id FROM libro_iva WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!d) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM libro_iva WHERE id=?').run(req.params.id); res.json({ ok: true });
});
router.post('/importar', (req, res) => {
  const clase = String(req.body.clase || 'VENTA').toUpperCase() === 'COMPRA' ? 'COMPRA' : 'VENTA';
  const filas = req.body.filas;
  if (!Array.isArray(filas) || !filas.length) return res.status(400).json({ error: 'Sin filas para importar' });
  let n = 0;
  const ins = db.prepare("INSERT INTO libro_iva (empresa,clase,fecha,rut,razon_social,tipo_doc,folio,neto,iva,exento,total,giro,origen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'IMPORT')");
  const tx = db.transaction(() => {
    filas.forEach(f => {
      if (!f.fecha) return;
      const neto = Number(f.neto) || 0, iva = Number(f.iva) || 0, exento = Number(f.exento) || 0;
      ins.run(req.empresa, clase, f.fecha, f.rut || null, f.razon_social || null, f.tipo_doc || null, f.folio || null, neto, iva, exento, Number(f.total) || (neto + iva + exento), f.giro || 'GIRO');
      n++;
    });
  });
  tx();
  audit(req, 'Impuestos', 'Importar RCV ' + clase, n + ' docs');
  res.json({ ok: true, insertados: n });
});

router.get('/f29', (req, res) => {
  const mes = req.query.mes || new Date().toISOString().slice(0, 7);
  const c = cfg(req.empresa);
  const ventas = docsMes(req.empresa, 'VENTA', mes);
  const compras = docsMes(req.empresa, 'COMPRA', mes);
  const debito = ventas.reduce((a, d) => a + d.iva, 0);
  const ventasAfectas = ventas.reduce((a, d) => a + d.neto, 0);
  const ventasExentas = ventas.reduce((a, d) => a + d.exento, 0);
  const basePPM = ventasAfectas + ventasExentas;
  const creditoDocs = compras.filter(d => !['NO_INCLUIR', 'NO_CORRESPONDE'].includes(String(d.giro || '').toUpperCase()));
  const credito = creditoDocs.reduce((a, d) => a + d.iva, 0);
  const remanenteAnt = Number(c.remanente) || 0;
  const netoIva = debito - credito - remanenteAnt;
  const ivaPagar = Math.max(0, netoIva);
  const remanenteNuevo = Math.max(0, -netoIva);
  const ppm = Math.round(basePPM * (Number(c.ppm_tasa) || 0) / 100);
  const totalF29 = ivaPagar + ppm;
  res.json({
    mes, ppm_tasa: c.ppm_tasa,
    debito: r2(debito), credito: r2(credito), remanenteAnterior: r2(remanenteAnt),
    ivaPagar: r2(ivaPagar), remanenteNuevo: r2(remanenteNuevo),
    ventasAfectas: r2(ventasAfectas), ventasExentas: r2(ventasExentas), basePPM: r2(basePPM),
    ppm: r2(ppm), totalF29: r2(totalF29), nVentas: ventas.length, nCompras: compras.length,
    codigos: { '538': r2(debito), '537': r2(credito), '077': r2(remanenteNuevo), '563': r2(basePPM), '062': r2(ppm), '091': r2(totalF29) }
  });
});

// ---------- Centralizacion contable IVA/PPM ----------
function centralizacionLineas(empresa, mes) {
  const c = cfg(empresa);
  const ventas = docsMes(empresa, 'VENTA', mes);
  const compras = docsMes(empresa, 'COMPRA', mes);
  const debito = r2(ventas.reduce((a, d) => a + d.iva, 0));
  const creditoDocs = compras.filter(d => !['NO_INCLUIR', 'NO_CORRESPONDE'].includes(String(d.giro || '').toUpperCase()));
  const credito = r2(creditoDocs.reduce((a, d) => a + d.iva, 0));
  const basePPM = r2(ventas.reduce((a, d) => a + d.neto + d.exento, 0));
  const ppm = Math.round(basePPM * (Number(c.ppm_tasa) || 0) / 100);
  const nombre = (cod) => { const x = db.prepare('SELECT nombre FROM plan_cuentas WHERE empresa=? AND codigo=?').get(empresa, cod); return x ? x.nombre : ''; };
  const L = [];
  const add = (cod, debe, haber) => { if (r2(debe) || r2(haber)) L.push({ cuenta_codigo: cod, cuenta_nombre: nombre(cod), debe: r2(debe), haber: r2(haber) }); };
  if (debito) add('2.1.02', debito, 0);
  if (credito) add('1.1.04', 0, credito);
  const netoIva = r2(debito - credito);
  if (netoIva > 0) add('2.1.07', 0, netoIva);
  else if (netoIva < 0) add('2.1.07', -netoIva, 0);
  if (ppm) { add('1.1.05', ppm, 0); add('2.1.03', 0, ppm); }
  const td = r2(L.reduce((a, l) => a + l.debe, 0)), th = r2(L.reduce((a, l) => a + l.haber, 0));
  return { mes, lineas: L, debe: td, haber: th, cuadra: td === th, debito, credito, ppm, netoIva };
}

router.get('/centralizacion', (req, res) => {
  const mes = req.query.mes || new Date().toISOString().slice(0, 7);
  const data = centralizacionLineas(req.empresa, mes);
  const ex = db.prepare('SELECT id,numero FROM asientos WHERE empresa=? AND ref=?').get(req.empresa, 'CENT-' + mes);
  res.json({ ...data, ya_existe: !!ex, asiento: ex || null });
});

router.post('/centralizar', (req, res) => {
  const mes = req.body.mes || new Date().toISOString().slice(0, 7);
  const force = !!req.body.force;
  const data = centralizacionLineas(req.empresa, mes);
  if (!data.lineas.length) return res.status(400).json({ error: 'No hay IVA ni PPM para centralizar en ' + mes });
  if (!data.cuadra) return res.status(400).json({ error: 'El asiento no cuadra (' + data.debe + ' vs ' + data.haber + ')' });
  const ref = 'CENT-' + mes;
  const ex = db.prepare('SELECT id,numero FROM asientos WHERE empresa=? AND ref=?').get(req.empresa, ref);
  if (ex && !force) return res.json({ ok: true, ya_existe: true, numero: ex.numero, id: ex.id });
  if (ex && force) { db.prepare('DELETE FROM asiento_lineas WHERE asiento_id=?').run(ex.id); db.prepare('DELETE FROM asientos WHERE id=?').run(ex.id); }
  const numero = (db.prepare('SELECT MAX(numero) m FROM asientos WHERE empresa=?').get(req.empresa).m || 0) + 1;
  const r = db.prepare('INSERT INTO asientos (empresa,numero,fecha,glosa,tipo,origen,ref,creado_por) VALUES (?,?,?,?,?,?,?,?)')
    .run(req.empresa, numero, finMes(mes), 'Centralizacion IVA/PPM ' + mes, 'IVA', 'IMPUESTOS', ref, req.user.nombre || req.user.email);
  const insL = db.prepare('INSERT INTO asiento_lineas (asiento_id,empresa,cuenta_codigo,cuenta_nombre,glosa,debe,haber) VALUES (?,?,?,?,?,?,?)');
  for (const l of data.lineas) insL.run(r.lastInsertRowid, req.empresa, l.cuenta_codigo, l.cuenta_nombre, 'Centralizacion ' + mes, l.debe, l.haber);
  audit(req, 'Impuestos', 'Centralizacion contable IVA/PPM', mes + ' asiento N' + numero);
  res.json({ ok: true, numero, id: r.lastInsertRowid, regenerado: !!(ex && force) });
});

module.exports = router;

