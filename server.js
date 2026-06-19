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

app.get('/js/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log('ERP JMC corriendo en http://localhost:' + PORT));
}
module.exports = app;
