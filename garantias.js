const express = require('express');
const db = require('./db');
const { auth, noBodeguero, soloAdminDelete } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth, noBodeguero, soloAdminDelete);

router.get('/', (req, res) => {
  let sql = 'SELECT * FROM boletas_garantia WHERE empresa=?'; const p = [req.empresa];
  if (req.query.tipo) { sql += ' AND tipo=?'; p.push(String(req.query.tipo).toUpperCase()); }
  if (req.query.estado) { sql += ' AND estado=?'; p.push(String(req.query.estado).toUpperCase()); }
  sql += ' ORDER BY fecha_vencimiento';
  res.json(db.prepare(sql).all(...p));
});
router.post('/', (req, res) => {
  const b = req.body; if (!b.monto) return res.status(400).json({ error: 'monto requerido' });
  const tipo = (b.tipo || 'EMITIDA').toUpperCase() === 'RECIBIDA' ? 'RECIBIDA' : 'EMITIDA';
  const r = db.prepare(`INSERT INTO boletas_garantia (empresa,tipo,numero,banco,beneficiario,glosa,monto,fecha_emision,fecha_vencimiento)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(req.empresa, tipo, b.numero || null, b.banco || null, b.beneficiario || null, b.glosa || null,
    Number(b.monto) || 0, b.fecha_emision || null, b.fecha_vencimiento || null);
  audit(req, 'Garantias', 'Crear boleta ' + tipo, (b.numero || '') + ' ' + (Number(b.monto) || 0));
  res.json(db.prepare('SELECT * FROM boletas_garantia WHERE id=?').get(r.lastInsertRowid));
});
router.put('/:id', (req, res) => {
  const b = req.body; const g = db.prepare('SELECT * FROM boletas_garantia WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!g) return res.status(404).json({ error: 'No existe' });
  db.prepare(`UPDATE boletas_garantia SET tipo=?,numero=?,banco=?,beneficiario=?,glosa=?,monto=?,fecha_emision=?,fecha_vencimiento=?,estado=? WHERE id=? AND empresa=?`)
    .run((b.tipo || g.tipo).toUpperCase(), b.numero != null ? b.numero : g.numero, b.banco != null ? b.banco : g.banco, b.beneficiario != null ? b.beneficiario : g.beneficiario,
      b.glosa != null ? b.glosa : g.glosa, b.monto != null ? Number(b.monto) : g.monto, b.fecha_emision != null ? b.fecha_emision : g.fecha_emision,
      b.fecha_vencimiento != null ? b.fecha_vencimiento : g.fecha_vencimiento, b.estado || g.estado, req.params.id, req.empresa);
  audit(req, 'Garantias', 'Editar boleta', g.numero || '');
  res.json(db.prepare('SELECT * FROM boletas_garantia WHERE id=?').get(req.params.id));
});
router.delete('/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM boletas_garantia WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!g) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM boletas_garantia WHERE id=?').run(g.id); audit(req, 'Garantias', 'Eliminar boleta', g.numero || ''); res.json({ ok: true });
});
module.exports = router;
