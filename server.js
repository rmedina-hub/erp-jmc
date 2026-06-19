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

// === Respaldo protegido de la base de datos (datos + PDFs en BLOB) ===
// Uso: GET /api/backup?token=BACKUP_TOKEN  -> descarga erp.db
app.get('/api/backup', (req, res) => {
  try {
    const token = req.query.token || req.get('x-backup-token');
    if (!process.env.BACKUP_TOKEN || token !== process.env.BACKUP_TOKEN) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const dbPath = process.env.ERP_DB || path.join(__dirname, '..', 'erp.db');
    try {
      const { DatabaseSync } = require('node:sqlite');
      const b = new DatabaseSync(dbPath);
      b.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      b.close();
    } catch (e) { /* si falla el checkpoint, igual enviamos el archivo */ }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="erp-backup.db"');
    require('fs').createReadStream(dbPath).pipe(res);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/js/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log('ERP JMC corriendo en http://localhost:' + PORT));
}
module.exports = app;
