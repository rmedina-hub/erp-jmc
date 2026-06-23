const express = require('express');
const db = require('./db');
const { auth, soloAdminDelete } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth, soloAdminDelete);

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM colaboradores WHERE empresa=? ORDER BY apellido, nombre').all(req.empresa));
});
router.post('/', (req, res) => {
  const b = req.body;
  if (!b.nombre) return res.status(400).json({ error: 'nombre requerido' });
  const r = db.prepare('INSERT INTO colaboradores (empresa,nombre,apellido,rut,cargo) VALUES (?,?,?,?,?)')
    .run(req.empresa, b.nombre, b.apellido || null, b.rut || null, b.cargo || null);
  audit(req, 'Colaboradores', 'Crear colaborador', (b.nombre || '') + ' ' + (b.apellido || ''));
  res.json(db.prepare('SELECT * FROM colaboradores WHERE id=?').get(r.lastInsertRowid));
});
router.put('/:id', (req, res) => {
  const b = req.body; const c = db.prepare('SELECT * FROM colaboradores WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!c) return res.status(404).json({ error: 'No existe' });
  db.prepare('UPDATE colaboradores SET nombre=?, apellido=?, rut=?, cargo=?, activo=? WHERE id=? AND empresa=?')
    .run(b.nombre != null ? b.nombre : c.nombre, b.apellido != null ? b.apellido : c.apellido, b.rut != null ? b.rut : c.rut,
      b.cargo != null ? b.cargo : c.cargo, b.activo == null ? c.activo : (b.activo ? 1 : 0), req.params.id, req.empresa);
  audit(req, 'Colaboradores', 'Editar colaborador', (b.nombre != null ? b.nombre : c.nombre));
  res.json(db.prepare('SELECT * FROM colaboradores WHERE id=?').get(req.params.id));
});
router.delete('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM colaboradores WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!c) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM colaboradores WHERE id=? AND empresa=?').run(req.params.id, req.empresa);
  audit(req, 'Colaboradores', 'Eliminar colaborador', c.nombre + ' ' + (c.apellido || ''));
  res.json({ ok: true });
});
module.exports = router;
