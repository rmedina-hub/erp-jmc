const jwt = require('jsonwebtoken');
const SECRET = process.env.ERP_SECRET || 'cambia-esta-clave-secreta-en-produccion';

function sign(user) {
  return jwt.sign({ id: user.id, nombre: user.nombre, email: user.email, rol: user.rol }, SECRET, { expiresIn: '12h' });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Sesion invalida o expirada' });
  }
}

function admin(req, res, next) {
  if (!req.user || req.user.rol !== 'admin') return res.status(403).json({ error: 'Requiere rol admin' });
  next();
}

module.exports = { sign, auth, admin, SECRET };
