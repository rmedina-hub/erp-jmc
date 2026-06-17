// ===== Estado y utilidades =====
let TOKEN = null, USER = null;
const $ = (s) => document.querySelector(s);
const C = () => $('#content');

const clp = (n) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Math.round(n || 0));
const num = (n, d = 2) => new Intl.NumberFormat('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n || 0);
const fdate = (s) => s ? s.slice(0, 10) : '';
const hoy = () => new Date().toISOString().slice(0, 10);
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (TOKEN) opt.headers['Authorization'] = 'Bearer ' + TOKEN;
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch('/api' + path, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('Error ' + r.status));
  return data;
}

// ===== Modal =====
function modal(html) { $('#modal').innerHTML = html; $('#modalBg').style.display = 'flex'; }
function closeModal() { $('#modalBg').style.display = 'none'; }
$('#modalBg').addEventListener('click', e => { if (e.target.id === 'modalBg') closeModal(); });
function val(id) { const e = document.getElementById(id); return e ? e.value.trim() : ''; }

// ===== Auth =====
async function doLogin(e) {
  e.preventDefault();
  try {
    const d = await api('POST', '/usuarios/login', { email: val('liEmail'), password: val('liPass') });
    TOKEN = d.token; USER = d.usuario;
    $('#login').style.display = 'none';
    $('#app').style.display = 'block';
    $('#userName').textContent = USER.nombre;
    $('#userRol').textContent = '(' + USER.rol + ')';
    if (USER.rol !== 'admin') $('#navUsuarios').style.display = 'none';
    if (USER.empresa && BRANDS[USER.empresa]) selectEmpresa(USER.empresa);
    const _sw = document.getElementById('empresaSwitch');
    if (_sw) _sw.style.display = (USER.rol === 'admin' || !USER.empresa) ? '' : 'none';
    go('dashboard');
  } catch (err) { $('#liErr').textContent = err.message; }
}
function logout() { TOKEN = null; USER = null; location.reload(); }

// ===== Router =====
const TITLES = { dashboard: 'Panel', inventario: 'Inventario PMP', tesoreria: 'Tesoreria', flujo: 'Flujo de caja', creditos: 'Creditos bancarios', activos: 'Activos fijos', usuarios: 'Usuarios' };
function go(v) {
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.v === v));
  $('#viewTitle').textContent = TITLES[v] || v;
  ({ dashboard: vDashboard, inventario: vInventario, tesoreria: vTesoreria, flujo: vFlujo, creditos: vCreditos, activos: vActivos, usuarios: vUsuarios }[v] || vDashboard)();
}
document.querySelectorAll('#nav a').forEach(a => a.addEventListener('click', () => go(a.dataset.v)));

// ===================== DASHBOARD =====================
async function vDashboard() {
  C().innerHTML = '<div class="empty">Cargando...</div>';
  const hasta120 = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
  const [inv, cuentas, creditos, alertas, flujo] = await Promise.all([
    api('GET', '/inventario/valorizado'),
    api('GET', '/tesoreria/cuentas'),
    api('GET', '/creditos'),
    api('GET', '/activos/alertas/vencimientos?dias=30'),
    api('POST', '/flujo/reporte', { granularidad: 'mensual', desde: hoy(), hasta: hasta120, saldo_minimo: 0 })
  ]);
  const bannerDef = flujo.alertas && flujo.alertas.length
    ? `<div class="card" style="border-left:4px solid var(--rojo);background:#fdeded"><b style="color:var(--rojo)">\u26A0 Alerta de deficit proyectado</b> &mdash; el saldo estimado cae bajo el minimo en: ${flujo.alertas.map(x => x.periodo + ' (' + clp(x.saldo) + ')').join(', ')}. <a href="#" onclick="go('flujo');return false">Ver flujo de caja</a></div>`
    : '';
  const saldoTotal = cuentas.reduce((a, c) => a + c.saldo_actual, 0);
  const deudaTotal = creditos.reduce((a, c) => a + c.saldo_pendiente, 0);
  C().innerHTML = `
    ${bannerDef}
    <div class="grid g4">
      <div class="kpi"><div class="lbl">Inventario valorizado (PMP)</div><div class="val">${clp(inv.total)}</div></div>
      <div class="kpi"><div class="lbl">Saldo en bancos</div><div class="val">${clp(saldoTotal)}</div></div>
      <div class="kpi"><div class="lbl">Deuda creditos pendiente</div><div class="val">${clp(deudaTotal)}</div></div>
      <div class="kpi"><div class="lbl">Vencimientos &le; 30 dias</div><div class="val">${alertas.length}</div></div>
    </div>
    <div class="grid g2">
      <div class="card"><h3>Cuentas bancarias</h3>${cuentas.length ? `<table><tr><th>Cuenta</th><th class="num">Saldo</th></tr>${cuentas.map(c => `<tr><td>${esc(c.banco)} - ${esc(c.nombre)}</td><td class="num">${clp(c.saldo_actual)}</td></tr>`).join('')}</table>` : '<div class="empty">Sin cuentas</div>'}</div>
      <div class="card"><h3>Alertas de vencimiento</h3>${alertas.length ? `<table><tr><th>Activo</th><th>Detalle</th><th>Vence</th><th>Estado</th></tr>${alertas.slice(0,8).map(a => `<tr><td>${esc(a.activo)}</td><td>${esc(a.detalle)}</td><td>${fdate(a.fecha_vencimiento)}</td><td><span class="pill ${a.estado==='VENCIDO'?'no':'warn'}">${a.estado}</span></td></tr>`).join('')}</table>` : '<div class="empty">Sin vencimientos proximos</div>'}</div>
    </div>
    <div class="card"><h3>Productos bajo stock minimo</h3>${(() => { const b = inv.items.filter(i => i.bajo_minimo); return b.length ? `<table><tr><th>SKU</th><th>Producto</th><th class="num">Stock</th><th class="num">Minimo</th></tr>${b.map(i => `<tr><td>${esc(i.sku)}</td><td>${esc(i.nombre)}</td><td class="num">${num(i.stock,2)}</td><td class="num">${num(i.stock_minimo,2)}</td></tr>`).join('')}</table>` : '<div class="empty">Todo el stock sobre el minimo</div>'; })()}</div>`;
}

