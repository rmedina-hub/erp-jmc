const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { sign, auth, admin } = require('./auth');
const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const u = db.prepare('SELECT * FROM usuarios WHERE email=? AND activo=1').get((email || '').toLowerCase().trim());
  if (!u || !bcrypt.compareSync(password || '', u.password_hash))
    return res.status(401).json({ error: 'Credenciales invalidas' });
  res.json({ token: sign(u), usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, empresa: u.empresa || null } });
});

router.get('/me', auth, (req, res) => res.json(req.user));

// Listado y creacion de usuarios (solo admin)
router.get('/', auth, admin, (req, res) => {
  res.json(db.prepare('SELECT id,nombre,email,rol,activo,empresa,created_at FROM usuarios ORDER BY nombre').all());
});
router.post('/', auth, admin, (req, res) => {
  const { nombre, email, password, rol, empresa } = req.body;
  if (!nombre || !email || !password) return res.status(400).json({ error: 'nombre, email y password requeridos' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare('INSERT INTO usuarios (nombre,email,password_hash,rol,empresa) VALUES (?,?,?,?,?)')
      .run(nombre, email.toLowerCase().trim(), hash, rol === 'admin' ? 'admin' : 'usuario', empresa || null);
    res.json(db.prepare('SELECT id,nombre,email,rol,activo,empresa FROM usuarios WHERE id=?').get(r.lastInsertRowid));
  } catch (e) { res.status(400).json({ error: 'email ya registrado' }); }
});
router.put('/:id', auth, admin, (req, res) => {
  const { nombre, rol, activo, password } = req.body;
  const u = db.prepare('SELECT * FROM usuarios WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'No existe' });
  const hash = password ? bcrypt.hashSync(password, 10) : u.password_hash;
  db.prepare('UPDATE usuarios SET nombre=?, rol=?, activo=?, password_hash=? WHERE id=?')
    .run(nombre ?? u.nombre, rol ?? u.rol, activo == null ? u.activo : (activo ? 1 : 0), hash, req.params.id);
  res.json({ ok: true });
});


router.post('/cambiar-password', auth, (req, res) => {
  const { actual, nueva } = req.body;
  const u = db.prepare('SELECT * FROM usuarios WHERE id=?').get(req.user.id);
  if (!u || !bcrypt.compareSync(actual || '', u.password_hash)) return res.status(400).json({ error: 'La contrasena actual no es correcta' });
  if (!nueva || nueva.length < 6) return res.status(400).json({ error: 'La nueva contrasena debe tener al menos 6 caracteres' });
  db.prepare('UPDATE usuarios SET password_hash=? WHERE id=?').run(bcrypt.hashSync(nueva, 10), u.id);
  res.json({ ok: true });
});

module.exports = router;
