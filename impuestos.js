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

module.exports = router;
