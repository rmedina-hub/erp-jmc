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

// NOTA: las tablas de datos llevan columna `empresa` para aislar la informacion
// de cada compania (jmc / trabancura). La unicidad de sku/codigo es POR empresa
// (indices compuestos), no global, para que ambas empresas puedan usar sus
// propios codigos sin colisionar.
db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, rol TEXT NOT NULL DEFAULT 'usuario', activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS bodegas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL, nombre TEXT NOT NULL, ubicacion TEXT, empresa TEXT);

CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL, nombre TEXT NOT NULL,
  unidad TEXT NOT NULL DEFAULT 'UN', stock REAL NOT NULL DEFAULT 0, costo_promedio REAL NOT NULL DEFAULT 0,
  stock_minimo REAL NOT NULL DEFAULT 0, activo INTEGER NOT NULL DEFAULT 1, empresa TEXT);

CREATE TABLE IF NOT EXISTS inv_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL,
  producto_id INTEGER NOT NULL REFERENCES productos(id), bodega_id INTEGER NOT NULL REFERENCES bodegas(id),
  tipo TEXT NOT NULL, cantidad REAL NOT NULL, costo_unitario REAL NOT NULL DEFAULT 0, costo_total REAL NOT NULL DEFAULT 0,
  saldo_cantidad REAL NOT NULL DEFAULT 0, saldo_costo_prom REAL NOT NULL DEFAULT 0, saldo_valor REAL NOT NULL DEFAULT 0,
  documento TEXT, glosa TEXT, usuario_id INTEGER REFERENCES usuarios(id), empresa TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS cuentas_bancarias (
  id INTEGER PRIMARY KEY AUTOINCREMENT, banco TEXT NOT NULL, nombre TEXT NOT NULL, numero TEXT,
  moneda TEXT NOT NULL DEFAULT 'CLP', saldo_inicial REAL NOT NULL DEFAULT 0, empresa TEXT);

CREATE TABLE IF NOT EXISTS tes_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, cuenta_id INTEGER NOT NULL REFERENCES cuentas_bancarias(id),
  tipo TEXT NOT NULL, categoria TEXT, monto REAL NOT NULL, glosa TEXT, documento TEXT,
  conciliado INTEGER NOT NULL DEFAULT 0, cartola_linea_id INTEGER, credito_cuota_id INTEGER,
  usuario_id INTEGER REFERENCES usuarios(id), empresa TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS cartola_lineas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cuenta_id INTEGER NOT NULL REFERENCES cuentas_bancarias(id),
  fecha TEXT NOT NULL, descripcion TEXT, cargo REAL NOT NULL DEFAULT 0, abono REAL NOT NULL DEFAULT 0,
  saldo REAL, conciliado INTEGER NOT NULL DEFAULT 0, movimiento_id INTEGER, lote_importacion TEXT,
  empresa TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS creditos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, banco TEXT NOT NULL, nombre TEXT NOT NULL, monto REAL NOT NULL,
  tasa_mensual REAL NOT NULL, n_cuotas INTEGER NOT NULL, sistema TEXT NOT NULL DEFAULT 'FRANCES',
  fecha_inicio TEXT NOT NULL, cuenta_id INTEGER REFERENCES cuentas_bancarias(id), estado TEXT NOT NULL DEFAULT 'VIGENTE',
  empresa TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS credito_cuotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, credito_id INTEGER NOT NULL REFERENCES creditos(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL, fecha_venc TEXT NOT NULL, cuota REAL NOT NULL, interes REAL NOT NULL,
  amortizacion REAL NOT NULL, saldo REAL NOT NULL, pagado INTEGER NOT NULL DEFAULT 0, fecha_pago TEXT, movimiento_id INTEGER, empresa TEXT);

CREATE TABLE IF NOT EXISTS activos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL, nombre TEXT NOT NULL, categoria TEXT,
  marca TEXT, modelo TEXT, patente TEXT, fecha_compra TEXT, valor_compra REAL NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'ACTIVO', empresa TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS activo_kilometrajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL, km REAL NOT NULL, glosa TEXT, empresa TEXT);

CREATE TABLE IF NOT EXISTS activo_seguros (
  id INTEGER PRIMARY KEY AUTOINCREMENT, activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  compania TEXT, poliza TEXT, fecha_inicio TEXT, fecha_vencimiento TEXT NOT NULL, prima REAL NOT NULL DEFAULT 0, glosa TEXT, empresa TEXT);

CREATE TABLE IF NOT EXISTS activo_documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, numero TEXT, fecha_emision TEXT, fecha_vencimiento TEXT NOT NULL, glosa TEXT, empresa TEXT);

