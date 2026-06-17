const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.ERP_DB || path.join(__dirname, '..', 'erp.db');
const raw = new DatabaseSync(DB_PATH);
try { raw.exec('PRAGMA journal_mode = WAL;'); } catch (e) {}
raw.exec('PRAGMA foreign_keys = ON;');

// Wrapper para mantener API estilo better-sqlite3 (prepare/get/all/run + transaction)
const db = {
  prepare: (sql) => raw.prepare(sql),
  exec: (sql) => raw.exec(sql),
  pragma: (p) => raw.exec('PRAGMA ' + p + ';'),
  transaction: (fn) => (...args) => {
    raw.exec('BEGIN');
    try { const r = fn(...args); raw.exec('COMMIT'); return r; }
    catch (e) { try { raw.exec('ROLLBACK'); } catch {} throw e; }
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, rol TEXT NOT NULL DEFAULT 'usuario', activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS bodegas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, ubicacion TEXT);

CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL,
  unidad TEXT NOT NULL DEFAULT 'UN', stock REAL NOT NULL DEFAULT 0, costo_promedio REAL NOT NULL DEFAULT 0,
  stock_minimo REAL NOT NULL DEFAULT 0, activo INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS inv_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL,
  producto_id INTEGER NOT NULL REFERENCES productos(id), bodega_id INTEGER NOT NULL REFERENCES bodegas(id),
  tipo TEXT NOT NULL, cantidad REAL NOT NULL, costo_unitario REAL NOT NULL DEFAULT 0, costo_total REAL NOT NULL DEFAULT 0,
  saldo_cantidad REAL NOT NULL DEFAULT 0, saldo_costo_prom REAL NOT NULL DEFAULT 0, saldo_valor REAL NOT NULL DEFAULT 0,
  documento TEXT, glosa TEXT, usuario_id INTEGER REFERENCES usuarios(id), created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS cuentas_bancarias (
  id INTEGER PRIMARY KEY AUTOINCREMENT, banco TEXT NOT NULL, nombre TEXT NOT NULL, numero TEXT,
  moneda TEXT NOT NULL DEFAULT 'CLP', saldo_inicial REAL NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS tes_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, cuenta_id INTEGER NOT NULL REFERENCES cuentas_bancarias(id),
  tipo TEXT NOT NULL, categoria TEXT, monto REAL NOT NULL, glosa TEXT, documento TEXT,
  conciliado INTEGER NOT NULL DEFAULT 0, cartola_linea_id INTEGER, credito_cuota_id INTEGER,
  usuario_id INTEGER REFERENCES usuarios(id), created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS cartola_lineas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cuenta_id INTEGER NOT NULL REFERENCES cuentas_bancarias(id),
  fecha TEXT NOT NULL, descripcion TEXT, cargo REAL NOT NULL DEFAULT 0, abono REAL NOT NULL DEFAULT 0,
  saldo REAL, conciliado INTEGER NOT NULL DEFAULT 0, movimiento_id INTEGER, lote_importacion TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS creditos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, banco TEXT NOT NULL, nombre TEXT NOT NULL, monto REAL NOT NULL,
  tasa_mensual REAL NOT NULL, n_cuotas INTEGER NOT NULL, sistema TEXT NOT NULL DEFAULT 'FRANCES',
  fecha_inicio TEXT NOT NULL, cuenta_id INTEGER REFERENCES cuentas_bancarias(id), estado TEXT NOT NULL DEFAULT 'VIGENTE',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS credito_cuotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, credito_id INTEGER NOT NULL REFERENCES creditos(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL, fecha_venc TEXT NOT NULL, cuota REAL NOT NULL, interes REAL NOT NULL,
  amortizacion REAL NOT NULL, saldo REAL NOT NULL, pagado INTEGER NOT NULL DEFAULT 0, fecha_pago TEXT, movimiento_id INTEGER);

CREATE TABLE IF NOT EXISTS activos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, categoria TEXT,
  marca TEXT, modelo TEXT, patente TEXT, fecha_compra TEXT, valor_compra REAL NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'ACTIVO', created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS activo_kilometrajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL, km REAL NOT NULL, glosa TEXT);

CREATE TABLE IF NOT EXISTS activo_seguros (
  id INTEGER PRIMARY KEY AUTOINCREMENT, activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  compania TEXT, poliza TEXT, fecha_inicio TEXT, fecha_vencimiento TEXT NOT NULL, prima REAL NOT NULL DEFAULT 0, glosa TEXT);

CREATE TABLE IF NOT EXISTS activo_documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, numero TEXT, fecha_emision TEXT, fecha_vencimiento TEXT NOT NULL, glosa TEXT);

CREATE TABLE IF NOT EXISTS flujo_proyeccion (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, tipo TEXT NOT NULL,
  actividad TEXT NOT NULL DEFAULT 'OPERACIONAL', categoria TEXT, descripcion TEXT,
  monto REAL NOT NULL DEFAULT 0, probabilidad REAL NOT NULL DEFAULT 100, cliente TEXT,
  extra_contable INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`);

try { db.exec('ALTER TABLE usuarios ADD COLUMN empresa TEXT'); } catch (e) {}
try { db.exec("ALTER TABLE creditos ADD COLUMN tipo TEXT DEFAULT 'CREDITO'"); } catch (e) {}
try { db.exec('ALTER TABLE creditos ADD COLUMN pie REAL DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE creditos ADD COLUMN iva_pct REAL DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE credito_cuotas ADD COLUMN iva REAL DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE credito_cuotas ADD COLUMN cuota_neta REAL DEFAULT 0'); } catch (e) {}


(function ensureUsuariosIniciales() {
  const tmp = bcrypt.hashSync('Jmc2026.', 10);
  const users = [
    ['R. Medina', 'rmedina@jmcingenieria.cl', 'admin'],
    ['J. Palma', 'jpalma@jmcingenieria.cl', 'usuario'],
    ['Administracion 1', 'administracion1@jmcingenieria.cl', 'usuario'],
    ['G. Valles', 'gvalles@jmcingenieria.cl', 'usuario'],
    ['Finanzas', 'finanzas@jmcingenieria.cl', 'usuario'],
    ['Administracion 2', 'administracion2@jmcingenieria.cl', 'usuario']
  ];
  const existe = db.prepare('SELECT 1 FROM usuarios WHERE email=?');
  const ins = db.prepare('INSERT INTO usuarios (nombre,email,password_hash,rol,empresa) VALUES (?,?,?,?,?)');
  for (const [nombre, email, rol] of users) {
    if (!existe.get(email)) ins.run(nombre, email, tmp, rol, 'jmc');
  }
})();

module.exports = db;
