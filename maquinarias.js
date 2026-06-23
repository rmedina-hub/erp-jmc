const express = require('express');
const db = require('./db');
const { auth, noBodeguero, soloAdminDelete } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth, noBodeguero, soloAdminDelete);

router.get('/', (req, res) => {
  let sql = `SELECT a.*, t.nombre AS proveedor FROM arriendos_maquinaria a LEFT JOIN terceros t ON t.id=a.proveedor_id WHERE a.empresa=?`;
  const p = [req.empresa];
  if (req.query.estado) { sql += ' AND a.estado=?'; p.push(String(req.query.estado).toUpperCase()); }
  sql += ' ORDER BY a.fecha_inicio DESC, a.id DESC';
  res.json(db.prepare(sql).all(...p));
});
router.post('/', (req, res) => {
  const b = req.body; if (!b.maquina) return res.status(400).json({ error: 'maquina requerida' });
  const r = db.prepare(`INSERT INTO arriendos_maquinaria (empresa,maquina,proveedor_id,fecha_inicio,fecha_fin,periodo,costo_periodo,obra,glosa)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(req.empresa, b.maquina, b.proveedor_id || null, b.fecha_inicio || null, b.fecha_fin || null,
    (b.periodo || 'MES').toUpperCase(), Number(b.costo_periodo) || 0, b.obra || null, b.glosa || null);
  audit(req, 'Maquinarias', 'Registrar arriendo', b.maquina);
  res.json(db.prepare('SELECT * FROM arriendos_maquinaria WHERE id=?').get(r.lastInsertRowid));
});
router.put('/:id', (req, res) => {
  const b = req.body; const a = db.prepare('SELECT * FROM arriendos_maquinaria WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!a) return res.status(404).json({ error: 'No existe' });
  db.prepare(`UPDATE arriendos_maquinaria SET maquina=?,proveedor_id=?,fecha_inicio=?,fecha_fin=?,periodo=?,costo_periodo=?,obra=?,glosa=? WHERE id=? AND empresa=?`)
    .run(b.maquina != null ? b.maquina : a.maquina, b.proveedor_id != null ? b.proveedor_id : a.proveedor_id, b.fecha_inicio != null ? b.fecha_inicio : a.fecha_inicio,
      b.fecha_fin != null ? b.fecha_fin : a.fecha_fin, (b.periodo || a.periodo).toUpperCase(), b.costo_periodo != null ? Number(b.costo_periodo) : a.costo_periodo,
      b.obra != null ? b.obra : a.obra, b.glosa != null ? b.glosa : a.glosa, req.params.id, req.empresa);
  audit(req, 'Maquinarias', 'Editar arriendo', b.maquina != null ? b.maquina : a.maquina);
  res.json(db.prepare('SELECT * FROM arriendos_maquinaria WHERE id=?').get(req.params.id));
});
router.post('/:id/devolver', (req, res) => {
  const a = db.prepare('SELECT * FROM arriendos_maquinaria WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!a) return res.status(404).json({ error: 'No existe' });
  db.prepare("UPDATE arriendos_maquinaria SET estado='DEVUELTA', fecha_devolucion=? WHERE id=?").run(req.body.fecha_devolucion || new Date().toISOString().slice(0, 10), a.id);
  audit(req, 'Maquinarias', 'Devolver maquinaria', a.maquina); res.json({ ok: true });
});
router.delete('/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM arriendos_maquinaria WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!a) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM arriendos_maquinaria WHERE id=?').run(a.id); audit(req, 'Maquinarias', 'Eliminar arriendo', a.maquina); res.json({ ok: true });
});
module.exports = router;