CREATE TABLE IF NOT EXISTS flujo_proyeccion (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, tipo TEXT NOT NULL,
  actividad TEXT NOT NULL DEFAULT 'OPERACIONAL', categoria TEXT, descripcion TEXT,
  monto REAL NOT NULL DEFAULT 0, probabilidad REAL NOT NULL DEFAULT 100, cliente TEXT,
  extra_contable INTEGER NOT NULL DEFAULT 0, empresa TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (datetime('now')),
  usuario_id INTEGER, usuario_nombre TEXT, usuario_email TEXT, rol TEXT, empresa TEXT,
  modulo TEXT, accion TEXT, detalle TEXT);

CREATE TABLE IF NOT EXISTS _meta (clave TEXT PRIMARY KEY, valor TEXT);
`);

// ---- Migraciones de columnas (instalaciones previas) ----
const ADD_COLS = [
  "ALTER TABLE usuarios ADD COLUMN empresa TEXT",
  "ALTER TABLE creditos ADD COLUMN tipo TEXT DEFAULT 'CREDITO'",
  "ALTER TABLE creditos ADD COLUMN pie REAL DEFAULT 0",
  "ALTER TABLE creditos ADD COLUMN iva_pct REAL DEFAULT 0",
  "ALTER TABLE creditos ADD COLUMN glosa TEXT",
  "ALTER TABLE activos ADD COLUMN proveedor TEXT",
  "ALTER TABLE activos ADD COLUMN factura TEXT",
  "ALTER TABLE credito_cuotas ADD COLUMN iva REAL DEFAULT 0",
  "ALTER TABLE credito_cuotas ADD COLUMN cuota_neta REAL DEFAULT 0",
  "ALTER TABLE bodegas ADD COLUMN empresa TEXT",
  "ALTER TABLE productos ADD COLUMN empresa TEXT",
  "ALTER TABLE inv_movimientos ADD COLUMN empresa TEXT",
  "ALTER TABLE cuentas_bancarias ADD COLUMN empresa TEXT",
  "ALTER TABLE tes_movimientos ADD COLUMN empresa TEXT",
  "ALTER TABLE cartola_lineas ADD COLUMN empresa TEXT",
  "ALTER TABLE creditos ADD COLUMN empresa TEXT",
  "ALTER TABLE credito_cuotas ADD COLUMN empresa TEXT",
  "ALTER TABLE activos ADD COLUMN empresa TEXT",
  "ALTER TABLE activo_kilometrajes ADD COLUMN empresa TEXT",
  "ALTER TABLE activo_seguros ADD COLUMN empresa TEXT",
  "ALTER TABLE activo_documentos ADD COLUMN empresa TEXT",
  "ALTER TABLE flujo_proyeccion ADD COLUMN empresa TEXT"
];
for (const sql of ADD_COLS) { try { db.exec(sql); } catch (e) {} }
try { db.exec('CREATE INDEX IF NOT EXISTS ix_auditoria_emp_ts ON auditoria(empresa, ts)'); } catch (e) {}

// ---- Backfill: todos los datos preexistentes (empresa NULL) pasan a JMC ----
const DATA_TABLES = ['bodegas', 'productos', 'inv_movimientos', 'cuentas_bancarias', 'tes_movimientos',
  'cartola_lineas', 'creditos', 'credito_cuotas', 'activos', 'activo_kilometrajes', 'activo_seguros',
  'activo_documentos', 'flujo_proyeccion'];
(function backfillEmpresa() {
  const done = db.prepare("SELECT valor FROM _meta WHERE clave='backfill_empresa'").get();
  if (done) return;
  try {
    for (const t of DATA_TABLES) {
      try { db.exec(`UPDATE ${t} SET empresa='jmc' WHERE empresa IS NULL OR empresa=''`); } catch (e) {}
    }
    db.prepare("INSERT OR REPLACE INTO _meta (clave,valor) VALUES ('backfill_empresa', datetime('now'))").run();
  } catch (e) {}
})();

// ---- Indices de unicidad POR empresa (sku / codigo) ----
(function rebuildUniqueTables() {
  const done = db.prepare("SELECT valor FROM _meta WHERE clave='rebuild_unique_v1'").get();
  if (done) return;

  let needsRebuild = false;
  try {
    const idxList = db.prepare("PRAGMA index_list('productos')").all();
    for (const ix of idxList) {
      if (ix.origin === 'u') {
        const cols = db.prepare(`PRAGMA index_info('${ix.name}')`).all().map(c => c.name);
        if (cols.length === 1 && cols[0] === 'sku') needsRebuild = true;
      }
    }
  } catch (e) {}

  if (needsRebuild) {
    try {
      raw.exec('PRAGMA foreign_keys=OFF;');
      raw.exec('BEGIN');
      raw.exec(`CREATE TABLE productos_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL, nombre TEXT NOT NULL,
        unidad TEXT NOT NULL DEFAULT 'UN', stock REAL NOT NULL DEFAULT 0, costo_promedio REAL NOT NULL DEFAULT 0,
        stock_minimo REAL NOT NULL DEFAULT 0, activo INTEGER NOT NULL DEFAULT 1, empresa TEXT);`);
      raw.exec(`INSERT INTO productos_new (id,sku,nombre,unidad,stock,costo_promedio,stock_minimo,activo,empresa)
        SELECT id,sku,nombre,unidad,stock,costo_promedio,stock_minimo,activo,COALESCE(empresa,'jmc') FROM productos;`);
      raw.exec('DROP TABLE productos;');
      raw.exec('ALTER TABLE productos_new RENAME TO productos;');
      raw.exec(`CREATE TABLE bodegas_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL, nombre TEXT NOT NULL, ubicacion TEXT, empresa TEXT);`);
      raw.exec(`INSERT INTO bodegas_new (id,codigo,nombre,ubicacion,empresa)
        SELECT id,codigo,nombre,ubicacion,COALESCE(empresa,'jmc') FROM bodegas;`);
      raw.exec('DROP TABLE bodegas;');
      raw.exec('ALTER TABLE bodegas_new RENAME TO bodegas;');
      raw.exec(`CREATE TABLE activos_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL, nombre TEXT NOT NULL, categoria TEXT,
        marca TEXT, modelo TEXT, patente TEXT, fecha_compra TEXT, valor_compra REAL NOT NULL DEFAULT 0,
        estado TEXT NOT NULL DEFAULT 'ACTIVO', proveedor TEXT, factura TEXT, empresa TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
      raw.exec(`INSERT INTO activos_new (id,codigo,nombre,categoria,marca,modelo,patente,fecha_compra,valor_compra,estado,proveedor,factura,empresa,created_at)
        SELECT id,codigo,nombre,categoria,marca,modelo,patente,fecha_compra,valor_compra,estado,proveedor,factura,COALESCE(empresa,'jmc'),created_at FROM activos;`);
      raw.exec('DROP TABLE activos;');
      raw.exec('ALTER TABLE activos_new RENAME TO activos;');
      raw.exec('COMMIT');
    } catch (e) {
      try { raw.exec('ROLLBACK'); } catch {}
    } finally {
      try { raw.exec('PRAGMA foreign_keys=ON;'); } catch {}
    }
  }

  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_productos_emp_sku ON productos(empresa, sku)"); } catch (e) {}
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_bodegas_emp_codigo ON bodegas(empresa, codigo)"); } catch (e) {}
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_activos_emp_codigo ON activos(empresa, codigo)"); } catch (e) {}

  try { db.prepare("INSERT OR REPLACE INTO _meta (clave,valor) VALUES ('rebuild_unique_v1', datetime('now'))").run(); } catch (e) {}
})();

