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

CREATE TABLE IF NOT EXISTS activo_mantenciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL, km REAL, tipo TEXT, costo REAL NOT NULL DEFAULT 0, proximo_km REAL, glosa TEXT, empresa TEXT);

CREATE TABLE IF NOT EXISTS flujo_proyeccion (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, tipo TEXT NOT NULL,
  actividad TEXT NOT NULL DEFAULT 'OPERACIONAL', categoria TEXT, descripcion TEXT,
  monto REAL NOT NULL DEFAULT 0, probabilidad REAL NOT NULL DEFAULT 100, cliente TEXT,
  extra_contable INTEGER NOT NULL DEFAULT 0, empresa TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS facturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa TEXT, tipo TEXT NOT NULL DEFAULT 'COBRAR',
  contraparte TEXT, rut TEXT, numero TEXT, glosa TEXT,
  fecha_emision TEXT, fecha_vencimiento TEXT NOT NULL, monto REAL NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'PENDIENTE', fecha_pago TEXT, cuenta_id INTEGER, movimiento_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS archivos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa TEXT, entidad TEXT NOT NULL, entidad_id INTEGER NOT NULL,
  nombre TEXT, mime TEXT, contenido BLOB, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS colaboradores (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa TEXT, nombre TEXT NOT NULL, apellido TEXT, rut TEXT,
  cargo TEXT, activo INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS entregas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa TEXT, bodega_id INTEGER, colaborador_id INTEGER,
  tipo TEXT NOT NULL DEFAULT 'MATERIAL', producto_id INTEGER, descripcion TEXT, cantidad REAL NOT NULL DEFAULT 0,
  fecha_entrega TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'ENTREGADO', fecha_devolucion TEXT,
  movimiento_id INTEGER, glosa TEXT, usuario_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS terceros (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa TEXT, tipo TEXT NOT NULL DEFAULT 'PROVEEDOR',
  rut TEXT, nombre TEXT NOT NULL, giro TEXT, contacto TEXT, email TEXT, telefono TEXT, direccion TEXT,
  activo INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS solicitudes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa TEXT, numero TEXT, fecha TEXT NOT NULL,
  solicitante TEXT, bodega_id INTEGER, glosa TEXT, estado TEXT NOT NULL DEFAULT 'PENDIENTE',
  aprobada_por TEXT, fecha_aprob TEXT, usuario_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS solicitud_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, solicitud_id INTEGER NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
  producto_id INTEGER, descripcion TEXT, cantidad REAL NOT NULL DEFAULT 0, unidad TEXT);

CREATE TABLE IF NOT EXISTS cotizaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa TEXT, solicitud_id INTEGER, proveedor_id INTEGER,
  fecha TEXT, total REAL NOT NULL DEFAULT 0, plazo TEXT, glosa TEXT, seleccionada INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS ordenes_compra (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa TEXT, numero TEXT, fecha TEXT NOT NULL,
  proveedor_id INTEGER, solicitud_id INTEGER, cotizacion_id INTEGER, bodega_id INTEGER, glosa TEXT,
  neto REAL NOT NULL DEFAULT 0, iva REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
  condicion_pago TEXT, estado TEXT NOT NULL DEFAULT 'PENDIENTE', recibida TEXT NOT NULL DEFAULT 'NO',
  factura_id INTEGER, aprobada_por TEXT, fecha_aprob TEXT, usuario_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS oc_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, oc_id INTEGER NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  producto_id INTEGER, descripcion TEXT, cantidad REAL NOT NULL DEFAULT 0, precio_unitario REAL NOT NULL DEFAULT 0,
  cantidad_recibida REAL NOT NULL DEFAULT 0, unidad TEXT);

CREATE TABLE IF NOT EXISTS arriendos_maquinaria (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa TEXT, maquina TEXT NOT NULL, proveedor_id INTEGER,
  fecha_inicio TEXT, fecha_fin TEXT, periodo TEXT DEFAULT 'MES', costo_periodo REAL NOT NULL DEFAULT 0,
  obra TEXT, estado TEXT NOT NULL DEFAULT 'VIGENTE', fecha_devolucion TEXT, glosa TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS boletas_garantia (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa TEXT, tipo TEXT NOT NULL DEFAULT 'EMITIDA',
  numero TEXT, banco TEXT, beneficiario TEXT, glosa TEXT, monto REAL NOT NULL DEFAULT 0,
  fecha_emision TEXT, fecha_vencimiento TEXT, estado TEXT NOT NULL DEFAULT 'VIGENTE',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS caja_chica (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa TEXT, nombre TEXT NOT NULL, responsable TEXT,
  monto_asignado REAL NOT NULL DEFAULT 0, activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS caja_chica_mov (
  id INTEGER PRIMARY KEY AUTOINCREMENT, caja_id INTEGER NOT NULL REFERENCES caja_chica(id) ON DELETE CASCADE,
  empresa TEXT, fecha TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'GASTO', categoria TEXT, glosa TEXT,
  documento TEXT, monto REAL NOT NULL DEFAULT 0, usuario_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (datetime('now')),
  usuario_id INTEGER, usuario_nombre TEXT, usuario_email TEXT, rol TEXT, empresa TEXT,
  modulo TEXT, accion TEXT, detalle TEXT);

CREATE TABLE IF NOT EXISTS libro_iva (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa TEXT, clase TEXT NOT NULL,
  fecha TEXT NOT NULL, rut TEXT, razon_social TEXT, tipo_doc TEXT, folio TEXT,
  neto REAL NOT NULL DEFAULT 0, iva REAL NOT NULL DEFAULT 0, exento REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
  giro TEXT, origen TEXT DEFAULT 'MANUAL', created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS impuesto_config (
  empresa TEXT PRIMARY KEY, ppm_tasa REAL NOT NULL DEFAULT 0, iva_tasa REAL NOT NULL DEFAULT 19, remanente REAL NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS plan_cuentas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa TEXT,
  codigo TEXT NOT NULL, nombre TEXT NOT NULL, tipo TEXT NOT NULL,
  imputable INTEGER NOT NULL DEFAULT 1, activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS asientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa TEXT,
  numero INTEGER, fecha TEXT NOT NULL, glosa TEXT,
  tipo TEXT NOT NULL DEFAULT 'MANUAL', origen TEXT, ref TEXT,
  creado_por TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS asiento_lineas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, asiento_id INTEGER NOT NULL, empresa TEXT,
  cuenta_codigo TEXT NOT NULL, cuenta_nombre TEXT, glosa TEXT,
  debe REAL NOT NULL DEFAULT 0, haber REAL NOT NULL DEFAULT 0);

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
  "ALTER TABLE flujo_proyeccion ADD COLUMN empresa TEXT",
  "ALTER TABLE bodegas ADD COLUMN tipo TEXT",
  "ALTER TABLE usuarios ADD COLUMN bodega_id INTEGER",
  "ALTER TABLE activos ADD COLUMN vida_util_meses INTEGER DEFAULT 0",
  "ALTER TABLE activos ADD COLUMN valor_residual REAL DEFAULT 0",
  "ALTER TABLE activos ADD COLUMN depreciable INTEGER DEFAULT 0",
  "ALTER TABLE activos ADD COLUMN eliminado INTEGER DEFAULT 0",
  "ALTER TABLE activos ADD COLUMN eliminado_at TEXT",
  "ALTER TABLE activos ADD COLUMN eliminado_por TEXT",
  "ALTER TABLE activos ADD COLUMN mantencion_intervalo_km REAL DEFAULT 0",
  "ALTER TABLE activo_mantenciones ADD COLUMN empresa TEXT",
  "ALTER TABLE usuarios ADD COLUMN token_version INTEGER DEFAULT 0",
  "ALTER TABLE facturas ADD COLUMN neto REAL DEFAULT 0",
  "ALTER TABLE facturas ADD COLUMN iva REAL DEFAULT 0",
  "ALTER TABLE facturas ADD COLUMN exento REAL DEFAULT 0",
  "ALTER TABLE facturas ADD COLUMN giro TEXT",
  "ALTER TABLE facturas ADD COLUMN tipo_doc TEXT"
];
for (const sql of ADD_COLS) { try { db.exec(sql); } catch (e) {} }
// Seed de configuracion de impuestos por empresa (PPM)
try {
  db.exec("INSERT OR IGNORE INTO impuesto_config (empresa, ppm_tasa, iva_tasa, remanente) VALUES ('jmc', 3, 19, 0)");
  db.exec("INSERT OR IGNORE INTO impuesto_config (empresa, ppm_tasa, iva_tasa, remanente) VALUES ('trabancura', 12.7, 19, 0)");
} catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS ix_auditoria_emp_ts ON auditoria(empresa, ts)'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS ix_facturas_emp ON facturas(empresa, estado, fecha_vencimiento)'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS ix_archivos_ent ON archivos(entidad, entidad_id)'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS ix_entregas_emp ON entregas(empresa, bodega_id, estado)'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS ix_colab_emp ON colaboradores(empresa)'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS ix_terceros_emp ON terceros(empresa, tipo)'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS ix_solic_emp ON solicitudes(empresa, estado)'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS ix_oc_emp ON ordenes_compra(empresa, estado)'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS ix_garantias_emp ON boletas_garantia(empresa, estado)'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS ix_cajamov_emp ON caja_chica_mov(empresa, caja_id)'); } catch (e) {}

// ---- Backfill: todos los datos preexistentes (empresa NULL) pasan a JMC ----
const DATA_TABLES = ['bodegas', 'productos', 'inv_movimientos', 'cuentas_bancarias', 'tes_movimientos',
  'cartola_lineas', 'creditos', 'credito_cuotas', 'activos', 'activo_kilometrajes', 'activo_seguros',
  'activo_documentos', 'activo_mantenciones', 'flujo_proyeccion', 'libro_iva'];
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
    ['Johanna Palma', 'jpalma@jmcingenieria.cl', 'usuario', 'trabancura'],
    ['Mariana Duran', 'administracion1@jmcingenieria.cl', 'usuario', 'trabancura'],
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
    [['Robin Medina', null, 'rmedina@jmcingenieria.cl'], ['Johanna Palma', 'trabancura', 'jpalma@jmcingenieria.cl'],
     ['Mariana Duran', 'trabancura', 'administracion1@jmcingenieria.cl'], ['Genesis Valles', null, 'gvalles@jmcingenieria.cl'],
     ['Adrian Yanez', null, 'finanzas@jmcingenieria.cl'], ['Maria Isabel Slatter', null, 'administracion2@jmcingenieria.cl']
    ].forEach(u => upd.run(u[0], u[1], u[2]));
    db.prepare("UPDATE usuarios SET rol='admin' WHERE email='rmedina@jmcingenieria.cl'").run();
    db.prepare("DELETE FROM usuarios WHERE email='adrian@jmcingenieria.cl'").run();
    if (!db.prepare("SELECT 1 FROM _meta WHERE clave='fix_emp_trab_v1'").get()) {
      db.prepare("UPDATE usuarios SET token_version=COALESCE(token_version,0)+1 WHERE email IN ('jpalma@jmcingenieria.cl','administracion1@jmcingenieria.cl')").run();
      db.prepare("INSERT OR REPLACE INTO _meta (clave,valor) VALUES ('fix_emp_trab_v1', datetime('now'))").run();
    }
  } catch (e) {}
})();


