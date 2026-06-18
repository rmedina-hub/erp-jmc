const express = require('express');
const db = require('./db');
const { auth, admin } = require('./auth');
const router = express.Router();
router.use(auth, admin); // solo administradores

router.get('/', (req, res) => {
  const { usuario, modulo, desde, hasta, q, todas } = req.query;
  let sql = 'SELECT * FROM auditoria WHERE 1=1';
  const p = [];
  // Admin de ambas empresas: ?todas=1 ve las dos; si no, la empresa activa
  if (!(todas === '1' || todas === 'true')) { sql += ' AND (empresa=? OR empresa IS NULL)'; p.push(req.empresa); }
  if (usuario) { sql += ' AND usuario_email=?'; p.push(usuario); }
  if (modulo) { sql += ' AND modulo=?'; p.push(modulo); }
  if (desde) { sql += ' AND ts>=?'; p.push(desde + ' 00:00:00'); }
  if (hasta) { sql += ' AND ts<=?'; p.push(hasta + ' 23:59:59'); }
  if (q) { sql += ' AND (detalle LIKE ? OR accion LIKE ? OR usuario_nombre LIKE ?)'; const w = '%' + q + '%'; p.push(w, w, w); }
  sql += ' ORDER BY id DESC LIMIT 500';
  res.json(db.prepare(sql).all(...p));
});

// Usuarios distintos que aparecen en el historial (para el filtro)
router.get('/usuarios', (req, res) => {
  res.json(db.prepare('SELECT DISTINCT usuario_nombre, usuario_email FROM auditoria WHERE usuario_email IS NOT NULL ORDER BY usuario_nombre').all());
});

module.exports = router;