(function ensureUsuariosIniciales() {
  const tmp = bcrypt.hashSync('Jmc2026.', 10);
  const users = [
    ['Robin Medina', 'rmedina@jmcingenieria.cl', 'admin', 'jmc'],
    ['Johanna Palma', 'jpalma@jmcingenieria.cl', 'usuario', 'jmc'],
    ['Mariana Duran', 'administracion1@jmcingenieria.cl', 'usuario', 'jmc'],
    ['Genesis Valles', 'gvalles@jmcingenieria.cl', 'usuario', 'jmc'],
    ['Adrian Yanez', 'finanzas@jmcingenieria.cl', 'usuario', null],
    ['Maria Isabel Slatter', 'administracion2@jmcingenieria.cl', 'usuario', 'jmc']
  ];
  const existe = db.prepare('SELECT 1 FROM usuarios WHERE email=?');
  const ins = db.prepare('INSERT INTO usuarios (nombre,email,password_hash,rol,empresa) VALUES (?,?,?,?,?)');
  for (const [nombre, email, rol, empresa] of users) {
    if (!existe.get(email)) ins.run(nombre, email, tmp, rol, empresa);
  }
})();

(function fixUsuarios() {
  try {
    const upd = db.prepare('UPDATE usuarios SET nombre=?, empresa=? WHERE email=?');
    [['Robin Medina', null, 'rmedina@jmcingenieria.cl'], ['Johanna Palma', 'jmc', 'jpalma@jmcingenieria.cl'],
     ['Mariana Duran', 'jmc', 'administracion1@jmcingenieria.cl'], ['Genesis Valles', null, 'gvalles@jmcingenieria.cl'],
     ['Adrian Yanez', null, 'finanzas@jmcingenieria.cl'], ['Maria Isabel Slatter', null, 'administracion2@jmcingenieria.cl']
    ].forEach(u => upd.run(u[0], u[1], u[2]));
    // Robin es administrador de ambas empresas
    db.prepare("UPDATE usuarios SET rol='admin' WHERE email='rmedina@jmcingenieria.cl'").run();
    db.prepare("DELETE FROM usuarios WHERE email='adrian@jmcingenieria.cl'").run();
  } catch (e) {}
})();

module.exports = db;
