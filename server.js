const express = require('express');
const path = require('path');
require('./db'); // inicializa esquema + admin

// ---- Recuperacion de acceso de admin (uso temporal) ----
// Opcion simple: en Render define la variable ERP_RESET = 1  (solo una bandera, sin contrasena).
//   Al reiniciar, el admin queda con la clave generica 'Jmc2026.'  -> entra y cambiala enseguida.
// Opcion con clave a medida: define ERP_RESET_EMAIL y ERP_RESET_PASSWORD.
// IMPORTANTE: quita estas variables despues de entrar (si no, se resetea en cada despliegue).
try {
  const _bcrypt = require('bcryptjs');
  const _db = require('./db');
  const _flag = String(process.env.ERP_RESET || '').trim().toLowerCase();
  const _rEmail = (process.env.ERP_RESET_EMAIL || '').toLowerCase().trim();
  const _rPass = process.env.ERP_RESET_PASSWORD || '';
  let _target = null, _newPass = null;
  if (_rEmail && _rPass) { _target = _rEmail; _newPass = _rPass; }
  else if (['1', 'true', 'on', 'si', 'yes'].includes(_flag)) {
    const _adm = _db.prepare("SELECT email FROM usuarios WHERE rol='admin' ORDER BY id LIMIT 1").get();
    _target = _adm ? _adm.email : 'rmedina@jmcingenieria.cl';
    _newPass = 'Jmc2026.';
  }
  if (_target && _newPass) {
    const _u = _db.prepare('SELECT * FROM usuarios WHERE email=?').get(_target);
    if (_u) {
      _db.prepare('UPDATE usuarios SET password_hash=?, activo=1, token_version=COALESCE(token_version,0)+1 WHERE id=?')
        .run(_bcrypt.hashSync(_newPass, 10), _u.id);
      console.log('[RECUPERACION] Clave restablecida para ' + _target + '. Entra y cambiala. QUITA las variables ERP_RESET* en Render despues.');
    } else {
      console.log('[RECUPERACION] No existe usuario ' + _target);
    }
  }
} catch (e) { console.log('[RECUPERACION] error:', e.message); }

const app = express();
app.use(express.json({ limit: '15mb' }));

app.use('/api/usuarios', require('./users'));
app.use('/api/inventario', require('./inventory'));
app.use('/api/tesoreria', require('./treasury'));
app.use('/api/creditos', require('./loans'));
app.use('/api/flujo', require('./cashflow'));
app.use('/api/activos', require('./assets'));
app.use('/api/auditoria', require('./auditoria'));
app.use('/api/facturas', require('./facturas'));
app.use('/api/colaboradores', require('./colaboradores'));
app.use('/api/entregas', require('./entregas'));
app.use('/api/terceros', require('./terceros'));
app.use('/api/maquinarias', require('./maquinarias'));
app.use('/api/garantias', require('./garantias'));
app.use('/api/cajachica', require('./cajachica'));
app.use('/api/compras', require('./compras'));
app.use('/api/indicadores', require('./indicadores'));
app.use('/api/estados', require('./estados'));

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

const DB_PATH = process.env.ERP_DB || path.join(__dirname, '..', 'erp.db');

function checkpointDb() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const b = new DatabaseSync(DB_PATH);
    b.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    b.close();
  } catch (e) { /* si falla, seguimos con el archivo tal cual */ }
}

// === Respaldo protegido de la base de datos (datos + PDFs en BLOB) ===
app.get('/api/backup', (req, res) => {
  try {
    const token = req.query.token || req.get('x-backup-token');
    if (!process.env.BACKUP_TOKEN || token !== process.env.BACKUP_TOKEN) {
      return res.status(403).json({ error: 'forbidden' });
    }
    checkpointDb();
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="erp-backup.db"');
    require('fs').createReadStream(DB_PATH).pipe(res);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// === Auto-respaldo diario: el ERP EMPUJA su base ===
//  1) al cPanel (binario)         -> BACKUP_PUSH_URL
//  2) a Google Drive (base64)     -> BACKUP_DRIVE_URL (Apps Script Web App)
function autoBackupPush() {
  try {
    const fs = require('fs');
    checkpointDb();
    const data = fs.readFileSync(DB_PATH);
    const token = process.env.BACKUP_TOKEN || '';
    const filename = 'erp-' + new Date().toISOString().slice(0, 10) + '.db';

    const cpUrl = process.env.BACKUP_PUSH_URL || 'https://cotizaciones.jmcingenieria.cl/erp-backup-receiver.php';
    fetch(cpUrl, { method: 'POST', headers: { 'X-JMC-Token': token, 'Content-Type': 'application/octet-stream' }, body: data })
      .then(r => r.text()).then(t => console.log('[auto-backup cpanel]', t))
      .catch(e => console.warn('[auto-backup cpanel] fallo:', String(e)));

    const driveUrl = process.env.BACKUP_DRIVE_URL;
    if (driveUrl) {
      const b64 = data.toString('base64');
      fetch(driveUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, filename, b64 }) })
        .then(r => r.text()).then(t => console.log('[auto-backup drive]', t))
        .catch(e => console.warn('[auto-backup drive] fallo:', String(e)));
    }
  } catch (e) {
    console.warn('[auto-backup] error:', String(e));
  }
}

app.get('/js/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log('ERP JMC corriendo en http://localhost:' + PORT));
  setTimeout(autoBackupPush, 60 * 1000);
  setInterval(autoBackupPush, 24 * 60 * 60 * 1000);
}
module.exports = app;
