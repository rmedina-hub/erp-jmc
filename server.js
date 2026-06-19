const express = require('express');
const path = require('path');
require('./db'); // inicializa esquema + admin

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

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

const DB_PATH = process.env.ERP_DB || path.join(__dirname, '..', 'erp.db');

// Hace checkpoint del WAL para que el archivo erp.db quede completo y consistente
function checkpointDb() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const b = new DatabaseSync(DB_PATH);
    b.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    b.close();
  } catch (e) { /* si falla, seguimos con el archivo tal cual */ }
}

// === Respaldo protegido de la base de datos (datos + PDFs en BLOB) ===
// Uso: GET /api/backup?token=BACKUP_TOKEN  -> descarga erp.db
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

// === Auto-respaldo diario: el ERP EMPUJA su base al cPanel ===
// (el cPanel no puede salir a internet, por eso el ERP envia)
function autoBackupPush() {
  try {
    const fs = require('fs');
    checkpointDb();
    const data = fs.readFileSync(DB_PATH);
    const url = process.env.BACKUP_PUSH_URL || 'https://cotizaciones.jmcingenieria.cl/erp-backup-receiver.php';
    fetch(url, {
      method: 'POST',
      headers: { 'X-JMC-Token': process.env.BACKUP_TOKEN || '', 'Content-Type': 'application/octet-stream' },
      body: data
    })
      .then(r => r.text())
      .then(t => console.log('[auto-backup]', t))
      .catch(e => console.warn('[auto-backup] fallo envio:', String(e)));
  } catch (e) {
    console.warn('[auto-backup] error:', String(e));
  }
}

app.get('/js/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log('ERP JMC corriendo en http://localhost:' + PORT));
  // Primer respaldo ~1 min despues de arrancar, y luego cada 24 horas
  setTimeout(autoBackupPush, 60 * 1000);
  setInterval(autoBackupPush, 24 * 60 * 60 * 1000);
}
module.exports = app;