(function seedPlanCuentas() {
  try {
    const PLAN = [
      ['1.1.01','Caja','ACTIVO'], ['1.1.02','Banco','ACTIVO'],
      ['1.1.03','Clientes (CxC)','ACTIVO'], ['1.1.04','IVA Credito Fiscal','ACTIVO'],
      ['1.1.05','PPM','ACTIVO'], ['1.1.06','Existencias / Inventario','ACTIVO'],
      ['1.2.01','Activo Fijo','ACTIVO'], ['1.2.02','Depreciacion Acumulada','ACTIVO'],
      ['2.1.01','Proveedores (CxP)','PASIVO'], ['2.1.02','IVA Debito Fiscal','PASIVO'],
      ['2.1.03','PPM por Pagar','PASIVO'], ['2.1.04','Honorarios / Retenciones por Pagar','PASIVO'],
      ['2.1.05','Remuneraciones por Pagar','PASIVO'], ['2.1.06','Impuesto Renta por Pagar','PASIVO'],
      ['2.2.01','Prestamos / Leasing por Pagar','PASIVO'],
      ['3.1.01','Capital','PATRIMONIO'], ['3.1.02','Resultados Acumulados','PATRIMONIO'],
      ['3.1.03','Resultado del Ejercicio','PATRIMONIO'],
      ['4.1.01','Ventas / Ingresos por Servicios','INGRESO'], ['4.1.02','Otros Ingresos','INGRESO'],
      ['5.1.01','Costo de Ventas','GASTO'], ['5.2.01','Remuneraciones','GASTO'],
      ['5.2.02','Honorarios','GASTO'], ['5.2.03','Arriendos','GASTO'],
      ['5.2.04','Servicios Basicos','GASTO'], ['5.2.05','Gastos Generales','GASTO'],
      ['5.2.06','Depreciacion','GASTO'], ['5.2.07','Gastos Financieros','GASTO']
    ];
    const ins = db.prepare('INSERT INTO plan_cuentas (empresa,codigo,nombre,tipo,imputable) VALUES (?,?,?,?,1)');
    for (const emp of ['jmc','trabancura']) {
      const n = db.prepare('SELECT COUNT(*) c FROM plan_cuentas WHERE empresa=?').get(emp).c;
      if (!n) for (const [cod,nom,tipo] of PLAN) ins.run(emp, cod, nom, tipo);
    }
  } catch (e) {}
})();

module.exports = db;
