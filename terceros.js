const express = require('express');
const db = require('./db');
const { auth, noBodeguero } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth, noBodeguero);

router.get('/', (req, res) => {
  let sql = 'SELECT * FROM terceros WHERE empresa=?'; const p = [req.empresa];
  if (req.query.tipo) { sql += " AND (tipo=? OR tipo='AMBOS')"; p.push(String(req.query.tipo).toUpperCase()); }
  sql += ' ORDER BY nombre';
  res.json(db.prepare(sql).all(...p));
});
router.post('/', (req, res) => {
  const b = req.body; if (!b.nombre) return res.status(400).json({ error: 'nombre requerido' });
  const tipo = ['CLIENTE', 'PROVEEDOR', 'AMBOS'].includes((b.tipo || '').toUpperCase()) ? b.tipo.toUpperCase() : 'PROVEEDOR';
  const r = db.prepare('INSERT INTO terceros (empresa,tipo,rut,nombre,giro,contacto,email,telefono,direccion) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(req.empresa, tipo, b.rut || null, b.nombre, b.giro || null, b.contacto || null, b.email || null, b.telefono || null, b.direccion || null);
  audit(req, 'Terceros', 'Crear ' + tipo, (b.rut ? b.rut + ' ' : '') + b.nombre);
  res.json(db.prepare('SELECT * FROM terceros WHERE id=?').get(r.lastInsertRowid));
});
router.put('/:id', (req, res) => {
  const b = req.body; const t = db.prepare('SELECT * FROM terceros WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!t) return res.status(404).json({ error: 'No existe' });
  db.prepare('UPDATE terceros SET tipo=?,rut=?,nombre=?,giro=?,contacto=?,email=?,telefono=?,direccion=?,activo=? WHERE id=? AND empresa=?')
    .run((b.tipo || t.tipo).toUpperCase(), b.rut != null ? b.rut : t.rut, b.nombre != null ? b.nombre : t.nombre, b.giro != null ? b.giro : t.giro,
      b.contacto != null ? b.contacto : t.contacto, b.email != null ? b.email : t.email, b.telefono != null ? b.telefono : t.telefono,
      b.direccion != null ? b.direccion : t.direccion, b.activo == null ? t.activo : (b.activo ? 1 : 0), req.params.id, req.empresa);
  audit(req, 'Terceros', 'Editar tercero', b.nombre != null ? b.nombre : t.nombre);
  res.json(db.prepare('SELECT * FROM terceros WHERE id=?').get(req.params.id));
});
router.delete('/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM terceros WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!t) return res.status(404).json({ error: 'No existe' });
  db.prepare('DELETE FROM terceros WHERE id=? AND empresa=?').run(req.params.id, req.empresa);
  audit(req, 'Terceros', 'Eliminar tercero', t.nombre); res.json({ ok: true });
});
module.exports = router;