// ===================== INVENTARIO =====================
let invTab = 'valorizado';
async function vInventario() {
  C().innerHTML = `<div class="tabs">
      <button data-t="valorizado">Inventario valorizado</button>
      <button data-t="movimientos">Movimientos / Kardex</button>
      <button data-t="productos">Productos</button>
      <button data-t="bodegas">Bodegas</button>
    </div><div id="invBody"></div>`;
  C().querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { invTab = b.dataset.t; renderInvTabs(); }));
  renderInvTabs();
}
function renderInvTabs() {
  C().querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.t === invTab));
  ({ valorizado: invValorizado, movimientos: invMovimientos, productos: invProductos, bodegas: invBodegas }[invTab])();
}
async function invValorizado() {
  const d = await api('GET', '/inventario/valorizado');
  $('#invBody').innerHTML = `<div class="card"><h3>Existencias valorizadas a Precio Medio Ponderado <span class="muted">Total: ${clp(d.total)}</span></h3>
    <div class="scroll"><table><tr><th>SKU</th><th>Producto</th><th>Unid</th><th class="num">Stock</th><th class="num">Costo PMP</th><th class="num">Valor</th><th></th></tr>
    ${d.items.length ? d.items.map(i => `<tr><td>${esc(i.sku)}</td><td>${esc(i.nombre)} ${i.bajo_minimo ? '<span class="pill no">bajo min</span>' : ''}</td><td>${esc(i.unidad)}</td><td class="num">${num(i.stock,2)}</td><td class="num">${clp(i.costo_promedio)}</td><td class="num"><b>${clp(i.valor)}</b></td><td><button class="btn sm ghost" onclick="verKardex(${i.id},'${esc(i.nombre)}')">Kardex</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Sin productos</td></tr>'}
    </table></div></div>`;
}
async function verKardex(id, nombre) {
  const rows = await api('GET', '/inventario/kardex/' + id);
  modal(`<h3>Kardex - ${esc(nombre)}</h3><div class="scroll"><table>
    <tr><th>Fecha</th><th>Tipo</th><th>Bodega</th><th class="num">Cant</th><th class="num">C.Unit</th><th class="num">Saldo cant</th><th class="num">PMP</th><th class="num">Valor</th></tr>
    ${rows.map(r => `<tr><td>${fdate(r.fecha)}</td><td>${r.tipo}</td><td>${esc(r.bodega)}</td><td class="num">${num(r.cantidad,2)}</td><td class="num">${clp(r.costo_unitario)}</td><td class="num">${num(r.saldo_cantidad,2)}</td><td class="num">${clp(r.saldo_costo_prom)}</td><td class="num">${clp(r.saldo_valor)}</td></tr>`).join('')}
    </table></div><div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
}
async function invMovimientos() {
  const [movs, prods, bods] = await Promise.all([api('GET', '/inventario/movimientos'), api('GET', '/inventario/productos'), api('GET', '/inventario/bodegas')]);
  $('#invBody').innerHTML = `<div class="card"><h3>Registrar movimiento <button class="btn" onclick="formMov()">+ Nuevo movimiento</button></h3>
    <div class="scroll"><table><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th>Bodega</th><th class="num">Cant</th><th class="num">C.Unit</th><th class="num">PMP result</th><th>Doc</th></tr>
    ${movs.length ? movs.map(m => `<tr><td>${fdate(m.fecha)}</td><td><span class="pill ${m.tipo==='ENTRADA'?'ok':m.tipo==='SALIDA'?'no':'warn'}">${m.tipo}</span></td><td>${esc(m.producto)}</td><td>${esc(m.bodega)}</td><td class="num">${num(m.cantidad,2)}</td><td class="num">${clp(m.costo_unitario)}</td><td class="num">${clp(m.saldo_costo_prom)}</td><td>${esc(m.documento||'')}</td></tr>`).join('') : '<tr><td colspan="8" class="empty">Sin movimientos</td></tr>'}
    </table></div></div>`;
  window._prods = prods; window._bods = bods;
}
function formMov() {
  const prods = window._prods, bods = window._bods;
  if (!prods.length || !bods.length) return alert('Primero crea al menos un producto y una bodega.');
  modal(`<h3>Nuevo movimiento de inventario</h3>
    <div class="row"><div class="field"><label>Fecha</label><input id="mFecha" type="date" value="${hoy()}"></div>
      <div class="field"><label>Tipo</label><select id="mTipo" onchange="document.getElementById('mCostoWrap').style.display=this.value==='SALIDA'?'none':'block'"><option value="ENTRADA">ENTRADA (compra)</option><option value="SALIDA">SALIDA (consumo)</option><option value="AJUSTE">AJUSTE</option></select></div></div>
    <div class="row"><div class="field"><label>Producto</label><select id="mProd">${prods.map(p => `<option value="${p.id}">${esc(p.sku)} - ${esc(p.nombre)}</option>`).join('')}</select></div>
      <div class="field"><label>Bodega</label><select id="mBod">${bods.map(b => `<option value="${b.id}">${esc(b.nombre)}</option>`).join('')}</select></div></div>
    <div class="row"><div class="field"><label>Cantidad <span class="muted">(en AJUSTE use negativo para descontar)</span></label><input id="mCant" type="number" step="0.01"></div>
      <div class="field" id="mCostoWrap"><label>Costo unitario</label><input id="mCosto" type="number" step="0.01"></div></div>
    <div class="row"><div class="field"><label>Documento</label><input id="mDoc"></div><div class="field"><label>Glosa</label><input id="mGlosa"></div></div>
    <div class="err" id="mErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarMov()">Guardar</button></div>`);
}
async function guardarMov() {
  try {
    await api('POST', '/inventario/movimientos', { fecha: val('mFecha'), tipo: val('mTipo'), producto_id: val('mProd'), bodega_id: val('mBod'), cantidad: val('mCant'), costo_unitario: val('mCosto'), documento: val('mDoc'), glosa: val('mGlosa') });
    closeModal(); invMovimientos();
  } catch (e) { $('#mErr').textContent = e.message; }
}
async function invProductos() {
  const prods = await api('GET', '/inventario/productos');
  $('#invBody').innerHTML = `<div class="card"><h3>Productos <button class="btn" onclick="formProd()">+ Nuevo producto</button></h3>
    <table><tr><th>SKU</th><th>Nombre</th><th>Unidad</th><th class="num">Stock</th><th class="num">PMP</th><th class="num">Stock min</th></tr>
    ${prods.length ? prods.map(p => `<tr><td>${esc(p.sku)}</td><td>${esc(p.nombre)}</td><td>${esc(p.unidad)}</td><td class="num">${num(p.stock,2)}</td><td class="num">${clp(p.costo_promedio)}</td><td class="num">${num(p.stock_minimo,2)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">Sin productos</td></tr>'}</table></div>`;
}
function formProd() {
  modal(`<h3>Nuevo producto</h3>
    <div class="row"><div class="field"><label>SKU</label><input id="pSku"></div><div class="field"><label>Unidad</label><input id="pUni" value="UN"></div></div>
    <div class="row"><div class="field"><label>Nombre</label><input id="pNom"></div></div>
    <div class="row"><div class="field"><label>Stock minimo</label><input id="pMin" type="number" step="0.01" value="0"></div></div>
    <div class="err" id="pErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarProd()">Guardar</button></div>`);
}
async function guardarProd() {
  try { await api('POST', '/inventario/productos', { sku: val('pSku'), nombre: val('pNom'), unidad: val('pUni'), stock_minimo: val('pMin') }); closeModal(); invProductos(); }
  catch (e) { $('#pErr').textContent = e.message; }
}
async function invBodegas() {
  const bods = await api('GET', '/inventario/bodegas');
  $('#invBody').innerHTML = `<div class="card"><h3>Bodegas <button class="btn" onclick="formBod()">+ Nueva bodega</button></h3>
    <table><tr><th>Codigo</th><th>Nombre</th><th>Ubicacion</th></tr>
    ${bods.length ? bods.map(b => `<tr><td>${esc(b.codigo)}</td><td>${esc(b.nombre)}</td><td>${esc(b.ubicacion||'')}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">Sin bodegas</td></tr>'}</table></div>`;
}
function formBod() {
  modal(`<h3>Nueva bodega</h3><div class="row"><div class="field"><label>Codigo</label><input id="bCod"></div><div class="field"><label>Nombre</label><input id="bNom"></div></div>
    <div class="row"><div class="field"><label>Ubicacion</label><input id="bUbi"></div></div><div class="err" id="bErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarBod()">Guardar</button></div>`);
}
async function guardarBod() {
  try { await api('POST', '/inventario/bodegas', { codigo: val('bCod'), nombre: val('bNom'), ubicacion: val('bUbi') }); closeModal(); invBodegas(); }
  catch (e) { $('#bErr').textContent = e.message; }
}

// ===================== TESORERIA =====================
let tesTab = 'cuentas', tesCuenta = null;
async function vTesoreria() {
  C().innerHTML = `<div class="tabs">
    <button data-t="cuentas">Cuentas</button>
    <button data-t="movimientos">Ingresos / Egresos</button>
    <button data-t="cartola">Importar cartola</button>
    <button data-t="conciliacion">Conciliacion</button></div><div id="tesBody"></div>`;
  C().querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { tesTab = b.dataset.t; renderTesTabs(); }));
  renderTesTabs();
}
function renderTesTabs() {
  C().querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.t === tesTab));
  ({ cuentas: tesCuentas, movimientos: tesMovs, cartola: tesCartola, conciliacion: tesConcil }[tesTab])();
}
async function tesCuentas() {
  const cu = await api('GET', '/tesoreria/cuentas');
  $('#tesBody').innerHTML = `<div class="card"><h3>Cuentas bancarias <button class="btn" onclick="formCuenta()">+ Nueva cuenta</button></h3>
    <div class="scroll"><table><tr><th>Banco</th><th>Cuenta</th><th>N°</th><th>Moneda</th><th class="num">Saldo inicial</th><th class="num">Ingresos</th><th class="num">Egresos</th><th class="num">Saldo actual</th></tr>
    ${cu.length ? cu.map(c => `<tr><td>${esc(c.banco)}</td><td>${esc(c.nombre)}</td><td>${esc(c.numero||'')}</td><td>${c.moneda}</td><td class="num">${clp(c.saldo_inicial)}</td><td class="num">${clp(c.total_ingresos)}</td><td class="num">${clp(c.total_egresos)}</td><td class="num"><b>${clp(c.saldo_actual)}</b></td></tr>`).join('') : '<tr><td colspan="8" class="empty">Sin cuentas</td></tr>'}</table></div></div>`;
}
function formCuenta() {
  modal(`<h3>Nueva cuenta bancaria</h3>
    <div class="row"><div class="field"><label>Banco</label><input id="cBanco"></div><div class="field"><label>Nombre</label><input id="cNom" placeholder="Cuenta corriente"></div></div>
    <div class="row"><div class="field"><label>Numero</label><input id="cNum"></div><div class="field"><label>Moneda</label><input id="cMon" value="CLP"></div></div>
    <div class="row"><div class="field"><label>Saldo inicial</label><input id="cSaldo" type="number" value="0"></div></div><div class="err" id="cErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarCuenta()">Guardar</button></div>`);
}
async function guardarCuenta() {
  try { await api('POST', '/tesoreria/cuentas', { banco: val('cBanco'), nombre: val('cNom'), numero: val('cNum'), moneda: val('cMon'), saldo_inicial: val('cSaldo') }); closeModal(); tesCuentas(); }
  catch (e) { $('#cErr').textContent = e.message; }
}
async function cuentaSelect(id, onchange) {
  const cu = await api('GET', '/tesoreria/cuentas');
  return { cu, html: `<select id="${id}" ${onchange ? `onchange="${onchange}"` : ''}>${cu.map(c => `<option value="${c.id}">${esc(c.banco)} - ${esc(c.nombre)}</option>`).join('')}</select>` };
}
async function tesMovs() {
  const { cu, html } = await cuentaSelect('tmCuenta', 'tesMovsLoad()');
  if (!cu.length) { $('#tesBody').innerHTML = '<div class="card"><div class="empty">Crea una cuenta primero.</div></div>'; return; }
  if (!tesCuenta) tesCuenta = cu[0].id;
  $('#tesBody').innerHTML = `<div class="card"><h3>Movimientos <span></span></h3>
    <div class="row"><div class="field" style="max-width:280px"><label>Cuenta</label>${html}</div>
      <button class="btn" onclick="formTesMov()">+ Registrar ingreso/egreso</button></div>
    <div id="tmList" style="margin-top:14px"></div></div>`;
  document.getElementById('tmCuenta').value = tesCuenta;
  tesMovsLoad();
}
async function tesMovsLoad() {
  tesCuenta = document.getElementById('tmCuenta').value;
  const m = await api('GET', '/tesoreria/movimientos?cuenta_id=' + tesCuenta);
  $('#tmList').innerHTML = `<div class="scroll"><table><tr><th>Fecha</th><th>Tipo</th><th>Categoria</th><th>Glosa</th><th class="num">Monto</th><th>Concil.</th><th></th></tr>
    ${m.length ? m.map(x => `<tr><td>${fdate(x.fecha)}</td><td><span class="pill ${x.tipo==='INGRESO'?'ok':'no'}">${x.tipo}</span></td><td>${esc(x.categoria||'')}</td><td>${esc(x.glosa||'')}</td><td class="num">${clp(x.monto)}</td><td>${x.conciliado?'<span class="pill ok">SI</span>':'<span class="pill warn">NO</span>'}</td><td><button class="btn sm red" onclick="delTesMov(${x.id})">x</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Sin movimientos</td></tr>'}</table></div>`;
}
async function delTesMov(id) { if (confirm('Eliminar movimiento?')) { await api('DELETE', '/tesoreria/movimientos/' + id); tesMovsLoad(); } }
function formTesMov() {
  modal(`<h3>Ingreso / Egreso</h3>
    <div class="row"><div class="field"><label>Fecha</label><input id="xFecha" type="date" value="${hoy()}"></div>
      <div class="field"><label>Tipo</label><select id="xTipo"><option value="INGRESO">INGRESO</option><option value="EGRESO">EGRESO</option></select></div></div>
    <div class="row"><div class="field"><label>Monto</label><input id="xMonto" type="number"></div><div class="field"><label>Categoria</label><input id="xCat"></div></div>
    <div class="row"><div class="field"><label>Documento</label><input id="xDoc"></div><div class="field"><label>Glosa</label><input id="xGlosa"></div></div>
    <div class="err" id="xErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarTesMov()">Guardar</button></div>`);
}
async function guardarTesMov() {
  try { await api('POST', '/tesoreria/movimientos', { fecha: val('xFecha'), cuenta_id: tesCuenta, tipo: val('xTipo'), monto: val('xMonto'), categoria: val('xCat'), documento: val('xDoc'), glosa: val('xGlosa') }); closeModal(); tesMovsLoad(); }
  catch (e) { $('#xErr').textContent = e.message; }
}
async function tesCartola() {
  const { cu, html } = await cuentaSelect('caCuenta');
  if (!cu.length) { $('#tesBody').innerHTML = '<div class="card"><div class="empty">Crea una cuenta primero.</div></div>'; return; }
  $('#tesBody').innerHTML = `<div class="card"><h3>Importar cartola bancaria</h3>
    <p class="muted" style="margin-bottom:12px">Sube un archivo CSV o pega el contenido. Se reconocen columnas: <b>fecha, descripcion, cargo, abono, monto, saldo</b> (separador ; o ,).</p>
    <div class="row"><div class="field" style="max-width:280px"><label>Cuenta</label>${html}</div>
      <div class="field"><label>Archivo CSV</label><input id="caFile" type="file" accept=".csv,text/csv" onchange="leerCSV()"></div></div>
    <div class="row" style="margin-top:10px"><div class="field"><label>Contenido CSV</label><textarea id="caTxt" rows="7" placeholder="fecha;descripcion;cargo;abono;saldo&#10;2026-06-01;Deposito cliente;0;1500000;1500000"></textarea></div></div>
    <div class="err" id="caErr"></div>
    <div class="right" style="margin-top:10px"><button class="btn" onclick="importarCartola()">Importar</button></div>
    <div id="caRes"></div></div>`;
}
function leerCSV() {
  const f = document.getElementById('caFile').files[0]; if (!f) return;
  const r = new FileReader(); r.onload = () => { document.getElementById('caTxt').value = r.result; }; r.readAsText(f, 'utf-8');
}
async function importarCartola() {
  try {
    const d = await api('POST', '/tesoreria/cartola/import', { cuenta_id: val('caCuenta'), csv: val('caTxt') });
    $('#caRes').innerHTML = `<div class="card" style="margin-top:14px"><b>${d.importadas}</b> lineas importadas (lote ${d.lote}). Ve a la pestana <b>Conciliacion</b>.</div>`;
  } catch (e) { $('#caErr').textContent = e.message; }
}
async function tesConcil() {
  const { cu, html } = await cuentaSelect('coCuenta', 'concilLoad()');
  if (!cu.length) { $('#tesBody').innerHTML = '<div class="card"><div class="empty">Crea una cuenta primero.</div></div>'; return; }
  if (!tesCuenta) tesCuenta = cu[0].id;
  $('#tesBody').innerHTML = `<div class="card"><h3>Conciliacion bancaria</h3>
    <div class="row"><div class="field" style="max-width:280px"><label>Cuenta</label>${html}</div>
      <div class="field" style="max-width:160px"><label>Tolerancia (dias)</label><input id="coTol" type="number" value="5"></div>
      <button class="btn green" onclick="concilAuto()">Conciliar automatico</button></div>
    <div id="coBody" style="margin-top:14px"></div></div>`;
  document.getElementById('coCuenta').value = tesCuenta;
  concilLoad();
}
async function concilLoad() {
  tesCuenta = document.getElementById('coCuenta').value;
  const d = await api('GET', '/tesoreria/conciliacion?cuenta_id=' + tesCuenta);
  const movOpts = d.movimientos.map(m => `<option value="${m.id}">${fdate(m.fecha)} ${m.tipo} ${clp(m.monto)}</option>`).join('');
  $('#coBody').innerHTML = `<div class="grid g2">
    <div><h3 style="font-size:14px;color:var(--azul);margin-bottom:8px">Lineas de cartola pendientes (${d.lineas.length})</h3>
      <div class="scroll"><table><tr><th>Fecha</th><th>Descripcion</th><th class="num">Cargo</th><th class="num">Abono</th><th></th></tr>
      ${d.lineas.length ? d.lineas.map(l => `<tr><td>${fdate(l.fecha)}</td><td>${esc(l.descripcion||'')}</td><td class="num">${l.cargo?clp(l.cargo):''}</td><td class="num">${l.abono?clp(l.abono):''}</td>
        <td><button class="btn sm ghost" onclick="matchManual(${l.id})">vincular</button> <button class="btn sm green" onclick="crearDesdeCartola(${l.id})">crear mov</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Sin pendientes</td></tr>'}</table></div></div>
    <div><h3 style="font-size:14px;color:var(--azul);margin-bottom:8px">Movimientos contables pendientes (${d.movimientos.length})</h3>
      <div class="scroll"><table><tr><th>Fecha</th><th>Tipo</th><th>Glosa</th><th class="num">Monto</th></tr>
      ${d.movimientos.length ? d.movimientos.map(m => `<tr><td>${fdate(m.fecha)}</td><td>${m.tipo}</td><td>${esc(m.glosa||'')}</td><td class="num">${clp(m.monto)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">Sin pendientes</td></tr>'}</table></div></div></div>`;
  window._movOpts = movOpts;
}
async function concilAuto() {
  const d = await api('POST', '/tesoreria/conciliacion/auto', { cuenta_id: tesCuenta, tolerancia_dias: val('coTol') });
  alert(d.conciliadas + ' partidas conciliadas automaticamente.'); concilLoad();
}
function matchManual(lineaId) {
  modal(`<h3>Vincular linea con movimiento</h3>
    <div class="row"><div class="field"><label>Movimiento contable</label><select id="mmMov">${window._movOpts || ''}</select></div></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn" onclick="doMatch(${lineaId})">Conciliar</button></div>`);
}
async function doMatch(lineaId) {
  await api('POST', '/tesoreria/conciliacion/manual', { cartola_linea_id: lineaId, movimiento_id: val('mmMov') });
  closeModal(); concilLoad();
}
async function crearDesdeCartola(id) {
  await api('POST', '/tesoreria/cartola/' + id + '/crear-movimiento', {});
  concilLoad();
}

// ===================== CREDITOS =====================
async function vCreditos() {
  const creds = await api('GET', '/creditos');
  C().innerHTML = `<div class="card"><h3>Creditos bancarios <button class="btn" onclick="formCredito()">+ Nuevo credito</button></h3>
    <div class="scroll"><table><tr><th>Banco</th><th>Nombre</th><th>Sistema</th><th class="num">Monto</th><th class="num">Tasa mens.</th><th>Cuotas</th><th class="num">Saldo pend.</th><th>Estado</th><th></th></tr>
    ${creds.length ? creds.map(c => `<tr><td>${esc(c.banco)}</td><td>${esc(c.nombre)}</td><td>${c.sistema}</td><td class="num">${clp(c.monto)}</td><td class="num">${num(c.tasa_mensual,2)}%</td><td>${c.cuotas_pagadas}/${c.cuotas_total}</td><td class="num">${clp(c.saldo_pendiente)}</td><td><span class="pill ${c.estado==='PAGADO'?'ok':'warn'}">${c.estado}</span></td><td><button class="btn sm ghost" onclick="verCredito(${c.id})">Tabla</button></td></tr>`).join('') : '<tr><td colspan="9" class="empty">Sin creditos registrados</td></tr>'}</table></div></div>`;
}
async function formCredito() {
  const cu = await api('GET', '/tesoreria/cuentas');
  modal(`<h3>Nuevo credito bancario</h3>
    <div class="row"><div class="field"><label>Banco</label><input id="kBanco"></div><div class="field"><label>Nombre/Glosa</label><input id="kNom"></div></div>
    <div class="row"><div class="field"><label>Monto</label><input id="kMonto" type="number"></div><div class="field"><label>Tasa mensual (%)</label><input id="kTasa" type="number" step="0.01"></div></div>
    <div class="row"><div class="field"><label>N° cuotas</label><input id="kCuotas" type="number"></div><div class="field"><label>Sistema</label><select id="kSis"><option value="FRANCES">Frances (cuota fija)</option><option value="ALEMAN">Aleman (amort. fija)</option></select></div></div>
    <div class="row"><div class="field"><label>Fecha inicio</label><input id="kFecha" type="date" value="${hoy()}"></div>
      <div class="field"><label>Cuenta de pago (opcional)</label><select id="kCuenta"><option value="">-- sin asociar --</option>${cu.map(c => `<option value="${c.id}">${esc(c.banco)} - ${esc(c.nombre)}</option>`).join('')}</select></div></div>
    <div class="err" id="kErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="simularCredito()">Simular tabla</button> <button class="btn" onclick="guardarCredito()">Crear credito</button></div>
    <div id="kSim"></div>`);
}
function credBody() {
  return { monto: val('kMonto'), tasa_mensual: val('kTasa'), n_cuotas: val('kCuotas'), sistema: val('kSis'), fecha_inicio: val('kFecha') };
}
async function simularCredito() {
  try {
    const filas = await api('POST', '/creditos/simular', credBody());
    $('#kSim').innerHTML = tablaAmort(filas);
  } catch (e) { $('#kErr').textContent = e.message; }
}
async function guardarCredito() {
  try {
    await api('POST', '/creditos', { banco: val('kBanco'), nombre: val('kNom'), cuenta_id: val('kCuenta'), ...credBody() });
    closeModal(); vCreditos();
  } catch (e) { $('#kErr').textContent = e.message; }
}
function tablaAmort(filas, conPago) {
  return `<div class="scroll" style="margin-top:14px"><table><tr><th>N°</th><th>Vence</th><th class="num">Cuota</th><th class="num">Interes</th><th class="num">Amortizacion</th><th class="num">Saldo</th>${conPago ? '<th></th>' : ''}</tr>
    ${filas.map(f => `<tr><td>${f.numero}</td><td>${fdate(f.fecha_venc)}</td><td class="num">${clp(f.cuota)}</td><td class="num">${clp(f.interes)}</td><td class="num">${clp(f.amortizacion)}</td><td class="num">${clp(f.saldo)}</td>${conPago ? `<td>${f.pagado ? '<span class="pill ok">PAGADA</span>' : `<button class="btn sm green" onclick="pagarCuota(${f._cid},${f.numero})">pagar</button>`}</td>` : ''}</tr>`).join('')}</table></div>`;
}
async function verCredito(id) {
  const c = await api('GET', '/creditos/' + id);
  c.cuotas.forEach(q => q._cid = id);
  modal(`<h3>${esc(c.banco)} - ${esc(c.nombre)} <span class="muted">(${c.sistema})</span></h3>
    <p class="muted">Monto ${clp(c.monto)} · ${num(c.tasa_mensual,2)}% mensual · ${c.n_cuotas} cuotas</p>
    ${tablaAmort(c.cuotas, true)}
    <div class="right" style="margin-top:14px"><button class="btn red" onclick="delCredito(${id})">Eliminar credito</button> <button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
}
async function pagarCuota(cid, numero) {
  await api('POST', `/creditos/${cid}/cuotas/${numero}/pagar`, { fecha_pago: hoy() });
  verCredito(cid);
}
async function delCredito(id) { if (confirm('Eliminar credito y su tabla?')) { await api('DELETE', '/creditos/' + id); closeModal(); vCreditos(); } }

// ===================== ACTIVOS =====================
let actTab = 'activos';
async function vActivos() {
  C().innerHTML = `<div class="tabs"><button data-t="activos">Activos</button><button data-t="alertas">Alertas de vencimiento</button></div><div id="actBody"></div>`;
  C().querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { actTab = b.dataset.t; renderActTabs(); }));
  renderActTabs();
}
function renderActTabs() {
  C().querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.t === actTab));
  (actTab === 'activos' ? actLista : actAlertas)();
}
async function actLista() {
  const a = await api('GET', '/activos');
  $('#actBody').innerHTML = `<div class="card"><h3>Activos fijos <button class="btn" onclick="formActivo()">+ Nuevo activo</button></h3>
    <div class="scroll"><table><tr><th>Codigo</th><th>Nombre</th><th>Categoria</th><th>Patente</th><th class="num">Valor compra</th><th class="num">Km actual</th><th></th></tr>
    ${a.length ? a.map(x => `<tr><td>${esc(x.codigo)}</td><td>${esc(x.nombre)}</td><td>${esc(x.categoria||'')}</td><td>${esc(x.patente||'')}</td><td class="num">${clp(x.valor_compra)}</td><td class="num">${x.km_actual!=null?num(x.km_actual,0)+' km':'-'}</td><td><button class="btn sm ghost" onclick="verActivo(${x.id})">Ficha</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Sin activos</td></tr>'}</table></div></div>`;
}
function formActivo() {
  modal(`<h3>Nuevo activo</h3>
    <div class="row"><div class="field"><label>Codigo</label><input id="aCod"></div><div class="field"><label>Nombre</label><input id="aNom"></div></div>
    <div class="row"><div class="field"><label>Categoria</label><select id="aCat"><option>VEHICULO</option><option>MAQUINARIA</option><option>EQUIPO</option><option>HERRAMIENTA</option><option>OTRO</option></select></div>
      <div class="field"><label>Patente</label><input id="aPat"></div></div>
    <div class="row"><div class="field"><label>Marca</label><input id="aMarca"></div><div class="field"><label>Modelo</label><input id="aMod"></div></div>
    <div class="row"><div class="field"><label>Fecha compra</label><input id="aFecha" type="date"></div><div class="field"><label>Valor compra</label><input id="aValor" type="number"></div></div>
    <div class="err" id="aErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarActivo()">Guardar</button></div>`);
}
async function guardarActivo() {
  try { await api('POST', '/activos', { codigo: val('aCod'), nombre: val('aNom'), categoria: val('aCat'), patente: val('aPat'), marca: val('aMarca'), modelo: val('aMod'), fecha_compra: val('aFecha'), valor_compra: val('aValor') }); closeModal(); actLista(); }
  catch (e) { $('#aErr').textContent = e.message; }
}
async function verActivo(id) {
  const a = await api('GET', '/activos/' + id);
  modal(`<h3>${esc(a.nombre)} <span class="muted">${esc(a.codigo)} · ${esc(a.patente||'')}</span></h3>
    <div class="tabs"><button class="active" onclick="actSub(event,'km',${id})">Kilometrajes</button><button onclick="actSub(event,'seg',${id})">Seguros</button><button onclick="actSub(event,'doc',${id})">Documentos</button></div>
    <div id="aSub"></div>
    <div class="right" style="margin-top:14px"><button class="btn red" onclick="delActivo(${id})">Eliminar</button> <button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
  window._activo = a; renderSub('km', id);
}
function actSub(e, t, id) { e.target.parentNode.querySelectorAll('button').forEach(b => b.classList.remove('active')); e.target.classList.add('active'); renderSub(t, id); }
async function renderSub(t, id) {
  const a = window._activo;
  if (t === 'km') {
    $('#aSub').innerHTML = `<div class="row"><div class="field"><label>Fecha</label><input id="kmF" type="date" value="${hoy()}"></div><div class="field"><label>Km</label><input id="kmV" type="number"></div><div class="field"><label>Glosa</label><input id="kmG"></div><button class="btn" onclick="addKm(${id})">+ Agregar</button></div>
      <table style="margin-top:12px"><tr><th>Fecha</th><th class="num">Km</th><th>Glosa</th></tr>${a.kilometrajes.length ? a.kilometrajes.map(k => `<tr><td>${fdate(k.fecha)}</td><td class="num">${num(k.km,0)}</td><td>${esc(k.glosa||'')}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">Sin registros</td></tr>'}</table>`;
  } else if (t === 'seg') {
    $('#aSub').innerHTML = `<div class="row"><div class="field"><label>Compania</label><input id="sgC"></div><div class="field"><label>Poliza</label><input id="sgP"></div></div>
      <div class="row"><div class="field"><label>Inicio</label><input id="sgI" type="date"></div><div class="field"><label>Vencimiento</label><input id="sgV" type="date"></div><div class="field"><label>Prima</label><input id="sgPr" type="number"></div><button class="btn" onclick="addSeguro(${id})">+ Agregar</button></div>
      <table style="margin-top:12px"><tr><th>Compania</th><th>Poliza</th><th>Vence</th><th class="num">Prima</th><th></th></tr>${a.seguros.length ? a.seguros.map(s => `<tr><td>${esc(s.compania||'')}</td><td>${esc(s.poliza||'')}</td><td>${fdate(s.fecha_vencimiento)} ${venceBadge(s.fecha_vencimiento)}</td><td class="num">${clp(s.prima)}</td><td><button class="btn sm red" onclick="delSub('seguros',${s.id},${id})">x</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Sin seguros</td></tr>'}</table>`;
  } else {
    $('#aSub').innerHTML = `<div class="row"><div class="field"><label>Tipo</label><select id="dcT"><option>PERMISO_CIRCULACION</option><option>REVISION_TECNICA</option><option>SEGURO_OBLIGATORIO</option><option>PADRON</option><option>OTRO</option></select></div><div class="field"><label>Numero</label><input id="dcN"></div></div>
      <div class="row"><div class="field"><label>Emision</label><input id="dcE" type="date"></div><div class="field"><label>Vencimiento</label><input id="dcV" type="date"></div><button class="btn" onclick="addDoc(${id})">+ Agregar</button></div>
      <table style="margin-top:12px"><tr><th>Tipo</th><th>Numero</th><th>Vence</th><th></th></tr>${a.documentos.length ? a.documentos.map(d => `<tr><td>${esc(d.tipo)}</td><td>${esc(d.numero||'')}</td><td>${fdate(d.fecha_vencimiento)} ${venceBadge(d.fecha_vencimiento)}</td><td><button class="btn sm red" onclick="delSub('documentos',${d.id},${id})">x</button></td></tr>`).join('') : '<tr><td colspan="4" class="empty">Sin documentos</td></tr>'}</table>`;
  }
}
function venceBadge(f) {
  const dias = Math.ceil((new Date(f) - new Date(hoy())) / 86400000);
  if (dias < 0) return '<span class="pill no">vencido</span>';
  if (dias <= 30) return `<span class="pill warn">${dias}d</span>`;
  return '';
}
async function addKm(id) { await api('POST', `/activos/${id}/kilometrajes`, { fecha: val('kmF'), km: val('kmV'), glosa: val('kmG') }); verActivo(id); }
async function addSeguro(id) { await api('POST', `/activos/${id}/seguros`, { compania: val('sgC'), poliza: val('sgP'), fecha_inicio: val('sgI'), fecha_vencimiento: val('sgV'), prima: val('sgPr') }); verActivo(id); }
async function addDoc(id) { await api('POST', `/activos/${id}/documentos`, { tipo: val('dcT'), numero: val('dcN'), fecha_emision: val('dcE'), fecha_vencimiento: val('dcV') }); verActivo(id); }
async function delSub(tipo, sid, aid) { await api('DELETE', `/activos/${tipo}/${sid}`); verActivo(aid); }
async function delActivo(id) { if (confirm('Eliminar activo y su historial?')) { await api('DELETE', '/activos/' + id); closeModal(); actLista(); } }
async function actAlertas() {
  const al = await api('GET', '/activos/alertas/vencimientos?dias=60');
  $('#actBody').innerHTML = `<div class="card"><h3>Vencimientos proximos (60 dias) y vencidos</h3>
    <table><tr><th>Tipo</th><th>Activo</th><th>Patente</th><th>Detalle</th><th>Vence</th><th>Estado</th></tr>
    ${al.length ? al.map(x => `<tr><td>${x.clase}</td><td>${esc(x.activo)}</td><td>${esc(x.patente||'')}</td><td>${esc(x.detalle)}</td><td>${fdate(x.fecha_vencimiento)}</td><td><span class="pill ${x.estado==='VENCIDO'?'no':'warn'}">${x.estado}</span></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Sin vencimientos proximos</td></tr>'}</table></div>`;
}

// ===================== USUARIOS =====================
async function vUsuarios() {
  const us = await api('GET', '/usuarios');
  C().innerHTML = `<div class="card"><h3>Usuarios <button class="btn" onclick="formUsuario()">+ Nuevo usuario</button></h3>
    <table><tr><th>Nombre</th><th>Email</th><th>Empresa</th><th>Rol</th><th>Activo</th><th></th></tr>
    ${us.map(u => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.email)}</td><td>${u.empresa && BRANDS[u.empresa] ? esc(BRANDS[u.empresa].nombre) : '<span class="muted">Todas</span>'}</td><td>${u.rol}</td><td>${u.activo ? '<span class="pill ok">SI</span>' : '<span class="pill no">NO</span>'}</td><td><button class="btn sm ghost" onclick="formResetPass(${u.id},'${esc(u.email)}')">Resetear clave</button></td></tr>`).join('')}</table></div>`;
}
function formUsuario() {
  modal(`<h3>Nuevo usuario</h3>
    <div class="row"><div class="field"><label>Nombre</label><input id="uNom"></div><div class="field"><label>Email</label><input id="uEmail" type="email"></div></div>
    <div class="row"><div class="field"><label>Contrasena</label><input id="uPass" type="password"></div><div class="field"><label>Rol</label><select id="uRol"><option value="usuario">usuario</option><option value="admin">admin</option></select></div></div>
    <div class="row"><div class="field"><label>Empresa</label><select id="uEmp"><option value="">Todas (puede cambiar)</option><option value="trabancura">Trabancura</option><option value="jmc">JMC Ingenieria</option></select></div></div>
    <div class="err" id="uErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarUsuario()">Guardar</button></div>`);
}
async function guardarUsuario() {
  try { await api('POST', '/usuarios', { nombre: val('uNom'), email: val('uEmail'), password: val('uPass'), rol: val('uRol'), empresa: val('uEmp') }); closeModal(); vUsuarios(); }
  catch (e) { $('#uErr').textContent = e.message; }
}

// ===================== FLUJO DE CAJA =====================
let flujoTab = 'reporte';
let flujoParams = { granularidad: 'mensual', desde: hoy(), hasta: null, saldo_minimo: 0 };
function vFlujo() {
  if (!flujoParams.hasta) flujoParams.hasta = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
  C().innerHTML = `<div class="tabs">
    <button data-t="reporte">Reporte</button>
    <button data-t="planilla">Planilla mensual</button>
    <button data-t="proyecciones">Proyecciones</button>
    <button data-t="escenarios">Escenarios (What-if)</button></div><div id="fjBody"></div>`;
  C().querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { flujoTab = b.dataset.t; renderFlujoTabs(); }));
  renderFlujoTabs();
}
function renderFlujoTabs() {
  C().querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.t === flujoTab));
  ({ reporte: fjReporte, planilla: fjPlanilla, proyecciones: fjProy, escenarios: fjEsc }[flujoTab])();
}
function netoCell(v) { return `<td class="num" style="color:${v < 0 ? 'var(--rojo)' : 'inherit'}">${clp(v)}</td>`; }
async function fjReporte() {
  $('#fjBody').innerHTML = `<div class="card"><h3>Parametros del reporte</h3>
    <div class="row">
      <div class="field"><label>Vista</label><select id="fGran"><option value="diario">Diaria</option><option value="semanal">Semanal</option><option value="mensual">Mensual</option></select></div>
      <div class="field"><label>Desde</label><input id="fDesde" type="date" value="${flujoParams.desde}"></div>
      <div class="field"><label>Hasta</label><input id="fHasta" type="date" value="${flujoParams.hasta}"></div>
      <div class="field"><label>Saldo minimo deseado</label><input id="fMin" type="number" value="${flujoParams.saldo_minimo}"></div>
      <button class="btn" onclick="fjCalcular()">Calcular</button>
    </div></div><div id="fjRes"></div>`;
  document.getElementById('fGran').value = flujoParams.granularidad;
  fjCalcular();
}
async function fjCalcular() {
  flujoParams = { granularidad: val('fGran'), desde: val('fDesde'), hasta: val('fHasta'), saldo_minimo: Number(val('fMin')) || 0 };
  const r = await api('POST', '/flujo/reporte', flujoParams);
  $('#fjRes').innerHTML = renderReporte(r);
}
function renderReporte(r) {
  const al = r.alertas.length
    ? `<div class="card" style="border-left:4px solid var(--rojo);background:#fdeded"><b style="color:var(--rojo)">⚠ Deficit proyectado</b> en ${r.alertas.length} periodo(s): ${r.alertas.map(a => a.periodo + ' (' + clp(a.saldo) + ')').join(', ')}</div>`
    : `<div class="card" style="border-left:4px solid var(--verde);background:#eafaf0"><b style="color:var(--verde)">Sin deficit proyectado</b> &mdash; el saldo se mantiene sobre ${clp(r.saldoMinimo)}.</div>`;
  const acts = ['OPERACIONAL', 'INVERSION', 'FINANCIAMIENTO'];
  const lbl = { OPERACIONAL: 'Operacional', INVERSION: 'Inversion', FINANCIAMIENTO: 'Financiamiento' };
  const saldoFinal = r.periodos.length ? r.periodos[r.periodos.length - 1].saldo_acum : r.saldoInicial;
  return al + `
  <div class="grid g4">
    <div class="kpi"><div class="lbl">Saldo actual en bancos</div><div class="val">${clp(r.saldoInicial)}</div></div>
    <div class="kpi"><div class="lbl">Neto real (rango)</div><div class="val">${clp(r.totales.neto_real)}</div></div>
    <div class="kpi"><div class="lbl">Neto proyectado (rango)</div><div class="val">${clp(r.totales.neto_proy)}</div></div>
    <div class="kpi"><div class="lbl">Saldo final proyectado</div><div class="val" style="color:${saldoFinal < r.saldoMinimo ? 'var(--rojo)' : 'inherit'}">${clp(saldoFinal)}</div></div>
  </div>
  <div class="card"><h3>Flujo real vs proyectado</h3>
    <div class="scroll"><table>
      <tr><th>Periodo</th><th class="num">Ing. real</th><th class="num">Egr. real</th><th class="num">Neto real</th>
      <th class="num">Ing. proy.</th><th class="num">Egr. proy.</th><th class="num">Neto proy.</th><th class="num">Saldo acum.</th></tr>
      ${r.periodos.length ? r.periodos.map(p => `<tr style="${p.deficit ? 'background:#fdeded' : ''}">
        <td>${p.label}</td>
        <td class="num">${p.real.ing ? clp(p.real.ing) : ''}</td><td class="num">${p.real.egr ? clp(p.real.egr) : ''}</td>${netoCell(p.neto_real)}
        <td class="num">${p.proy.ing ? clp(p.proy.ing) : ''}</td><td class="num">${p.proy.egr ? clp(p.proy.egr) : ''}</td>${netoCell(p.neto_proy)}
        <td class="num"><b style="color:${p.deficit ? 'var(--rojo)' : 'inherit'}">${clp(p.saldo_acum)}</b></td></tr>`).join('') : '<tr><td colspan="8" class="empty">Sin movimientos en el rango</td></tr>'}
    </table></div>
    <p class="muted" style="margin-top:8px">El saldo acumulado proyecta el saldo de bancos hacia adelante sumando el flujo proyectado de cada periodo.</p></div>
  <div class="card"><h3>Clasificacion por actividad (flujo neto)</h3>
    <table><tr><th>Actividad</th><th class="num">Real</th><th class="num">Proyectado</th></tr>
      ${acts.map(k => `<tr><td>${lbl[k]}</td>${netoCell(r.actividades[k].real)}${netoCell(r.actividades[k].proy)}</tr>`).join('')}
    </table></div>`;
}
async function fjProy() {
  const items = await api('GET', '/flujo/proyeccion');
  $('#fjBody').innerHTML = `<div class="card"><h3>Movimientos proyectados <button class="btn" onclick="formProy()">+ Nuevo movimiento</button></h3>
    <p class="muted" style="margin-bottom:10px">Las cuotas de creditos pendientes se proyectan automaticamente como egresos de financiamiento.</p>
    <div class="scroll"><table><tr><th>Fecha</th><th>Tipo</th><th>Actividad</th><th>Descripcion</th><th>Cliente</th><th class="num">Monto</th><th class="num">Prob.</th><th>Extra/Var.</th><th></th></tr>
    ${items.length ? items.map(i => `<tr><td>${fdate(i.fecha)}</td><td><span class="pill ${i.tipo === 'INGRESO' ? 'ok' : 'no'}">${i.tipo}</span></td><td>${i.actividad}</td><td>${esc(i.descripcion || '')}</td><td>${esc(i.cliente || '')}</td><td class="num">${clp(i.monto)}</td><td class="num">${i.probabilidad}%</td><td>${i.extra_contable ? '<span class="pill warn">Si</span>' : ''}</td><td><button class="btn sm red" onclick="delProy(${i.id})">x</button></td></tr>`).join('') : '<tr><td colspan="9" class="empty">Sin proyecciones</td></tr>'}
    </table></div></div>`;
}
function formProy() {
  modal(`<h3>Nuevo movimiento proyectado</h3>
    <div class="row"><div class="field"><label>Fecha</label><input id="fpF" type="date" value="${hoy()}"></div>
      <div class="field"><label>Tipo</label><select id="fpT"><option value="INGRESO">INGRESO</option><option value="EGRESO">EGRESO</option></select></div></div>
    <div class="row"><div class="field"><label>Actividad</label><select id="fpA"><option value="OPERACIONAL">Operacional</option><option value="INVERSION">Inversion</option><option value="FINANCIAMIENTO">Financiamiento</option></select></div>
      <div class="field"><label>Categoria</label><input id="fpC"></div></div>
    <div class="row"><div class="field"><label>Descripcion</label><input id="fpD"></div></div>
    <div class="row"><div class="field"><label>Monto</label><input id="fpM" type="number"></div>
      <div class="field"><label>Probabilidad de ocurrencia (%)</label><input id="fpP" type="number" value="100"></div></div>
    <div class="row"><div class="field"><label>Cliente (opcional)</label><input id="fpCl"></div>
      <div class="field"><label>Movimiento</label><label style="font-weight:400;display:block;padding-top:8px"><input type="checkbox" id="fpE" style="width:auto"> Extra contable / variable</label></div></div>
    <div class="err" id="fpErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarProy()">Guardar</button></div>`);
}
async function guardarProy() {
  try {
    await api('POST', '/flujo/proyeccion', { fecha: val('fpF'), tipo: val('fpT'), actividad: val('fpA'), categoria: val('fpC'), descripcion: val('fpD'), monto: val('fpM'), probabilidad: val('fpP'), cliente: val('fpCl'), extra_contable: document.getElementById('fpE').checked });
    closeModal(); fjProy();
  } catch (e) { $('#fpErr').textContent = e.message; }
}
async function delProy(id) { if (confirm('Eliminar proyeccion?')) { await api('DELETE', '/flujo/proyeccion/' + id); fjProy(); } }
async function fjEsc() {
  const items = await api('GET', '/flujo/whatif');
  $('#fjBody').innerHTML = `<div class="card"><h3>Analisis de escenarios &mdash; ¿que pasa si un cliente no paga?</h3>
    <p class="muted" style="margin-bottom:10px">Desmarca los cobros que <b>no</b> se concretarian y simula el impacto en el flujo y el saldo.</p>
    <table><tr><th style="text-align:center">Se cobra?</th><th>Fecha</th><th>Cliente</th><th>Descripcion</th><th class="num">Monto</th><th class="num">Prob.</th></tr>
    ${items.length ? items.map(i => `<tr><td style="text-align:center"><input type="checkbox" class="wfChk" value="${i.id}" checked style="width:auto"></td><td>${fdate(i.fecha)}</td><td>${esc(i.cliente || '-')}</td><td>${esc(i.descripcion || '')}</td><td class="num">${clp(i.monto)}</td><td class="num">${i.probabilidad}%</td></tr>`).join('') : '<tr><td colspan="6" class="empty">No hay cobros proyectados</td></tr>'}
    </table>
    <div class="row" style="margin-top:12px"><div class="field" style="max-width:220px"><label>Saldo minimo deseado</label><input id="wfMin" type="number" value="0"></div>
      <button class="btn" onclick="simularEscenario()">Simular escenario</button></div>
    <div id="wfRes"></div></div>`;
}
async function simularEscenario() {
  const all = [...document.querySelectorAll('.wfChk')].map(c => c.value);
  const incl = [...document.querySelectorAll('.wfChk:checked')].map(c => c.value);
  const excl = all.filter(x => !incl.includes(x));
  const min = Number(val('wfMin')) || 0;
  const desde = hoy(), hasta = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  const base = await api('POST', '/flujo/reporte', { granularidad: 'mensual', desde, hasta, saldo_minimo: min });
  const escn = await api('POST', '/flujo/reporte', { granularidad: 'mensual', desde, hasta, saldo_minimo: min, excluir: excl });
  const fin = a => a.periodos.length ? a.periodos[a.periodos.length - 1].saldo_acum : a.saldoInicial;
  const minSaldo = a => a.periodos.reduce((m, p) => Math.min(m, p.saldo_acum), a.saldoInicial);
  const caida = base.totales.ingreso_proy - escn.totales.ingreso_proy;
  $('#wfRes').innerHTML = `<div class="grid g3" style="margin-top:14px">
    <div class="kpi"><div class="lbl">Caida de ingresos proyectados</div><div class="val" style="color:var(--rojo)">${clp(caida)}</div></div>
    <div class="kpi"><div class="lbl">Saldo final: base &rarr; escenario</div><div class="val" style="font-size:18px">${clp(fin(base))} &rarr; <span style="color:${fin(escn) < min ? 'var(--rojo)' : 'inherit'}">${clp(fin(escn))}</span></div></div>
    <div class="kpi"><div class="lbl">Saldo minimo alcanzado (escenario)</div><div class="val" style="color:${minSaldo(escn) < min ? 'var(--rojo)' : 'var(--verde)'}">${clp(minSaldo(escn))}</div></div>
  </div>
  ${escn.alertas.length ? `<div class="card" style="border-left:4px solid var(--rojo);background:#fdeded"><b style="color:var(--rojo)">⚠ En este escenario hay deficit</b> en: ${escn.alertas.map(a => a.periodo + ' (' + clp(a.saldo) + ')').join(', ')}. Considera renegociar plazos o asegurar la cobranza.</div>` : `<div class="card" style="border-left:4px solid var(--verde);background:#eafaf0"><b style="color:var(--verde)">El flujo resiste este escenario</b> sin caer bajo el minimo.</div>`}`;
}

// ===================== BRANDING MULTI-EMPRESA =====================
const BRANDS = {
  trabancura: { id: 'trabancura', nombre: 'Trabancura', monograma: 'T', sub: 'Obras y Montajes', oro: true,
    primary: '#0f1a2b', primary2: '#1c2c44', accent: '#c7a23a' },
  jmc: { id: 'jmc', nombre: 'JMC', monograma: 'JMC', sub: 'Ingenieria y Construccion', emblema: true,
    primary: '#26292e', primary2: '#383d44', accent: '#9b2d2d' }
};
let currentBrand = BRANDS.trabancura;

function logoSVG(b, variant) {
  const txt = variant === 'light' ? '#ffffff' : b.primary;
  const sub = variant === 'light' ? 'rgba(255,255,255,.65)' : '#8a97a8';
  let badge;
  if (b.oro) {
    badge = `<polygon points="13,4 29,4 38,13 38,29 29,38 13,38 4,29 4,13" fill="none" stroke="${b.accent}" stroke-width="2.5"/>
      <polygon points="16,8 26,8 33,15 33,27 26,34 16,34 9,27 9,15" fill="none" stroke="${b.accent}" stroke-width="1" opacity=".5"/>
      <text x="21" y="29" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="19" fill="${b.accent}">T</text>`;
  } else if (b.emblema) {
    badge = `<rect x="1" y="3" width="40" height="40" rx="10" fill="#ffffff" stroke="#d8dde5"/>
      <polygon points="9,34 17,34 27,12 19,12" fill="#7d2630"/>
      <polygon points="15,34 23,34 33,12 25,12" fill="${b.accent}"/>
      <polygon points="21,34 29,34 39,12 31,12" fill="#c06a4a"/>`;
  } else {
    const fs = b.monograma.length > 1 ? 12.5 : 21;
    const my = b.monograma.length > 1 ? 27 : 30;
    badge = `<rect x="1" y="3" width="40" height="40" rx="10" fill="${b.accent}"/>
      <rect x="1" y="3" width="40" height="40" rx="10" fill="none" stroke="rgba(255,255,255,.18)"/>
      <text x="21" y="${my}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-weight="700" font-size="${fs}" fill="#fff">${b.monograma}</text>`;
  }
  return `<svg viewBox="0 0 230 46" width="100%" style="max-width:230px;height:auto;display:block">
    ${badge}
    <text x="52" y="25" font-family="Segoe UI,Arial,sans-serif" font-weight="700" font-size="18" fill="${txt}" letter-spacing=".4">${b.nombre}</text>
    <text x="52.5" y="39" font-family="Segoe UI,Arial,sans-serif" font-size="8.5" fill="${sub}" letter-spacing="2">${b.sub.toUpperCase()}</text>
  </svg>`;
}
function applyBrand(b) {
  currentBrand = b;
  const r = document.documentElement.style;
  r.setProperty('--azul', b.primary); r.setProperty('--azul2', b.primary2); r.setProperty('--acento', b.accent);
  document.title = b.nombre + ' - ERP';
  try { localStorage.setItem('erp_empresa', b.id); } catch {}
  const ll = document.getElementById('loginLogo'); if (ll) ll.innerHTML = logoSVG(b, 'dark');
  const sb = document.getElementById('sideBrand'); if (sb) sb.innerHTML = logoSVG(b, 'light');
}
function selectEmpresa(id) { applyBrand(BRANDS[id] || BRANDS.trabancura); renderEmpresaPick(); renderEmpresaSwitch(); }
function loadBrand() { try { return BRANDS[localStorage.getItem('erp_empresa')] || BRANDS.trabancura; } catch { return BRANDS.trabancura; } }
function renderEmpresaPick() {
  const el = document.getElementById('empresaPick'); if (!el) return;
  el.innerHTML = Object.values(BRANDS).map(b =>
    `<button type="button" class="emp-chip ${b.id === currentBrand.id ? 'active' : ''}" onclick="selectEmpresa('${b.id}')">
       <span class="emp-badge" style="background:${b.accent}">${b.monograma}</span>${b.nombre}</button>`).join('');
}
function renderEmpresaSwitch() {
  const s = document.getElementById('empresaSwitch'); if (!s) return;
  s.innerHTML = Object.values(BRANDS).map(b => `<option value="${b.id}">${b.nombre}</option>`).join('');
  s.value = currentBrand.id;
  s.onchange = () => selectEmpresa(s.value);
}
// Inicializar branding
applyBrand(loadBrand());
renderEmpresaPick();
renderEmpresaSwitch();

// ===================== FLUJO: PLANILLA MENSUAL (Estimado / Real / Varianza) =====================
let planParams = { desde: null, hasta: null };
const PLAN_SECCIONES = [
  { titulo: '( + )  RECIBOS DE EFECTIVO', kind: 'in', total: 'TOTAL DE RECIBOS DE EFECTIVO', lines: [
    ['r_ventas', 'Ventas en efectivo'], ['r_cobros', 'Cobros de cuentas de clientes'],
    ['r_prestamo', 'Préstamo / inyección de efectivo'], ['r_intereses', 'Ingresos por intereses'],
    ['r_otros', 'Otros ingresos en efectivo'] ] },
  { titulo: '( – )  COSTO DE BIENES / SERVICIOS', kind: 'out', total: 'COSTO TOTAL DE BIENES / SERVICIOS', lines: [
    ['c_directos', 'Costos directos / materiales'], ['c_salarios', 'Salarios directos'], ['c_subcontrato', 'Subcontratistas'] ] },
  { titulo: '( – )  GASTOS DE FUNCIONAMIENTO', kind: 'out', total: 'GASTOS OPERATIVOS TOTALES', lines: [
    ['o_remuneraciones', 'Remuneraciones / sueldos'], ['o_comisiones', 'Comisiones bancarias'], ['o_seguros', 'Seguros'],
    ['o_arriendos', 'Arriendos'], ['o_servicios', 'Servicios básicos'], ['o_otros', 'Otros gastos operativos'] ] },
  { titulo: '( – )  GASTOS ADICIONALES (FINANCIAMIENTO / INVERSIÓN)', kind: 'out', total: 'TOTAL DE GASTOS ADICIONALES', lines: [
    ['a_cuotas', 'Cuotas de créditos bancarios'], ['a_intereses', 'Gastos por intereses'],
    ['a_activos', 'Compra de activos / inversión'], ['a_impuestos', 'Impuestos'] ] }
];
function planMapLinea(ev) {
  const t = ((ev.categoria || '') + ' ' + (ev.glosa || '')).toLowerCase();
  if (ev.tipo === 'INGRESO') {
    if (/venta/.test(t)) return 'r_ventas';
    if (/inter[eé]s/.test(t)) return 'r_intereses';
    if (/pr[eé]stamo|inyec|aporte/.test(t)) return 'r_prestamo';
    if (/otro/.test(t)) return 'r_otros';
    return 'r_cobros';
  }
  if (ev.actividad === 'FINANCIAMIENTO') return /inter[eé]s/.test(t) ? 'a_intereses' : 'a_cuotas';
  if (ev.actividad === 'INVERSION') return 'a_activos';
  if (/material|suministro|insumo|costo directo/.test(t)) return 'c_directos';
  if (/subcontrat/.test(t)) return 'c_subcontrato';
  if (/salario directo|mano de obra directa/.test(t)) return 'c_salarios';
  if (/sueldo|remunerac|salario|n[oó]mina/.test(t)) return 'o_remuneraciones';
  if (/comisi[oó]n|banc/.test(t)) return 'o_comisiones';
  if (/seguro/.test(t)) return 'o_seguros';
  if (/arriendo|alquiler/.test(t)) return 'o_arriendos';
  if (/luz|agua|gas|electric|servicio b[aá]sico|util/.test(t)) return 'o_servicios';
  if (/impuesto/.test(t)) return 'a_impuestos';
  return 'o_otros';
}
function mesesEntre(desde, hasta) {
  const out = []; let d = new Date(desde.slice(0, 7) + '-01T00:00:00'); const fin = hasta.slice(0, 7);
  for (let i = 0; i < 36; i++) { const k = d.toISOString().slice(0, 7); out.push(k); if (k >= fin) break; d.setMonth(d.getMonth() + 1); }
  return out;
}
async function fjPlanilla() {
  if (!planParams.desde) { planParams.desde = hoy(); const d = new Date(); d.setMonth(d.getMonth() + 2); planParams.hasta = d.toISOString().slice(0, 10); }
  $('#fjBody').innerHTML = `<div class="card"><h3>Planilla mensual de flujo de caja</h3>
    <div class="row"><div class="field"><label>Desde</label><input id="plDesde" type="date" value="${planParams.desde}"></div>
      <div class="field"><label>Hasta</label><input id="plHasta" type="date" value="${planParams.hasta}"></div>
      <button class="btn" onclick="plCalcular()">Calcular</button></div>
    <p class="muted" style="margin-top:8px">ESTIMADO = flujo proyectado · REAL = movimientos efectivos · VARIANZA = Estimado − Real.</p>
    </div><div id="plRes"></div>`;
  plCalcular();
}
async function plCalcular() {
  planParams = { desde: val('plDesde'), hasta: val('plHasta') };
  const d = await api('POST', '/flujo/eventos', planParams);
  $('#plRes').innerHTML = renderPlanilla(d);
}
function renderPlanilla(d) {
  const meses = mesesEntre(planParams.desde, planParams.hasta);
  const nm = { '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr', '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Ago', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic' };
  const mesLabel = k => nm[k.slice(5, 7)] + ' ' + k.slice(0, 4);
  // acumular: data[mes][clase][lineKey]
  const data = {}; meses.forEach(m => data[m] = { PROY: {}, REAL: {} });
  d.eventos.forEach(ev => {
    const m = (ev.fecha || '').slice(0, 7); if (!data[m]) return;
    const key = planMapLinea(ev);
    data[m][ev.clase][key] = (data[m][ev.clase][key] || 0) + ev.monto;
  });
  const get = (m, clase, key) => data[m][clase][key] || 0;
  const sumSec = (m, clase, sec) => sec.lines.reduce((a, [k]) => a + get(m, clase, k), 0);
  const totalPagos = (m, clase) => PLAN_SECCIONES.filter(s => s.kind === 'out').reduce((a, s) => a + sumSec(m, clase, s), 0);
  const recibos = (m, clase) => sumSec(m, clase, PLAN_SECCIONES[0]);
  // saldos encadenados
  const startEst = {}, startReal = {}; let pe = d.saldoInicial, pr = d.saldoInicial;
  const endEst = {}, endReal = {};
  meses.forEach(m => {
    startEst[m] = pe; startReal[m] = pr;
    pe = pe + recibos(m, 'PROY') - totalPagos(m, 'PROY');
    pr = pr + recibos(m, 'REAL') - totalPagos(m, 'REAL');
    endEst[m] = pe; endReal[m] = pr;
  });
  const cell = (v, cls) => `<td class="num" style="${v < 0 ? 'color:var(--rojo)' : ''}">${v ? clp(v) : '<span class="muted">—</span>'}</td>`;
  const trip = (m, fn) => { const e = fn(m, 'PROY'), r = fn(m, 'REAL'); return cell(e) + cell(r) + `<td class="num" style="background:#f3f6fa;color:var(--gris)">${clp(e - r)}</td>`; };
  let head = `<tr><th rowspan="2" style="vertical-align:bottom">Concepto</th>${meses.map(m => `<th colspan="3" style="text-align:center;background:var(--acento);color:#fff">${mesLabel(m)}</th>`).join('')}</tr>
    <tr>${meses.map(() => `<th class="num">Estimado</th><th class="num">Real</th><th class="num">Var.</th>`).join('')}</tr>`;
  let rows = '';
  const fullRow = (label, fn, style) => `<tr><td style="${style || ''}">${label}</td>${meses.map(m => trip(m, fn)).join('')}</tr>`;
  // saldo inicial
  rows += `<tr style="background:#dce6f2"><td style="font-weight:600;color:var(--azul)">SALDO INICIAL DISPONIBLE</td>${meses.map(m => `<td class="num" style="font-weight:600">${clp(startEst[m])}</td><td class="num" style="font-weight:600">${clp(startReal[m])}</td><td class="num" style="background:#f3f6fa;color:var(--gris)">${clp(startEst[m] - startReal[m])}</td>`).join('')}</tr>`;
  PLAN_SECCIONES.forEach(sec => {
    rows += `<tr><td colspan="${1 + meses.length * 3}" style="background:#eaf0f6;font-weight:600;color:var(--azul)">${sec.titulo}</td></tr>`;
    sec.lines.forEach(([k, lab]) => { rows += fullRow('&nbsp;&nbsp;' + lab, (m, c) => get(m, c, k)); });
    rows += fullRow(sec.total, (m, c) => sumSec(m, c, sec), 'font-weight:600;color:var(--azul);background:#f1f5fb');
  });
  rows += fullRow('TOTAL DE PAGOS EN EFECTIVO', (m, c) => totalPagos(m, c), 'font-weight:700;color:var(--azul);background:#dce6f2');
  rows += `<tr style="background:#3d6e9e;color:#fff"><td style="font-weight:600">CAMBIO NETO DE EFECTIVO</td>${meses.map(m => { const e = recibos(m, 'PROY') - totalPagos(m, 'PROY'), r = recibos(m, 'REAL') - totalPagos(m, 'REAL'); return `<td class="num" style="font-weight:600">${clp(e)}</td><td class="num" style="font-weight:600">${clp(r)}</td><td class="num" style="font-weight:600">${clp(e - r)}</td>`; }).join('')}</tr>`;
  rows += `<tr style="background:var(--azul);color:#fff"><td style="font-weight:700">POSICIÓN FINAL DEL MES</td>${meses.map(m => `<td class="num" style="font-weight:700">${clp(endEst[m])}</td><td class="num" style="font-weight:700">${clp(endReal[m])}</td><td class="num" style="font-weight:700">${clp(endEst[m] - endReal[m])}</td>`).join('')}</tr>`;
  return `<div class="card"><div class="scroll"><table style="min-width:${260 + meses.length * 210}px">${head}${rows}</table></div></div>`;
}


// ===================== CONTRASENAS =====================
function formCambiarPass() {
  modal(`<h3>Cambiar mi contrasena</h3>
    <div class="row"><div class="field"><label>Contrasena actual</label><input id="cpAct" type="password"></div></div>
    <div class="row"><div class="field"><label>Nueva contrasena</label><input id="cpNue" type="password"></div>
      <div class="field"><label>Repetir nueva</label><input id="cpRep" type="password"></div></div>
    <p class="muted" style="font-size:12px">Minimo 6 caracteres.</p>
    <div class="err" id="cpErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarCambioPass()">Guardar</button></div>`);
}
async function guardarCambioPass() {
  const act = val('cpAct'), nue = val('cpNue'), rep = val('cpRep');
  if (nue !== rep) { $('#cpErr').textContent = 'Las contrasenas nuevas no coinciden'; return; }
  if (nue.length < 6) { $('#cpErr').textContent = 'La nueva contrasena debe tener al menos 6 caracteres'; return; }
  try {
    await api('POST', '/usuarios/cambiar-password', { id: USER.id, actual: act, nueva: nue });
    closeModal(); alert('Contrasena actualizada. Usala en tu proximo ingreso.');
  } catch (e) { $('#cpErr').textContent = e.message; }
}
function formResetPass(id, email) {
  modal(`<h3>Resetear clave</h3>
    <p class="muted">Usuario: <b>${esc(email)}</b></p>
    <div class="row"><div class="field"><label>Nueva contrasena</label><input id="rpNue" type="password"></div></div>
    <p class="muted" style="font-size:12px">El usuario debera cambiarla luego. Minimo 6 caracteres.</p>
    <div class="err" id="rpErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn red" onclick="doResetPass(${id})">Resetear</button></div>`);
}
async function doResetPass(id) {
  const nue = val('rpNue');
  if (nue.length < 6) { $('#rpErr').textContent = 'Minimo 6 caracteres'; return; }
  try { await api('PUT', '/usuarios/' + id, { password: nue }); closeModal(); alert('Clave restablecida.'); }
  catch (e) { $('#rpErr').textContent = e.message; }
}
