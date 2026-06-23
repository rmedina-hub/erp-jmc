const jwt = require('jsonwebtoken');
const SECRET = process.env.ERP_SECRET || 'cambia-esta-clave-secreta-en-produccion';
const EMPRESAS = ['jmc', 'trabancura'];

function sign(user) {
  return jwt.sign({ id: user.id, nombre: user.nombre, email: user.email, rol: user.rol, empresa: user.empresa || null, bodega_id: user.bodega_id || null },
    SECRET, { expiresIn: '12h' });
}

// Resuelve la empresa activa de la peticion:
//  - Si el usuario esta asignado a una empresa (jmc/trabancura) -> queda BLOQUEADO a esa (ignora el header).
//  - Si el usuario tiene acceso a ambas (empresa null, ej. Adrian) -> usa el header X-Empresa.
function resolverEmpresa(req) {
  const u = req.user || {};
  if (u.empresa && EMPRESAS.includes(u.empresa)) return u.empresa;
  const hdr = String(req.headers['x-empresa'] || '').toLowerCase().trim();
  return EMPRESAS.includes(hdr) ? hdr : 'jmc';
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, SECRET);
    req.empresa = resolverEmpresa(req);   // empresa efectiva para aislar datos
    next();
  } catch {
    return res.status(401).json({ error: 'Sesion invalida o expirada' });
  }
}

function soloAdminDelete(req, res, next) {
  if (req.method === 'DELETE' && (!req.user || req.user.rol !== 'admin'))
    return res.status(403).json({ error: 'Solo un administrador puede eliminar registros' });
  next();
}

function noBodeguero(req, res, next) {
  if (req.user && req.user.rol === 'bodeguero') return res.status(403).json({ error: 'Acceso restringido para el rol bodeguero' });
  next();
}

function admin(req, res, next) {
  if (!req.user || req.user.rol !== 'admin') return res.status(403).json({ error: 'Requiere rol admin' });
  next();
}

module.exports = { sign, auth, admin, noBodeguero, soloAdminDelete, SECRET, EMPRESAS, resolverEmpresa };
