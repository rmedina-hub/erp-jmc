const express = require('express');
const db = require('./db');
const { auth } = require('./auth');
const { audit } = require('./audit');
const router = express.Router();
router.use(auth);

// helper: verifica que la cuenta pertenezca a la empresa activa
function cuentaDeEmpresa(id, empresa) {
  return db.prepare('SELECT * FROM cuentas_bancarias WHERE id=? AND empresa=?').get(id, empresa);
}

// ---------- Cuentas ----------
router.get('/cuentas', (req, res) => {
  const cuentas = db.prepare('SELECT * FROM cuentas_bancarias WHERE empresa=? ORDER BY banco, nombre').all(req.empresa);
  for (const c of cuentas) {
    const ing = db.prepare(`SELECT COALESCE(SUM(monto),0) s FROM tes_movimientos WHERE cuenta_id=? AND tipo='INGRESO'`).get(c.id).s;
    const egr = db.prepare(`SELECT COALESCE(SUM(monto),0) s FROM tes_movimientos WHERE cuenta_id=? AND tipo='EGRESO'`).get(c.id).s;
    c.saldo_actual = c.saldo_inicial + ing - egr;
    c.total_ingresos = ing; c.total_egresos = egr;
  }
  res.json(cuentas);
});
router.post('/cuentas', (req, res) => {
  const { banco, nombre, numero, moneda, saldo_inicial } = req.body;
  if (!banco || !nombre) return res.status(400).json({ error: 'banco y nombre requeridos' });
  const r = db.prepare('INSERT INTO cuentas_bancarias (banco,nombre,numero,moneda,saldo_inicial,empresa) VALUES (?,?,?,?,?,?)')
    .run(banco, nombre, numero || null, moneda || 'CLP', Number(saldo_inicial) || 0, req.empresa);
  audit(req, 'Tesoreria', 'Crear cuenta', banco + ' - ' + nombre);
  res.json(db.prepare('SELECT * FROM cuentas_bancarias WHERE id=?').get(r.lastInsertRowid));
});
router.put('/cuentas/:id', (req, res) => {
  const b = req.body;
  const c = cuentaDeEmpresa(req.params.id, req.empresa);
  if (!c) return res.status(404).json({ error: 'No existe' });
  db.prepare('UPDATE cuentas_bancarias SET banco=?, nombre=?, numero=?, moneda=?, saldo_inicial=? WHERE id=? AND empresa=?')
    .run(b.banco != null ? b.banco : c.banco, b.nombre != null ? b.nombre : c.nombre,
      b.numero != null ? b.numero : c.numero, b.moneda || c.moneda,
      b.saldo_inicial != null ? Number(b.saldo_inicial) : c.saldo_inicial, req.params.id, req.empresa);
  audit(req, 'Tesoreria', 'Editar cuenta / saldo inicial', (b.banco != null ? b.banco : c.banco) + ' - saldo ' + (b.saldo_inicial != null ? Number(b.saldo_inicial) : c.saldo_inicial));
  res.json(db.prepare('SELECT * FROM cuentas_bancarias WHERE id=?').get(req.params.id));
});

