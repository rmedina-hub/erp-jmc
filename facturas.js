const express = require('express');
const db = require('./db');
const { auth, noBodeguero, soloAdminDelete } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth, noBodeguero, soloAdminDelete);

const r2 = (x) => Math.round((Number(x) || 0));

// Listado: ?tipo=COBRAR|PAGAR  ?estado=PENDIENTE|PAGADA
router.get('/', (req, res) => {
  let sql = 'SELECT * FROM facturas WHERE empresa=?';
  const p = [req.empresa];
  if (req.query.tipo) { sql += ' AND tipo=?'; p.push(String(req.query.tipo).toUpperCase()); }
  if (req.query.estado) { sql += ' AND estado=?'; p.push(String(req.query.estado).toUpperCase()); }
  sql += ' ORDER BY fecha_vencimiento, id';
  const rows = db.prepare(sql).all(...p);
  // resumen
  const resumen = { cobrar_pend: 0, pagar_pend: 0 };
  for (const f of rows) {
    if (f.estado === 'PENDIENTE') {
      if (f.tipo === 'COBRAR') resumen.cobrar_pend += f.monto;
      else resumen.pagar_pend += f.monto;
    }
  }
  res.json({ items: rows, resumen });
});

router.post('/', (req, res) => {
  const b = req.body;
  const tipo = (b.tipo || 'COBRAR').toUpperCase() === 'PAGAR' ? 'PAGAR' : 'COBRAR';
  if (!b.fecha_vencimiento || !b.monto) return res.status(400).json({ error: 'fecha de vencimiento y monto requeridos' });
  const r = db.prepare(`INSERT INTO facturas (empresa,tipo,contraparte,rut,numero,glosa,fecha_emision,fecha_vencimiento,monto,estado)
    VALUES (?,?,?,?,?,?,?,?,?,'PENDIENTE')`).run(req.empresa, tipo, b.contraparte || null, b.rut || null, b.numero || null,
    b.glosa || null, b.fecha_emision || null, b.fecha_vencimiento, Math.abs(Number(b.monto)) || 0);
  audit(req, 'Cuentas C/P', tipo === 'COBRAR' ? 'Crear cuenta por cobrar' : 'Crear cuenta por pagar',
    (b.contraparte || '') + ' ' + (b.numero ? 'Fac ' + b.numero + ' ' : '') + r2(b.monto));
  res.json(db.prepare('SELECT * FROM facturas WHERE id=?').get(r.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const b = req.body;
  const f = db.prepare('SELECT * FROM facturas WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!f) return res.status(404).json({ error: 'No existe' });
  db.prepare(`UPDATE facturas SET contraparte=?, rut=?, numero=?, glosa=?, fecha_emision=?, fecha_vencimiento=?, monto=?, tipo=? WHERE id=? AND empresa=?`)
    .run(b.contraparte != null ? b.contraparte : f.contraparte, b.rut != null ? b.rut : f.rut,
      b.numero != null ? b.numero : f.numero, b.glosa != null ? b.glosa : f.glosa,
      b.fecha_emision != null ? b.fecha_emision : f.fecha_emision,
      b.fecha_vencimiento || f.fecha_vencimiento, b.monto != null ? Math.abs(Number(b.monto)) : f.monto,
      b.tipo ? b.tipo.toUpperCase() : f.tipo, req.params.id, req.empresa);
  audit(req, 'Cuentas C/P', 'Editar factura', (b.contraparte != null ? b.contraparte : f.contraparte) || '');
  res.json(db.prepare('SELECT * FROM facturas WHERE id=?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM facturas WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!f) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM facturas WHERE id=? AND empresa=?').run(req.params.id, req.empresa);
  audit(req, 'Cuentas C/P', 'Eliminar factura', (f.contraparte || '') + ' ' + (f.numero || ''));
  res.json({ ok: true });
});

// Marcar pagada/cobrada. Si se indica cuenta_id, genera el movimiento en tesoreria.
router.post('/:id/pagar', (req, res) => {
  const f = db.prepare('SELECT * FROM facturas WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!f) return res.status(404).json({ error: 'No existe' });
  const fecha = req.body.fecha_pago || new Date().toISOString().slice(0, 10);
  let cuentaId = req.body.cuenta_id || null;
  if (cuentaId) {
    const cta = db.prepare('SELECT id FROM cuentas_bancarias WHERE id=? AND empresa=?').get(cuentaId, req.empresa);
    if (!cta) cuentaId = null;
  }
  const tx = db.transaction(() => {
    let movId = null;
    if (cuentaId) {
      const tipoMov = f.tipo === 'COBRAR' ? 'INGRESO' : 'EGRESO';
      const r = db.prepare(`INSERT INTO tes_movimientos (fecha,cuenta_id,tipo,categoria,monto,glosa,usuario_id,empresa)
        VALUES (?,?,?,?,?,?,?,?)`).run(fecha, cuentaId, tipoMov, f.tipo === 'COBRAR' ? 'Cobro cliente' : 'Pago proveedor',
        f.monto, (f.contraparte || '') + (f.numero ? ' Fac ' + f.numero : ''), req.user.id, req.empresa);
      movId = r.lastInsertRowid;
    }
    db.prepare("UPDATE facturas SET estado='PAGADA', fecha_pago=?, cuenta_id=?, movimiento_id=? WHERE id=?")
      .run(fecha, cuentaId, movId, f.id);
  });
  tx();
  audit(req, 'Cuentas C/P', f.tipo === 'COBRAR' ? 'Registrar cobro' : 'Registrar pago',
    (f.contraparte || '') + ' ' + r2(f.monto) + (cuentaId ? ' (movimiento creado)' : ''));
  res.json({ ok: true });
});

// ---------- Importar CSV ----------
function _num(s) {
  if (s == null) return 0;
  let v = String(s).replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  return Number(v) || 0;
}
function _normDate(s) {
  if (!s) return null; s = String(s).trim(); if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return s;
}
function _parseCSVfac(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const header = lines[0].split(sep).map(h => h.trim().toLowerCase());
  const idx = (names) => header.findIndex(h => names.some(n => h.includes(n)));
  const iC = idx(['cliente', 'proveedor', 'contraparte', 'nombre', 'razon']);
  const iR = idx(['rut']);
  const iN = idx(['factura', 'folio', 'documento', 'numero', 'n°', 'nº', 'num']);
  const iE = idx(['emision', 'emisión']);
  const iV = idx(['vencimiento', 'vence', 'vcto', 'pago']);
  const iF = idx(['fecha']);
  const iM = idx(['monto', 'total', 'importe', 'valor']);
  const iG = idx(['glosa', 'detalle', 'descrip', 'concepto']);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(sep);
    out.push({
      contraparte: (iC >= 0 ? c[iC] : '').trim(),
      rut: (iR >= 0 ? c[iR] : '').trim(),
      numero: (iN >= 0 ? c[iN] : '').trim(),
      fecha_emision: _normDate(iE >= 0 ? c[iE] : (iF >= 0 ? c[iF] : '')),
      fecha_vencimiento: _normDate(iV >= 0 ? c[iV] : ''),
      monto: iM >= 0 ? _num(c[iM]) : 0,
      glosa: (iG >= 0 ? c[iG] : '').trim()
    });
  }
  return out;
}
router.post('/import', (req, res) => {
  const tipo = (req.body.tipo || 'COBRAR').toUpperCase() === 'PAGAR' ? 'PAGAR' : 'COBRAR';
  let filas = req.body.filas;
  if (!filas && req.body.csv) filas = _parseCSVfac(req.body.csv);
  if (!Array.isArray(filas) || !filas.length) return res.status(400).json({ error: 'No se reconocieron filas en el CSV' });
  const existe = db.prepare("SELECT 1 FROM facturas WHERE empresa=? AND tipo=? AND IFNULL(numero,'')=? AND IFNULL(contraparte,'')=? AND monto=?");
  const ins = db.prepare(`INSERT INTO facturas (empresa,tipo,contraparte,rut,numero,glosa,fecha_emision,fecha_vencimiento,monto,estado) VALUES (?,?,?,?,?,?,?,?,?,'PENDIENTE')`);
  let importadas = 0, omitidas = 0;
  const tx = db.transaction(() => {
    for (const f of filas) {
      const monto = Math.abs(Number(f.monto)) || 0;
      const venc = f.fecha_vencimiento || null;
      if (!venc || !monto) { omitidas++; continue; }
      if (existe.get(req.empresa, tipo, f.numero || '', f.contraparte || '', monto)) { omitidas++; continue; }
      ins.run(req.empresa, tipo, f.contraparte || null, f.rut || null, f.numero || null, f.glosa || null, f.fecha_emision || null, venc, monto);
      importadas++;
    }
  });
  tx();
  audit(req, 'Cuentas C/P', 'Importar CSV', tipo + ': ' + importadas + ' importadas, ' + omitidas + ' omitidas');
  res.json({ ok: true, importadas, omitidas });
});

module.exports = router;
