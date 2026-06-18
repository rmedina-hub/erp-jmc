const db = require('./db');

// Registra una accion en el historial de auditoria. Nunca rompe la peticion.
function audit(req, modulo, accion, detalle) {
  try {
    const u = (req && req.user) || {};
    db.prepare(`INSERT INTO auditoria (usuario_id,usuario_nombre,usuario_email,rol,empresa,modulo,accion,detalle)
      VALUES (?,?,?,?,?,?,?,?)`).run(u.id || null, u.nombre || null, u.email || null, u.rol || null,
      (req && req.empresa) || null, modulo, accion, detalle || null);
  } catch (e) {}
}

// Variante para eventos sin req.user todavia (ej. login)
function auditRaw(d) {
  try {
    db.prepare(`INSERT INTO auditoria (usuario_id,usuario_nombre,usuario_email,rol,empresa,modulo,accion,detalle)
      VALUES (?,?,?,?,?,?,?,?)`).run(d.usuario_id || null, d.usuario_nombre || null, d.usuario_email || null,
      d.rol || null, d.empresa || null, d.modulo, d.accion, d.detalle || null);
  } catch (e) {}
}

module.exports = { audit, auditRaw };