// ---------- Movimientos (ingresos / egresos) ----------
router.get('/movimientos', (req, res) => {
  const { cuenta_id, conciliado } = req.query;
  let sql = `SELECT m.*, c.banco, c.nombre AS cuenta FROM tes_movimientos m JOIN cuentas_bancarias c ON c.id=m.cuenta_id WHERE m.empresa=?`;
  const p = [req.empresa];
  if (cuenta_id) { sql += ' AND m.cuenta_id=?'; p.push(cuenta_id); }
  if (conciliado === '0' || conciliado === '1') { sql += ' AND m.conciliado=?'; p.push(conciliado); }
  sql += ' ORDER BY m.fecha DESC, m.id DESC LIMIT 1000';
  res.json(db.prepare(sql).all(...p));
});
router.post('/movimientos', (req, res) => {
  const { fecha, cuenta_id, tipo, categoria, monto, glosa, documento } = req.body;
  if (!cuenta_id || !tipo || !monto) return res.status(400).json({ error: 'cuenta, tipo y monto requeridos' });
  if (!['INGRESO', 'EGRESO'].includes(tipo)) return res.status(400).json({ error: 'tipo invalido' });
  if (!cuentaDeEmpresa(cuenta_id, req.empresa)) return res.status(400).json({ error: 'cuenta no pertenece a la empresa' });
  const r = db.prepare(`INSERT INTO tes_movimientos (fecha,cuenta_id,tipo,categoria,monto,glosa,documento,usuario_id,empresa)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(fecha || new Date().toISOString().slice(0,10), cuenta_id, tipo,
    categoria || null, Math.abs(Number(monto)), glosa || null, documento || null, req.user.id, req.empresa);
  audit(req, 'Tesoreria', tipo, Math.abs(Number(monto)) + (glosa ? ' - ' + glosa : ''));
  res.json(db.prepare('SELECT * FROM tes_movimientos WHERE id=?').get(r.lastInsertRowid));
});
router.delete('/movimientos/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM tes_movimientos WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!m) return res.status(404).json({ error: 'No existe' });
  db.prepare('UPDATE cartola_lineas SET conciliado=0, movimiento_id=NULL WHERE movimiento_id=?').run(req.params.id);
  db.prepare('DELETE FROM tes_movimientos WHERE id=? AND empresa=?').run(req.params.id, req.empresa);
  audit(req, 'Tesoreria', 'Eliminar movimiento', m.tipo + ' ' + m.monto + (m.glosa ? ' - ' + m.glosa : ''));
  res.json({ ok: true });
});

// ---------- Importar cartola ----------
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const header = lines[0].split(sep).map(h => h.trim().toLowerCase());
  const idx = (names) => header.findIndex(h => names.some(n => h.includes(n)));
  const iFecha = idx(['fecha']);
  const iDesc = idx(['descrip', 'glosa', 'detalle', 'concepto']);
  const iCargo = idx(['cargo', 'debito', 'débito', 'giro']);
  const iAbono = idx(['abono', 'credito', 'crédito', 'deposito', 'depósito']);
  const iMonto = idx(['monto', 'importe']);
  const iSaldo = idx(['saldo']);
  const num = (s) => {
    if (s == null) return 0;
    let v = String(s).replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    return Number(v) || 0;
  };
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(sep);
    let cargo = iCargo >= 0 ? num(c[iCargo]) : 0;
    let abono = iAbono >= 0 ? num(c[iAbono]) : 0;
    if (iMonto >= 0 && !cargo && !abono) {
      const m = num(c[iMonto]);
      if (m < 0) cargo = Math.abs(m); else abono = m;
    }
    out.push({
      fecha: (iFecha >= 0 ? c[iFecha] : '').trim(),
      descripcion: (iDesc >= 0 ? c[iDesc] : '').trim(),
      cargo, abono,
      saldo: iSaldo >= 0 ? num(c[iSaldo]) : null
    });
  }
  return out;
}

router.post('/cartola/import', (req, res) => {
  const { cuenta_id } = req.body;
  if (!cuenta_id) return res.status(400).json({ error: 'cuenta_id requerido' });
  if (!cuentaDeEmpresa(cuenta_id, req.empresa)) return res.status(400).json({ error: 'cuenta no pertenece a la empresa' });
  let lineas = req.body.lineas;
  if (!lineas && req.body.csv) lineas = parseCSV(req.body.csv);
  if (!Array.isArray(lineas) || !lineas.length) return res.status(400).json({ error: 'No se reconocieron lineas en la cartola' });
  const lote = 'IMP-' + Date.now();
  const ins = db.prepare(`INSERT INTO cartola_lineas (cuenta_id,fecha,descripcion,cargo,abono,saldo,lote_importacion,empresa) VALUES (?,?,?,?,?,?,?,?)`);
  // Evita duplicados: no reinserta una linea identica ya existente para la misma cuenta
  const existe = db.prepare(`SELECT 1 FROM cartola_lineas WHERE empresa=? AND cuenta_id=? AND IFNULL(fecha,'')=? AND IFNULL(descripcion,'')=? AND cargo=? AND abono=?`);
  let importadas = 0, omitidas = 0;
  const tx = db.transaction((arr) => {
    for (const l of arr) {
      const fecha = l.fecha || null, desc = l.descripcion || null;
      const cargo = Number(l.cargo) || 0, abono = Number(l.abono) || 0;
      if (existe.get(req.empresa, cuenta_id, fecha || '', desc || '', cargo, abono)) { omitidas++; continue; }
      ins.run(cuenta_id, fecha, desc, cargo, abono, l.saldo == null ? null : Number(l.saldo), lote, req.empresa);
      importadas++;
    }
  });
  tx(lineas);
  audit(req, 'Tesoreria', 'Importar cartola', importadas + ' importadas, ' + omitidas + ' omitidas (cuenta ' + cuenta_id + ')');
  res.json({ ok: true, importadas, omitidas, lote });
});

router.get('/cartola', (req, res) => {
  const { cuenta_id, conciliado } = req.query;
  let sql = 'SELECT * FROM cartola_lineas WHERE empresa=?';
  const p = [req.empresa];
  if (cuenta_id) { sql += ' AND cuenta_id=?'; p.push(cuenta_id); }
  if (conciliado === '0' || conciliado === '1') { sql += ' AND conciliado=?'; p.push(conciliado); }
  sql += ' ORDER BY fecha, id';
  res.json(db.prepare(sql).all(...p));
});

// ---------- Conciliacion ----------
function diffDias(a, b) {
  const da = new Date(a), db_ = new Date(b);
  if (isNaN(da) || isNaN(db_)) return 9999;
  return Math.abs((da - db_) / 86400000);
}

router.get('/conciliacion', (req, res) => {
  const { cuenta_id } = req.query;
  if (!cuenta_id) return res.status(400).json({ error: 'cuenta_id requerido' });
  const lineas = db.prepare('SELECT * FROM cartola_lineas WHERE cuenta_id=? AND empresa=? AND conciliado=0 ORDER BY fecha,id').all(cuenta_id, req.empresa);
  const movs = db.prepare('SELECT * FROM tes_movimientos WHERE cuenta_id=? AND empresa=? AND conciliado=0 ORDER BY fecha,id').all(cuenta_id, req.empresa);
  res.json({ lineas, movimientos: movs });
});

router.post('/conciliacion/auto', (req, res) => {
  const { cuenta_id, tolerancia_dias } = req.body;
  const tol = Number(tolerancia_dias) || 5;
  if (!cuenta_id) return res.status(400).json({ error: 'cuenta_id requerido' });
  const lineas = db.prepare('SELECT * FROM cartola_lineas WHERE cuenta_id=? AND empresa=? AND conciliado=0').all(cuenta_id, req.empresa);
  const movs = db.prepare('SELECT * FROM tes_movimientos WHERE cuenta_id=? AND empresa=? AND conciliado=0').all(cuenta_id, req.empresa);
  let conciliadas = 0;
  const tx = db.transaction(() => {
    for (const l of lineas) {
      const esIngreso = l.abono > 0;
      const monto = esIngreso ? l.abono : l.cargo;
      const tipo = esIngreso ? 'INGRESO' : 'EGRESO';
      let mejor = null, mejorDif = Infinity;
      for (const m of movs) {
        if (m._usado) continue;
        if (m.tipo !== tipo) continue;
        if (Math.abs(m.monto - monto) > 0.5) continue;
        const d = diffDias(l.fecha, m.fecha);
        if (d <= tol && d < mejorDif) { mejor = m; mejorDif = d; }
      }
      if (mejor) {
        db.prepare('UPDATE tes_movimientos SET conciliado=1, cartola_linea_id=? WHERE id=?').run(l.id, mejor.id);
        db.prepare('UPDATE cartola_lineas SET conciliado=1, movimiento_id=? WHERE id=?').run(mejor.id, l.id);
        mejor._usado = true; conciliadas++;
      }
    }
  });
  tx();
  audit(req, 'Tesoreria', 'Conciliacion automatica', conciliadas + ' conciliadas (cuenta ' + cuenta_id + ')');
  res.json({ ok: true, conciliadas });
});

router.post('/conciliacion/manual', (req, res) => {
  const { cartola_linea_id, movimiento_id } = req.body;
  const l = db.prepare('SELECT id FROM cartola_lineas WHERE id=? AND empresa=?').get(cartola_linea_id, req.empresa);
  const m = db.prepare('SELECT id FROM tes_movimientos WHERE id=? AND empresa=?').get(movimiento_id, req.empresa);
  if (!l || !m) return res.status(404).json({ error: 'Linea o movimiento no encontrado' });
  db.prepare('UPDATE tes_movimientos SET conciliado=1, cartola_linea_id=? WHERE id=?').run(cartola_linea_id, movimiento_id);
  db.prepare('UPDATE cartola_lineas SET conciliado=1, movimiento_id=? WHERE id=?').run(movimiento_id, cartola_linea_id);
  res.json({ ok: true });
});

router.post('/cartola/:id/crear-movimiento', (req, res) => {
  const l = db.prepare('SELECT * FROM cartola_lineas WHERE id=? AND empresa=?').get(req.params.id, req.empresa);
  if (!l) return res.status(404).json({ error: 'Linea no existe' });
  const esIngreso = l.abono > 0;
  const tipo = esIngreso ? 'INGRESO' : 'EGRESO';
  const monto = esIngreso ? l.abono : l.cargo;
  const tx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO tes_movimientos (fecha,cuenta_id,tipo,categoria,monto,glosa,conciliado,cartola_linea_id,usuario_id,empresa)
      VALUES (?,?,?,?,?,?,1,?,?,?)`).run(l.fecha, l.cuenta_id, tipo, req.body.categoria || 'Cartola', monto, l.descripcion, l.id, req.user.id, req.empresa);
    db.prepare('UPDATE cartola_lineas SET conciliado=1, movimiento_id=? WHERE id=?').run(r.lastInsertRowid, l.id);
    return r.lastInsertRowid;
  });
  const id = tx();
  res.json({ ok: true, movimiento_id: id });
});

router.post('/conciliacion/desconciliar', (req, res) => {
  const { cartola_linea_id } = req.body;
  const l = db.prepare('SELECT * FROM cartola_lineas WHERE id=? AND empresa=?').get(cartola_linea_id, req.empresa);
  if (!l) return res.status(404).json({ error: 'Linea no existe' });
  if (l.movimiento_id) db.prepare('UPDATE tes_movimientos SET conciliado=0, cartola_linea_id=NULL WHERE id=?').run(l.movimiento_id);
  db.prepare('UPDATE cartola_lineas SET conciliado=0, movimiento_id=NULL WHERE id=?').run(cartola_linea_id);
  res.json({ ok: true });
});

module.exports = router;
