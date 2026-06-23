const express = require('express');
const db = require('./db');
const { auth, noBodeguero, soloAdminDelete } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth, noBodeguero, soloAdminDelete);

router.get('/', (req, res) => {
  const cajas = db.prepare('SELECT * FROM caja_chica WHERE empresa=? ORDER BY nombre').all(req.empresa);
  for (const c of cajas) {
    const g = db.prepare("SELECT COALESCE(SUM(CASE WHEN tipo='GASTO' THEN monto ELSE 0 END),0) gastos, COALESCE(SUM(CASE WHEN tipo='REPOSICION' THEN monto ELSE 0 END),0) repos FROM caja_chica_mov WHERE caja_id=?").get(c.id);
    c.saldo = c.monto_asignado + g.repos - g.gastos; c.total_gastos = g.gastos; c.total_repos = g.repos;
  }
  res.json(cajas);
});
router.post('/', (req, res) => {
  const b = req.body; if (!b.nombre) return res.status(400).json({ error: 'nombre requerido' });
  const r = db.prepare('INSERT INTO caja_chica (empresa,nombre,responsable,monto_asignado) VALUES (?,?,?,?)')
    .run(req.empresa, b.nombre, b.responsable || null, Number(b.monto_asignado) || 0);
  audit(req, 'Caja chica', 'Crear caja', b.nombre);
  res.json(db.prepare('SELECT * FROM caja_chica WHERE id=?').get(r.lastInsertRowid));
});
router.put('/:id', (req, res) => {
  const b = req.body; const c = db.prepare('SELECT * FROM caja_chica WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!c) return res.status(404).json({ error: 'No existe' });
  db.prepare('UPDATE caja_chica SET nombre=?,responsable=?,monto_asignado=? WHERE id=? AND empresa=?')
    .run(b.nombre != null ? b.nombre : c.nombre, b.responsable != null ? b.responsable : c.responsable, b.monto_asignado != null ? Number(b.monto_asignado) : c.monto_asignado, req.params.id, req.empresa);
  res.json(db.prepare('SELECT * FROM caja_chica WHERE id=?').get(req.params.id));
});
router.get('/:id/movimientos', (req, res) => {
  const c = db.prepare('SELECT id FROM caja_chica WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!c) return res.status(404).json({ error: 'No existe' });
  res.json(db.prepare('SELECT * FROM caja_chica_mov WHERE caja_id=? ORDER BY fecha DESC, id DESC').all(req.params.id));
});
router.post('/:id/movimientos', (req, res) => {
  const c = db.prepare('SELECT * FROM caja_chica WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!c) return res.status(404).json({ error: 'Caja no existe' });
  const b = req.body; const tipo = (b.tipo || 'GASTO').toUpperCase() === 'REPOSICION' ? 'REPOSICION' : 'GASTO';
  const r = db.prepare('INSERT INTO caja_chica_mov (caja_id,empresa,fecha,tipo,categoria,glosa,documento,monto,usuario_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(c.id, req.empresa, b.fecha || new Date().toISOString().slice(0, 10), tipo, b.categoria || null, b.glosa || null, b.documento || null, Math.abs(Number(b.monto)) || 0, req.user.id);
  audit(req, 'Caja chica', tipo + ' ' + c.nombre, (b.glosa || '') + ' ' + (Math.abs(Number(b.monto)) || 0));
  res.json(db.prepare('SELECT * FROM caja_chica_mov WHERE id=?').get(r.lastInsertRowid));
});
router.delete('/movimientos/:mid', (req, res) => {
  const m = db.prepare('SELECT * FROM caja_chica_mov WHERE id=? AND empresa=?').get(req.params.mid, req.empresa);
  if (!m) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM caja_chica_mov WHERE id=?').run(m.id); res.json({ ok: true });
});
module.exports = router;
