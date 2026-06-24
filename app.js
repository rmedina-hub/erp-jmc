// ===== Estado y utilidades =====
let TOKEN = null, USER = null;
const $ = (s) => document.querySelector(s);
const C = () => $('#content');

const clp = (n) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Math.round(n || 0));
const num = (n, d = 2) => new Intl.NumberFormat('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n || 0);
const fdate = (s) => s ? s.slice(0, 10) : '';
const hoy = () => new Date().toISOString().slice(0, 10);
const inicioMes = () => hoy().slice(0, 8) + '01';
const inicioAno = () => hoy().slice(0, 4) + '-01-01';
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

function exportarVista() {
  const cont = document.getElementById('content');
  const tablas = cont ? cont.querySelectorAll('table') : [];
  if (!tablas.length) { alert('Esta vista no tiene una tabla para exportar.'); return; }
  let csv = '';
  tablas.forEach((t, ti) => {
    if (ti > 0) csv += '\r\n';
    t.querySelectorAll('tr').forEach(tr => {
      const celdas = [...tr.querySelectorAll('th,td')].filter(c => !c.querySelector('button,input,select,label'));
      if (!celdas.length) return;
      csv += celdas.map(c => '"' + (c.innerText || '').replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"').join(';') + '\r\n';
    });
  });
  const titulo = (document.getElementById('viewTitle') ? document.getElementById('viewTitle').textContent : 'export') || 'export';
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = titulo.replace(/[^\w]+/g, '_') + '_' + hoy() + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function activeEmpresa() {
  // Empresa activa para aislar datos. Usuarios con empresa fija usan la suya;
  // los de acceso a ambas (Adrian) usan la seleccionada en el switch.
  if (USER && USER.empresa) return USER.empresa;
  try { return (typeof currentBrand !== 'undefined' && currentBrand) ? currentBrand.id : (localStorage.getItem('erp_empresa') || 'jmc'); } catch { return 'jmc'; }
}
async function api(method, path, body) {
  if (method === 'PUT' && !window._sinConfirmar) { if (!window.confirm('¿Desea que los cambios se realicen?')) { const e = new Error('Cambios cancelados'); e._cancel = true; throw e; } }
  const opt = { method, headers: {} };
  if (TOKEN) opt.headers['Authorization'] = 'Bearer ' + TOKEN;
  opt.headers['X-Empresa'] = activeEmpresa();
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
    if (USER.rol !== 'admin') { $('#navUsuarios').style.display = 'none'; const na = document.getElementById('navAuditoria'); if (na) na.style.display = 'none'; const np = document.getElementById('navPapelera'); if (np) np.style.display = 'none'; }
    if (USER.rol === 'bodeguero') {
      document.querySelectorAll('#nav a').forEach(a => { if (a.dataset.v !== 'inventario') a.style.display = 'none'; });
    }
    if (USER.empresa && BRANDS[USER.empresa]) selectEmpresa(USER.empresa);
    const _sw = document.getElementById('empresaSwitch');
    if (_sw) _sw.style.display = (!USER.empresa) ? '' : 'none';
    activarOcultarBorrar();
    go(USER.rol === 'bodeguero' ? 'inventario' : 'dashboard');
  } catch (err) { $('#liErr').textContent = err.message; }
}
function ocultarAccionesBorrar() {
  if (!USER || USER.rol === 'admin') return;
  document.querySelectorAll('button[onclick], label[onclick]').forEach(b => {
    const oc = b.getAttribute('onclick') || '';
    if (/^\s*(del|borrar)/i.test(oc) || /\beliminar\b|\bborrar\b/i.test(b.textContent || '')) b.style.display = 'none';
  });
}
let _moBorrar = null;
function activarOcultarBorrar() {
  if (!USER || USER.rol === 'admin') return;
  ocultarAccionesBorrar();
  if (_moBorrar) return;
  _moBorrar = new MutationObserver(() => ocultarAccionesBorrar());
  _moBorrar.observe(document.body, { childList: true, subtree: true });
}
async function logout() { try { await api('POST', '/usuarios/logout', {}); } catch (e) {} TOKEN = null; USER = null; location.reload(); }

// ===== Router =====
const TITLES = { dashboard: 'Panel', inventario: 'Inventario PMP', tesoreria: 'Tesoreria', flujo: 'Flujo de caja', creditos: 'Creditos bancarios', activos: 'Activos fijos', facturas: 'Cuentas por cobrar / pagar', compras: 'Compras / Abastecimiento', terceros: 'Proveedores y clientes', maquinarias: 'Arriendo de maquinarias', garantias: 'Boletas de garantia', cajachica: 'Caja chica', usuarios: 'Usuarios', auditoria: 'Auditoria', papelera: 'Papelera de activos' };
function go(v) {
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.v === v));
  $('#viewTitle').textContent = TITLES[v] || v;
  ({ dashboard: vDashboard, inventario: vInventario, tesoreria: vTesoreria, flujo: vFlujo, creditos: vCreditos, activos: vActivos, facturas: vFacturas, compras: vCompras, terceros: vTerceros, maquinarias: vMaquinarias, garantias: vGarantias, cajachica: vCajaChica, usuarios: vUsuarios, auditoria: vAuditoria, papelera: vPapelera }[v] || vDashboard)();
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
    api('POST', '/flujo/reporte', { granularidad: 'mensual', desde: inicioMes(), hasta: hasta120, saldo_minimo: 0 })
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
      <div class="card"><h3>Alertas de vencimiento</h3>${alertas.length ? `<table><tr><th>Activo</th><th>Detalle</th><th>Vence</th><th>Estado</th></tr>${alertas.slice(0,8).map(a => `<tr><td>${esc(a.activo)}</td><td>${esc(a.detalle)}</td><td>${a.km?'<span class="muted">por km</span>':fdate(a.fecha_vencimiento)}</td><td><span class="pill ${a.estado==='VENCIDO'?'no':'warn'}">${a.estado}</span></td></tr>`).join('')}</table>` : '<div class="empty">Sin vencimientos proximos</div>'}</div>
    </div>
    <div class="card"><h3>Productos bajo stock minimo</h3>${(() => { const b = inv.items.filter(i => i.bajo_minimo); return b.length ? `<table><tr><th>SKU</th><th>Producto</th><th class="num">Stock</th><th class="num">Minimo</th></tr>${b.map(i => `<tr><td>${esc(i.sku)}</td><td>${esc(i.nombre)}</td><td class="num">${num(i.stock,2)}</td><td class="num">${num(i.stock_minimo,2)}</td></tr>`).join('')}</table>` : '<div class="empty">Todo el stock sobre el minimo</div>'; })()}</div>`;
}

// ===================== INVENTARIO =====================
let invTab = 'valorizado';
async function vInventario() {
  C().innerHTML = `<div class="tabs">
      <button data-t="valorizado">Inventario valorizado</button>
      <button data-t="movimientos">Movimientos / Kardex</button>
      <button data-t="critico">Stock critico</button>
      <button data-t="entregas">Entregas</button>
      <button data-t="productos">Productos</button>
      <button data-t="colaboradores">Colaboradores</button>
      <button data-t="bodegas">Bodegas</button>
    </div><div id="invBody"></div>`;
  C().querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { invTab = b.dataset.t; renderInvTabs(); }));
  renderInvTabs();
}
function renderInvTabs() {
  C().querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.t === invTab));
  ({ valorizado: invValorizado, movimientos: invMovimientos, critico: invStockCritico, entregas: invEntregas, productos: invProductos, colaboradores: invColaboradores, bodegas: invBodegas }[invTab] || invValorizado)();
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
  window._prodList = prods;
  $('#invBody').innerHTML = `<div class="card"><h3>Productos <button class="btn" onclick="formProd()">+ Nuevo producto</button></h3>
    <div class="scroll"><table><tr><th>Foto</th><th>SKU</th><th>Nombre</th><th>Unidad</th><th class="num">Stock</th><th class="num">PMP</th><th class="num">Stock min</th><th></th></tr>
    ${prods.length ? prods.map(p => `<tr>
      <td>${p.tiene_foto ? `<img id="fp_${p.id}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px;cursor:pointer;background:#eee" onclick="verFotoProd(${p.id})">` : '<span class="muted">—</span>'}</td>
      <td>${esc(p.sku)}</td><td>${esc(p.nombre)}</td><td>${esc(p.unidad)}</td><td class="num">${num(p.stock,2)}</td><td class="num">${clp(p.costo_promedio)}</td><td class="num">${num(p.stock_minimo,2)}</td>
      <td><button class="btn sm ghost" onclick="editarProd(${p.id})">Editar</button> <label class="btn sm ghost" style="cursor:pointer;margin:0">${p.tiene_foto?'cambiar foto':'subir foto'}<input type="file" accept="image/*" style="display:none" onchange="subirFotoProd(${p.id},this)"></label></td></tr>`).join('') : '<tr><td colspan="8" class="empty">Sin productos</td></tr>'}</table></div></div>`;
  prods.filter(p => p.tiene_foto).forEach(p => cargarFotoProd(p.id));
}
async function cargarFotoProd(id) {
  try { const r = await fetch('/api/inventario/productos/' + id + '/foto', { headers: { Authorization: 'Bearer ' + TOKEN, 'X-Empresa': activeEmpresa() } });
    if (!r.ok) return; const b = await r.blob(); const el = document.getElementById('fp_' + id); if (el) el.src = URL.createObjectURL(b); } catch (e) {}
}
async function verFotoProd(id) {
  try { const r = await fetch('/api/inventario/productos/' + id + '/foto', { headers: { Authorization: 'Bearer ' + TOKEN, 'X-Empresa': activeEmpresa() } });
    if (!r.ok) { alert('Sin foto'); return; } const b = await r.blob(); window.open(URL.createObjectURL(b), '_blank'); } catch (e) {}
}
async function subirFotoProd(id, input) {
  const f = input.files[0]; if (!f) return; if (f.size > 8 * 1024 * 1024) { alert('La imagen supera 8MB.'); return; }
  const rd = new FileReader();
  rd.onload = async () => { try { await api('POST', '/inventario/productos/' + id + '/foto', { nombre: f.name, mime: f.type || 'image/jpeg', base64: String(rd.result).split(',')[1] }); invProductos(); } catch (e) { alert('Error al subir: ' + e.message); } };
  rd.readAsDataURL(f);
}
function editarProd(id) { formProd((window._prodList || []).find(x => x.id === id)); }
function formProd(p) {
  modal(`<h3>${p ? 'Editar producto' : 'Nuevo producto'}</h3>
    <div class="row"><div class="field"><label>SKU</label><input id="pSku" value="${p ? esc(p.sku) : ''}" ${p ? 'readonly style="background:#f1f1f1"' : ''}></div><div class="field"><label>Unidad</label><input id="pUni" value="${p ? esc(p.unidad) : 'UN'}"></div></div>
    <div class="row"><div class="field"><label>Nombre</label><input id="pNom" value="${p ? esc(p.nombre) : ''}"></div></div>
    <div class="row"><div class="field"><label>Stock minimo</label><input id="pMin" type="number" step="0.01" value="${p ? p.stock_minimo : 0}"></div></div>
    <div class="err" id="pErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarProd(${p ? p.id : 0})">Guardar</button></div>`);
}
async function guardarProd(id) {
  try {
    if (id) await api('PUT', '/inventario/productos/' + id, { nombre: val('pNom'), unidad: val('pUni'), stock_minimo: val('pMin'), activo: 1 });
    else await api('POST', '/inventario/productos', { sku: val('pSku'), nombre: val('pNom'), unidad: val('pUni'), stock_minimo: val('pMin') });
    closeModal(); invProductos();
  } catch (e) { if (!e._cancel) $('#pErr').textContent = e.message; }
}
const TIPOS_BODEGA = { CENTRAL: 'Central', LAMPA: 'Lampa', OBRA: 'En obra' };
async function invBodegas() {
  const bods = await api('GET', '/inventario/bodegas'); window._bodegas = bods;
  $('#invBody').innerHTML = `<div class="card"><h3>Bodegas <button class="btn" onclick="formBod()">+ Nueva bodega</button></h3>
    <table><tr><th>Codigo</th><th>Nombre</th><th>Tipo</th><th>Ubicacion</th><th></th></tr>
    ${bods.length ? bods.map(b => `<tr><td>${esc(b.codigo)}</td><td>${esc(b.nombre)}</td><td>${TIPOS_BODEGA[b.tipo] || esc(b.tipo || '-')}</td><td>${esc(b.ubicacion||'')}</td><td><button class="btn sm ghost" onclick="editarBod(${b.id})">Editar</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Sin bodegas</td></tr>'}</table></div>`;
}
function editarBod(id) { formBod((window._bodegas || []).find(x => x.id === id)); }
function formBod(b) {
  modal(`<h3>${b ? 'Editar bodega' : 'Nueva bodega'}</h3>
    <div class="row"><div class="field"><label>Codigo</label><input id="bCod" value="${b ? esc(b.codigo) : ''}"></div><div class="field"><label>Nombre</label><input id="bNom" value="${b ? esc(b.nombre) : ''}"></div></div>
    <div class="row"><div class="field"><label>Tipo</label><select id="bTipo"><option value="CENTRAL">Central</option><option value="LAMPA">Lampa</option><option value="OBRA">En obra</option></select></div>
      <div class="field"><label>Ubicacion</label><input id="bUbi" value="${b ? esc(b.ubicacion || '') : ''}"></div></div>
    <div class="err" id="bErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarBod(${b ? b.id : 0})">Guardar</button></div>`);
  if (b) document.getElementById('bTipo').value = b.tipo || 'CENTRAL';
}
async function guardarBod(id) {
  try { const body = { codigo: val('bCod'), nombre: val('bNom'), ubicacion: val('bUbi'), tipo: val('bTipo') };
    if (id) await api('PUT', '/inventario/bodegas/' + id, body); else await api('POST', '/inventario/bodegas', body); closeModal(); invBodegas(); }
  catch (e) { $('#bErr').textContent = e.message; }
}
// ===================== ENTREGAS Y COLABORADORES (BODEGA) =====================
async function invColaboradores() {
  const cs = await api('GET', '/colaboradores'); window._colabs = cs;
  $('#invBody').innerHTML = `<div class="card"><h3>Colaboradores <button class="btn" onclick="formColab()">+ Nuevo colaborador</button></h3>
    <table><tr><th>Nombre</th><th>Apellido</th><th>RUT</th><th>Cargo</th><th>Activo</th><th></th></tr>
    ${cs.length ? cs.map(c => `<tr><td>${esc(c.nombre)}</td><td>${esc(c.apellido||'')}</td><td>${esc(c.rut||'')}</td><td>${esc(c.cargo||'')}</td><td>${c.activo ? '<span class="pill ok">SI</span>' : '<span class="pill no">NO</span>'}</td><td><button class="btn sm ghost" onclick="editarColab(${c.id})">Editar</button> <button class="btn sm red" onclick="delColab(${c.id})">x</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Sin colaboradores</td></tr>'}</table></div>`;
}
function editarColab(id) { formColab((window._colabs || []).find(x => x.id === id)); }
function formColab(c) {
  modal(`<h3>${c ? 'Editar' : 'Nuevo'} colaborador</h3>
    <div class="row"><div class="field"><label>Nombre</label><input id="clNom" value="${c ? esc(c.nombre) : ''}"></div><div class="field"><label>Apellido</label><input id="clApe" value="${c ? esc(c.apellido || '') : ''}"></div></div>
    <div class="row"><div class="field"><label>RUT</label><input id="clRut" value="${c ? esc(c.rut || '') : ''}"></div><div class="field"><label>Cargo</label><input id="clCargo" value="${c ? esc(c.cargo || '') : ''}"></div></div>
    <div class="err" id="clErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarColab(${c ? c.id : 0})">Guardar</button></div>`);
}
async function guardarColab(id) {
  try { const body = { nombre: val('clNom'), apellido: val('clApe'), rut: val('clRut'), cargo: val('clCargo') };
    if (id) await api('PUT', '/colaboradores/' + id, body); else await api('POST', '/colaboradores', body); closeModal(); invColaboradores(); }
  catch (e) { $('#clErr').textContent = e.message; }
}
async function delColab(id) { if (confirm('Eliminar colaborador?')) { await api('DELETE', '/colaboradores/' + id); invColaboradores(); } }

async function invEntregas() {
  $('#invBody').innerHTML = `<div class="card"><h3>Entregas a colaboradores</h3>
    <p class="muted">Material: descuenta del stock de la bodega. Herramientas/maquinas: se prestan y se marcan al devolver (fin de jornada).</p>
    <div class="row"><div class="field" style="max-width:260px"><label>Ver</label><select id="entFiltro" onchange="entLoad()">
        <option value="">Todas</option><option value="MATERIAL">Material</option><option value="HERRAMIENTA">Herramientas / maquinas</option><option value="PEND">Herramientas sin devolver</option></select></div>
      <button class="btn" onclick="formEntrega()">+ Registrar entrega</button>
      <button class="btn ghost" onclick="entResumen()">Resumen por colaborador</button></div>
    <div id="entList" style="margin-top:14px"></div></div>`;
  entLoad();
}
async function entLoad() {
  const f = val('entFiltro'); let qs = '';
  if (f === 'MATERIAL' || f === 'HERRAMIENTA') qs = '?tipo=' + f;
  else if (f === 'PEND') qs = '?tipo=HERRAMIENTA&estado=ENTREGADO';
  const rows = await api('GET', '/entregas' + qs);
  $('#entList').innerHTML = `<div class="scroll"><table><tr><th>Fecha</th><th>Tipo</th><th>Item</th><th class="num">Cant.</th><th>Colaborador</th><th>Bodega</th><th>Estado</th><th></th></tr>
    ${rows.length ? rows.map(e => `<tr><td>${fdate(e.fecha_entrega)}</td><td>${e.tipo}</td><td>${esc(e.producto || e.descripcion || '')}</td><td class="num">${num(e.cantidad,2)}</td><td>${esc(e.colaborador || '')}</td><td>${esc(e.bodega || '')}</td>
      <td>${e.estado === 'DEVUELTO' ? '<span class="pill ok">DEVUELTO</span>' : '<span class="pill warn">' + (e.tipo === 'HERRAMIENTA' ? 'PRESTADO' : 'ENTREGADO') + '</span>'}</td>
      <td>${e.tipo === 'HERRAMIENTA' && e.estado !== 'DEVUELTO' ? `<button class="btn sm green" onclick="devolverEnt(${e.id})">Devolver</button> ` : ''}<button class="btn sm red" onclick="delEnt(${e.id})">x</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">Sin entregas</td></tr>'}</table></div>`;
}
async function formEntrega() {
  const [bods, cols, prods] = await Promise.all([api('GET', '/inventario/bodegas'), api('GET', '/colaboradores'), api('GET', '/inventario/productos')]);
  modal(`<h3>Registrar entrega</h3>
    <div class="row"><div class="field"><label>Tipo</label><select id="eTipo" onchange="entToggle()"><option value="MATERIAL">Material (descuenta stock)</option><option value="HERRAMIENTA">Herramienta / maquina (con devolucion)</option></select></div>
      <div class="field"><label>Fecha</label><input id="eFecha" type="date" value="${hoy()}"></div></div>
    <div class="row"><div class="field"><label>Bodega</label><select id="eBod">${bods.map(b => `<option value="${b.id}">${esc(b.nombre)}</option>`).join('')}</select></div>
      <div class="field"><label>Colaborador</label><select id="eColab"><option value="">-- elegir --</option>${cols.map(c => `<option value="${c.id}">${esc(c.nombre)} ${esc(c.apellido || '')}</option>`).join('')}</select></div></div>
    <div class="row" id="eProdRow"><div class="field"><label>Producto</label><select id="eProd"><option value="">-- elegir --</option>${prods.map(p => `<option value="${p.id}">${esc(p.sku)} - ${esc(p.nombre)} (stock ${num(p.stock,0)})</option>`).join('')}</select></div></div>
    <div class="row" id="eDescRow" style="display:none"><div class="field"><label>Herramienta / maquina</label><input id="eDesc" placeholder="Ej: Taladro Bosch, Andamio"></div></div>
    <div class="row"><div class="field"><label>Cantidad</label><input id="eCant" type="number" step="0.01" value="1"></div><div class="field"><label>Glosa</label><input id="eGlosa"></div></div>
    <div class="err" id="eErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarEntrega()">Guardar</button></div>`);
}
function entToggle() { const t = val('eTipo'); document.getElementById('eProdRow').style.display = t === 'MATERIAL' ? '' : 'none'; document.getElementById('eDescRow').style.display = t === 'HERRAMIENTA' ? '' : 'none'; }
async function guardarEntrega() {
  const t = val('eTipo');
  const body = { tipo: t, bodega_id: val('eBod'), colaborador_id: val('eColab') || null, cantidad: val('eCant'), glosa: val('eGlosa'), fecha_entrega: val('eFecha') };
  if (t === 'MATERIAL') body.producto_id = val('eProd') || null; else body.descripcion = val('eDesc');
  try { await api('POST', '/entregas', body); closeModal(); entLoad(); } catch (e) { $('#eErr').textContent = e.message; }
}
async function devolverEnt(id) { await api('POST', '/entregas/' + id + '/devolver', {}); entLoad(); }
async function delEnt(id) { if (confirm('Eliminar registro de entrega?')) { await api('DELETE', '/entregas/' + id); entLoad(); } }
async function entResumen() {
  const rows = await api('GET', '/entregas/resumen-colaborador');
  modal(`<h3>Material entregado por colaborador</h3>
    <table><tr><th>Colaborador</th><th class="num">N&deg; entregas</th><th class="num">Cantidad total</th></tr>
    ${rows.length ? rows.map(r => `<tr><td>${esc(r.colaborador || '(sin asignar)')}</td><td class="num">${r.entregas}</td><td class="num">${num(r.total_cantidad,2)}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">Sin datos</td></tr>'}</table>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
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
  window._cuentas = cu;
  $('#tesBody').innerHTML = `<div class="card"><h3>Cuentas bancarias <button class="btn" onclick="formCuenta()">+ Nueva cuenta</button></h3>
    <div class="scroll"><table><tr><th>Banco</th><th>Cuenta</th><th>N°</th><th>Moneda</th><th class="num">Saldo inicial</th><th class="num">Ingresos</th><th class="num">Egresos</th><th class="num">Saldo actual</th><th></th></tr>
    ${cu.length ? cu.map(c => `<tr><td>${esc(c.banco)}</td><td>${esc(c.nombre)}</td><td>${esc(c.numero||'')}</td><td>${c.moneda}</td><td class="num">${clp(c.saldo_inicial)}</td><td class="num">${clp(c.total_ingresos)}</td><td class="num">${clp(c.total_egresos)}</td><td class="num"><b>${clp(c.saldo_actual)}</b></td><td><button class="btn sm ghost" onclick="editarCuenta(${c.id})">Editar</button></td></tr>`).join('') + `<tr style="background:#dce6f2"><td colspan="4"><b>TOTAL</b></td><td class="num"><b>${clp(cu.reduce((a,c)=>a+(c.saldo_inicial||0),0))}</b></td><td class="num"><b>${clp(cu.reduce((a,c)=>a+(c.total_ingresos||0),0))}</b></td><td class="num"><b>${clp(cu.reduce((a,c)=>a+(c.total_egresos||0),0))}</b></td><td class="num"><b>${clp(cu.reduce((a,c)=>a+(c.saldo_actual||0),0))}</b></td><td></td></tr>` : '<tr><td colspan="9" class="empty">Sin cuentas</td></tr>'}</table></div></div>`;
}
function editarCuenta(id) { formCuenta((window._cuentas || []).find(x => x.id === id)); }
function formCuenta(c) {
  modal(`<h3>${c ? 'Editar cuenta bancaria' : 'Nueva cuenta bancaria'}</h3>
    <div class="row"><div class="field"><label>Banco</label><input id="cBanco" value="${c ? esc(c.banco) : ''}"></div><div class="field"><label>Nombre</label><input id="cNom" value="${c ? esc(c.nombre) : ''}" placeholder="Cuenta corriente"></div></div>
    <div class="row"><div class="field"><label>Numero</label><input id="cNum" value="${c ? esc(c.numero || '') : ''}"></div><div class="field"><label>Moneda</label><input id="cMon" value="${c ? esc(c.moneda) : 'CLP'}"></div></div>
    <div class="row"><div class="field"><label>Saldo inicial</label><input id="cSaldo" type="number" value="${c ? c.saldo_inicial : 0}"></div></div><div class="err" id="cErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarCuenta(${c ? c.id : 0})">Guardar</button></div>`);
}
async function guardarCuenta(id) {
  try {
    const body = { banco: val('cBanco'), nombre: val('cNom'), numero: val('cNum'), moneda: val('cMon'), saldo_inicial: val('cSaldo') };
    if (id) await api('PUT', '/tesoreria/cuentas/' + id, body); else await api('POST', '/tesoreria/cuentas', body);
    closeModal(); tesCuentas();
  } catch (e) { $('#cErr').textContent = e.message; }
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
const MESES_NOM = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
function mesLabel(ym) { if (!ym || ym === '-') return 'Sin fecha'; const [y, mm] = ym.split('-'); return MESES_NOM[Number(mm)] + ' ' + y; }
async function tesMovsLoad() {
  tesCuenta = document.getElementById('tmCuenta').value;
  const m = await api('GET', '/tesoreria/movimientos?cuenta_id=' + tesCuenta);
  window._tesMovs = m;
  const meses = [...new Set(m.map(x => (x.fecha || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  const cats = [...new Set(m.map(x => x.categoria).filter(Boolean))].sort();
  $('#tmList').innerHTML = `
    <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="max-width:160px"><label>Mes</label><select id="fMes" onchange="renderTesMovs()"><option value="">Todos</option>${meses.map(ym => `<option value="${ym}">${mesLabel(ym)}</option>`).join('')}</select></div>
      <div class="field" style="max-width:130px"><label>Tipo</label><select id="fTipo" onchange="renderTesMovs()"><option value="">Todos</option><option>INGRESO</option><option>EGRESO</option></select></div>
      <div class="field" style="max-width:210px"><label>Categoria</label><select id="fCat" onchange="renderTesMovs()"><option value="">Todas</option>${cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div>
      <div class="field" style="max-width:180px"><label>Glosa</label><input id="fGlosa" oninput="renderTesMovs()" placeholder="contiene..."></div>
      <div class="field" style="max-width:150px"><label>Monto</label><input id="fMonto" oninput="renderTesMovs()" placeholder="contiene..."></div>
      <button class="btn ghost" onclick="limpiarFiltrosTes()">Limpiar</button></div>
    <div id="tmKpis" style="margin-top:10px"></div>
    <div id="tmTable" style="margin-top:10px"></div>`;
  renderTesMovs();
}
function limpiarFiltrosTes() { ['fMes', 'fTipo', 'fCat', 'fGlosa', 'fMonto'].forEach(i => { const e = document.getElementById(i); if (e) e.value = ''; }); renderTesMovs(); }
function renderTesMovs() {
  const all = window._tesMovs || [];
  const fMes = val('fMes'), fTipo = val('fTipo'), fCat = val('fCat'), fGlosa = (val('fGlosa') || '').toLowerCase(), fMonto = (val('fMonto') || '').replace(/[^0-9]/g, '');
  const list = all.filter(x => {
    if (fMes && (x.fecha || '').slice(0, 7) !== fMes) return false;
    if (fTipo && x.tipo !== fTipo) return false;
    if (fCat && (x.categoria || '') !== fCat) return false;
    if (fGlosa && !((x.glosa || '').toLowerCase().includes(fGlosa))) return false;
    if (fMonto && !String(Math.round(Math.abs(x.monto))).includes(fMonto)) return false;
    return true;
  });
  let tIng = 0, tEg = 0;
  list.forEach(x => { if (x.tipo === 'INGRESO') tIng += x.monto; else tEg += x.monto; });
  document.getElementById('tmKpis').innerHTML = `<div class="grid g3">
    <div class="kpi"><div class="lbl">Total ingresos (filtrado)</div><div class="val" style="color:var(--verde)">${clp(tIng)}</div></div>
    <div class="kpi"><div class="lbl">Total egresos (filtrado)</div><div class="val" style="color:var(--rojo)">${clp(tEg)}</div></div>
    <div class="kpi"><div class="lbl">Neto (filtrado)</div><div class="val">${clp(tIng - tEg)}</div></div></div>`;
  const byMonth = {};
  list.forEach(x => { const k = (x.fecha || '').slice(0, 7) || '-'; (byMonth[k] = byMonth[k] || []).push(x); });
  const months = Object.keys(byMonth).sort().reverse();
  let rows = '';
  if (!list.length) rows = '<tr><td colspan="7" class="empty">Sin movimientos con esos filtros</td></tr>';
  else months.forEach(ym => {
    let mi = 0, me = 0;
    const body = byMonth[ym].map(x => { if (x.tipo === 'INGRESO') mi += x.monto; else me += x.monto; return `<tr><td>${fdate(x.fecha)}</td><td><span class="pill ${x.tipo==='INGRESO'?'ok':'no'}">${x.tipo}</span></td><td>${esc(x.categoria||'')}</td><td>${esc(x.glosa||'')}</td><td class="num">${clp(x.monto)}</td><td>${x.conciliado?'<span class="pill ok">SI</span>':'<span class="pill warn">NO</span>'}</td><td><button class="btn sm ghost" onclick="editarTesMov(${x.id})">Editar</button> <button class="btn sm red" onclick="delTesMov(${x.id})">x</button></td></tr>`; }).join('');
    rows += `<tr style="background:#eaf0f6"><td colspan="7" style="font-weight:600;color:var(--azul)">${mesLabel(ym)}</td></tr>` + body + `<tr style="background:#f4f7fb"><td colspan="4" style="text-align:right"><b>Total ${mesLabel(ym)}:</b></td><td colspan="3">Ingresos <b style="color:var(--verde)">${clp(mi)}</b> &middot; Egresos <b style="color:var(--rojo)">${clp(me)}</b> &middot; Neto <b>${clp(mi - me)}</b></td></tr>`;
  });
  document.getElementById('tmTable').innerHTML = `<div class="scroll"><table><tr><th>Fecha</th><th>Tipo</th><th>Categoria</th><th>Glosa</th><th class="num">Monto</th><th>Concil.</th><th></th></tr>${rows}</table></div>`;
}
async function delTesMov(id) { if (confirm('Eliminar movimiento?')) { await api('DELETE', '/tesoreria/movimientos/' + id); tesMovsLoad(); } }
// Conceptos de flujo de caja (coinciden con las lineas de la planilla; se reflejan de inmediato en el informe)
const CATS_FLUJO = {
  INGRESO: ['Ventas en efectivo', 'Cobros de cuentas de clientes', 'Préstamo / inyección de efectivo', 'Ingresos por intereses', 'Otros ingresos en efectivo'],
  EGRESO: ['Costos directos / materiales', 'Salarios directos', 'Subcontratistas', 'Remuneraciones / sueldos', 'Comisiones bancarias', 'Seguros', 'Arriendos', 'Servicios básicos', 'Otros gastos operativos', 'Cuotas de créditos bancarios', 'Gastos por intereses', 'Compra de activos / inversión', 'Impuestos']
};
function editarTesMov(id) { formTesMov((window._tesMovs || []).find(x => x.id === id)); }
function formTesMov(mov) {
  modal(`<h3>${mov ? 'Editar' : 'Nuevo'} ingreso / egreso</h3>
    <div class="row"><div class="field"><label>Fecha</label><input id="xFecha" type="date" value="${mov ? fdate(mov.fecha) : hoy()}"></div>
      <div class="field"><label>Tipo</label><select id="xTipo" onchange="catFlujoOpts()"><option value="INGRESO">INGRESO</option><option value="EGRESO">EGRESO</option></select></div></div>
    <div class="row"><div class="field"><label>Monto</label><input id="xMonto" type="number" value="${mov ? mov.monto : ''}"></div>
      <div class="field"><label>Categoria (concepto de flujo)</label><select id="xCat" onchange="catFlujoToggle()"></select></div></div>
    <div class="row" id="xCatOtroRow" style="display:none"><div class="field"><label>Especificar categoria</label><input id="xCatOtro"></div></div>
    <div class="row"><div class="field"><label>Documento</label><input id="xDoc" value="${mov ? esc(mov.documento || '') : ''}"></div><div class="field"><label>Glosa</label><input id="xGlosa" value="${mov ? esc(mov.glosa || '') : ''}"></div></div>
    <p class="muted" style="font-size:12px">La categoria define donde aparece el movimiento en el Flujo de caja (informe y planilla).</p>
    <div class="err" id="xErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarTesMov(${mov ? mov.id : 0})">Guardar</button></div>`);
  if (mov) document.getElementById('xTipo').value = mov.tipo;
  catFlujoOpts();
  if (mov && mov.categoria) {
    const lista = CATS_FLUJO[mov.tipo] || [];
    if (lista.includes(mov.categoria)) { document.getElementById('xCat').value = mov.categoria; }
    else { document.getElementById('xCat').value = '__otro'; document.getElementById('xCatOtro').value = mov.categoria; }
    catFlujoToggle();
  }
}
function catFlujoOpts() {
  const tipo = val('xTipo');
  const sel = document.getElementById('xCat'); if (!sel) return;
  sel.innerHTML = (CATS_FLUJO[tipo] || []).map(c => `<option>${c}</option>`).join('') + '<option value="__otro">Otro (especificar)</option>';
  catFlujoToggle();
}
function catFlujoToggle() {
  const row = document.getElementById('xCatOtroRow'); if (row) row.style.display = (val('xCat') === '__otro') ? '' : 'none';
}
async function guardarTesMov(id) {
  const cat = val('xCat') === '__otro' ? val('xCatOtro') : val('xCat');
  const body = { fecha: val('xFecha'), cuenta_id: tesCuenta, tipo: val('xTipo'), monto: val('xMonto'), categoria: cat, documento: val('xDoc'), glosa: val('xGlosa') };
  try { if (id) await api('PUT', '/tesoreria/movimientos/' + id, body); else await api('POST', '/tesoreria/movimientos', body); closeModal(); tesMovsLoad(); }
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
    $('#caRes').innerHTML = `<div class="card" style="margin-top:14px"><b>${d.importadas}</b> lineas importadas${d.omitidas ? `, <b>${d.omitidas}</b> omitidas por estar duplicadas` : ''} (lote ${d.lote}). Ve a la pestana <b>Conciliacion</b>.</div>`;
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
    <div class="scroll"><table><tr><th>Banco</th><th>Nombre</th><th>Tipo</th><th>Sistema</th><th class="num">Monto</th><th class="num">Cuota</th><th class="num">Tasa mens.</th><th>Cuotas</th><th class="num">Saldo pend.</th><th>Estado</th><th></th></tr>
    ${creds.length ? creds.map(c => `<tr><td>${esc(c.banco)}</td><td>${esc(c.nombre)}${c.glosa?`<br><span class="muted" style="font-size:11px">${esc(c.glosa)}</span>`:''}</td><td>${c.tipo||'CREDITO'}</td><td>${c.sistema}</td><td class="num">${clp(c.monto)}</td><td class="num">${clp(c.cuota||0)}</td><td class="num">${num(c.tasa_mensual,2)}%</td><td>${c.cuotas_pagadas}/${c.cuotas_total}</td><td class="num">${clp(c.saldo_pendiente)}</td><td><span class="pill ${c.estado==='PAGADO'?'ok':'warn'}">${c.estado}</span></td><td><button class="btn sm ghost" onclick="verCredito(${c.id})">Tabla</button> <button class="btn sm ghost" onclick="editarCredito(${c.id})">Editar</button></td></tr>`).join('') : '<tr><td colspan="11" class="empty">Sin creditos registrados</td></tr>'}</table></div></div>`;
}
async function formCredito() {
  const cu = await api('GET', '/tesoreria/cuentas');
  modal(`<h3>Nuevo credito / leasing</h3>
    <div class="row"><div class="field"><label>Banco / Arrendador</label><input id="kBanco"></div><div class="field"><label>Nombre / N&deg; operacion</label><input id="kNom"></div></div>
    <div class="row"><div class="field"><label>Glosa / destino (&iquest;para que fue?)</label><input id="kGlosa" placeholder="Ej: Fogape, compra camion, maquinaria"></div></div>
    <div class="row"><div class="field"><label>Tipo</label><select id="kTipo" onchange="document.getElementById('kIva').value=this.value==='LEASING'?19:0">
        <option value="CREDITO">Credito</option><option value="LEASING">Leasing</option></select></div>
      <div class="field"><label>Sistema</label><select id="kSis"><option value="FRANCES">Frances (cuota fija)</option><option value="ALEMAN">Aleman (amort. fija)</option></select></div></div>
    <div class="row"><div class="field"><label>Monto total</label><input id="kMonto" type="number"></div>
      <div class="field"><label>Pie inicial / cuota inicial pagada</label><input id="kPie" type="number" value="0"></div></div>
    <div class="row"><div class="field"><label>N&deg; cuotas</label><input id="kCuotas" type="number"></div>
      <div class="field"><label>Tasa mensual (%)</label><input id="kTasa" type="number" step="0.0001"></div>
      <div class="field"><label>IVA (%)</label><input id="kIva" type="number" value="0"></div></div>
    <div class="row"><div class="field"><label>Fecha inicio</label><input id="kFecha" type="date" value="${hoy()}"></div>
      <div class="field"><label>Cuenta de pago (opcional)</label><select id="kCuenta"><option value="">-- sin asociar --</option>${cu.map(c => `<option value="${c.id}">${esc(c.banco)} - ${esc(c.nombre)}</option>`).join('')}</select></div></div>
    <p class="muted" style="font-size:12px;margin:2px 0">Si no sabes la tasa: ingresa monto, pie y N&deg; cuotas y usa <b>Calcular tasa</b> con el valor de la cuota neta. O importa la tabla en CSV.</p>
    <div class="row"><button class="btn ghost" onclick="calcularTasaCredito()">Calcular tasa desde la cuota</button> <button class="btn ghost" onclick="var e=document.getElementById('kImp');e.style.display=e.style.display==='none'?'block':'none'">Importar tabla (CSV)</button></div>
    <div id="kImp" style="display:none;margin-top:8px"><label style="font-size:11px;color:var(--gris)">Columnas: num_cuota; fecha_vencimiento; capital; interes; valor_cuota_neta; iva; valor_cuota_total; saldo_capital; fecha_pago</label>
      <textarea id="kCSV" rows="4" placeholder="1;2025-06-23;10084034;0;10084034;1915966;12000000;54991102;2025-06-26"></textarea></div>
    <div class="err" id="kErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="simularCredito()">Simular</button> <button class="btn" onclick="guardarCredito()">Crear</button></div>
    <div id="kSim"></div>`);
}
function credBody() {
  return { tipo: val('kTipo'), glosa: val('kGlosa'), monto: val('kMonto'), pie: val('kPie'), tasa_mensual: val('kTasa'), n_cuotas: val('kCuotas'), sistema: val('kSis'), fecha_inicio: val('kFecha'), iva_pct: val('kIva') };
}
async function calcularTasaCredito() {
  const c = prompt('Valor de la cuota NETA (sin IVA):'); if (!c) return;
  try { const r = await api('POST', '/creditos/tasa-desde-cuota', { monto: val('kMonto'), pie: val('kPie'), n_cuotas: val('kCuotas'), cuota_neta: c }); document.getElementById('kTasa').value = r.tasa_mensual; }
  catch (e) { $('#kErr').textContent = e.message; }
}
function parseLeasingCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== ''); if (!lines.length) return [];
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const H = lines[0].split(sep).map(h => h.trim().toLowerCase());
  const idx = (...names) => H.findIndex(h => names.some(n => h.includes(n)));
  const iNum = idx('num', 'nro', 'n\u00b0'), iFe = idx('vencim', 'fecha_venc', 'venc'), iCap = idx('capital', 'amortiz'), iInt = idx('interes', 'inter\u00e9s'),
    iNeta = idx('neta', 'neto'), iIva = idx('iva'), iTot = idx('total'), iSal = idx('saldo'), iPag = idx('pago');
  const num = s => { if (s == null) return 0; let v = String(s).replace(/[^0-9,.\-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); return Number(v) || 0; };
  const out = [];
  for (let r = 1; r < lines.length; r++) {
    const c = lines[r].split(sep);
    const fp = iPag >= 0 ? String(c[iPag] || '').trim() : '';
    out.push({ numero: iNum >= 0 ? num(c[iNum]) : r, fecha_venc: (iFe >= 0 ? String(c[iFe]) : '').trim().slice(0, 10),
      amortizacion: iCap >= 0 ? num(c[iCap]) : 0, interes: iInt >= 0 ? num(c[iInt]) : 0,
      cuota_neta: iNeta >= 0 ? num(c[iNeta]) : 0, iva: iIva >= 0 ? num(c[iIva]) : 0,
      cuota: iTot >= 0 ? num(c[iTot]) : 0, saldo: iSal >= 0 ? num(c[iSal]) : 0,
      fecha_pago: (fp && fp.toLowerCase() !== 'nan') ? fp.slice(0, 10) : null });
  }
  return out;
}
async function simularCredito() {
  try {
    const filas = await api('POST', '/creditos/simular', credBody());
    $('#kSim').innerHTML = tablaAmort(filas);
  } catch (e) { $('#kErr').textContent = e.message; }
}
async function guardarCredito() {
  try {
    const body = { banco: val('kBanco'), nombre: val('kNom'), cuenta_id: val('kCuenta'), ...credBody() };
    const csv = val('kCSV'); if (csv) body.tabla = parseLeasingCSV(csv);
    if (!body.banco) { $('#kErr').textContent = 'Ingresa el banco/arrendador'; return; }
    await api('POST', '/creditos', body);
    closeModal(); vCreditos();
  } catch (e) { $('#kErr').textContent = e.message; }
}
function tablaAmort(filas, conPago) {
  const hayIva = filas.some(f => f.iva);
  return `<div class="scroll" style="margin-top:14px"><table><tr><th>N&deg;</th><th>Vence</th><th class="num">Capital</th><th class="num">Interes</th>${hayIva ? '<th class="num">Cuota neta</th><th class="num">IVA</th>' : ''}<th class="num">Cuota${hayIva ? ' total' : ''}</th><th class="num">Saldo</th>${conPago ? '<th></th>' : ''}</tr>
    ${filas.map(f => `<tr style="${f.pagado ? 'background:#eafaf0' : ''}"><td>${f.numero}</td><td>${fdate(f.fecha_venc)}</td><td class="num">${clp(f.amortizacion)}</td><td class="num">${clp(f.interes)}</td>${hayIva ? `<td class="num">${clp(f.cuota_neta)}</td><td class="num">${clp(f.iva)}</td>` : ''}<td class="num"><b>${clp(f.cuota)}</b></td><td class="num">${clp(f.saldo)}</td>${conPago ? `<td>${f.pagado ? '<span class="pill ok">PAGADA</span>' : `<button class="btn sm green" onclick="pagarCuota(${f._cid},${f.numero})">pagar</button>`}</td>` : ''}</tr>`).join('')}</table></div>`;
}
async function verCredito(id) {
  const c = await api('GET', '/creditos/' + id);
  c.cuotas.forEach(q => q._cid = id);
  modal(`<h3>${esc(c.banco)} - ${esc(c.nombre)} <span class="muted">(${c.tipo||'CREDITO'} / ${c.sistema})</span></h3>
    <p class="muted">${c.tipo || 'CREDITO'} · Monto ${clp(c.monto)}${c.pie ? ' · Pie ' + clp(c.pie) : ''} · ${num(c.tasa_mensual,2)}% mensual · ${c.n_cuotas} cuotas${c.iva_pct ? ' · IVA ' + c.iva_pct + '%' : ''}</p>${c.glosa ? `<p style="margin-top:-6px"><b>Destino:</b> ${esc(c.glosa)}</p>` : ''}
    ${tablaAmort(c.cuotas, true)}
    <div class="right" style="margin-top:14px"><button class="btn red" onclick="delCredito(${id})">Eliminar</button> <button class="btn ghost" onclick="editarCredito(${id})">Editar datos</button> <button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
}
async function pagarCuota(cid, numero) {
  await api('POST', `/creditos/${cid}/cuotas/${numero}/pagar`, { fecha_pago: hoy() });
  verCredito(cid);
}
async function editarCredito(id) {
  const [c, cu] = await Promise.all([api('GET', '/creditos/' + id), api('GET', '/tesoreria/cuentas')]);
  modal(`<h3>Editar credito / leasing</h3>
    <div class="row"><div class="field"><label>Banco / Arrendador</label><input id="eBanco" value="${esc(c.banco || '')}"></div><div class="field"><label>Nombre / N&deg; operacion</label><input id="eNom" value="${esc(c.nombre || '')}"></div></div>
    <div class="row"><div class="field"><label>Glosa / destino (&iquest;para que fue?)</label><input id="eGlosa" value="${esc(c.glosa || '')}" placeholder="Ej: Fogape, compra camion, maquinaria"></div></div>
    <div class="row"><div class="field"><label>Tipo</label><select id="eTipo"><option value="CREDITO" ${c.tipo !== 'LEASING' ? 'selected' : ''}>Credito</option><option value="LEASING" ${c.tipo === 'LEASING' ? 'selected' : ''}>Leasing</option></select></div>
      <div class="field"><label>Estado</label><select id="eEstado"><option ${c.estado === 'VIGENTE' ? 'selected' : ''}>VIGENTE</option><option ${c.estado === 'PAGADO' ? 'selected' : ''}>PAGADO</option></select></div></div>
    <div class="row"><div class="field"><label>Cuenta de pago</label><select id="eCuenta"><option value="">-- sin asociar --</option>${cu.map(x => `<option value="${x.id}" ${x.id == c.cuenta_id ? 'selected' : ''}>${esc(x.banco)} - ${esc(x.nombre)}</option>`).join('')}</select></div></div>
    <p class="muted" style="font-size:12px">Edita los datos descriptivos. El monto, la tasa y la tabla de cuotas no cambian aqui.</p>
    <div class="err" id="eErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarEdicionCredito(${id})">Guardar</button></div>`);
}
async function guardarEdicionCredito(id) {
  try { await api('PUT', '/creditos/' + id, { banco: val('eBanco'), nombre: val('eNom'), glosa: val('eGlosa'), tipo: val('eTipo'), estado: val('eEstado'), cuenta_id: val('eCuenta') }); closeModal(); vCreditos(); }
  catch (e) { $('#eErr').textContent = e.message; }
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
  ({ activos: actLista, alertas: actAlertas, papelera: actPapelera }[actTab] || actLista)();
}
let actFiltroCat = '';
function estadoPillActivo(e) {
  const m = { EN_USO: ['ok', 'En uso'], EN_MANTENCION: ['warn', 'En mantencion'], DADO_DE_BAJA: ['no', 'Dado de baja'] }[e] || ['ok', e || 'En uso'];
  return `<span class="pill ${m[0]}">${m[1]}</span>`;
}
async function actLista() { window._activos = await api('GET', '/activos'); renderActivos(); }
function renderActivos() {
  const all = window._activos || [];
  const cats = [...new Set(all.map(a => a.categoria || 'Sin categoria'))].sort();
  const list = actFiltroCat ? all.filter(a => (a.categoria || 'Sin categoria') === actFiltroCat) : all;
  const res = {}; let total = 0;
  all.forEach(a => { const k = a.categoria || 'Sin categoria'; res[k] = res[k] || { n: 0, v: 0 }; res[k].n++; res[k].v += a.valor_compra || 0; total += a.valor_compra || 0; });
  const resRows = Object.keys(res).sort().map(k => `<tr><td>${esc(k)}</td><td class="num">${res[k].n}</td><td class="num">${clp(res[k].v)}</td></tr>`).join('');
  $('#actBody').innerHTML = `
  <div class="card"><h3>Resumen por categoria <span class="muted">Total general: ${clp(total)} &middot; ${all.length} activos</span></h3>
    <table><tr><th>Categoria</th><th class="num">Cantidad</th><th class="num">Valor</th></tr>${resRows}<tr style="background:#dce6f2"><td><b>TOTAL</b></td><td class="num"><b>${all.length}</b></td><td class="num"><b>${clp(total)}</b></td></tr></table></div>
  <div class="card"><h3>Activos fijos <span><select id="actCat" onchange="actFiltroCat=this.value;renderActivos()" style="width:auto;min-width:170px">${['<option value="">Todas las categorias</option>'].concat(cats.map(c => `<option value="${esc(c)}" ${c === actFiltroCat ? 'selected' : ''}>${esc(c)}</option>`)).join('')}</select> <button class="btn" onclick="formActivo()">+ Nuevo activo</button></span></h3>
    <div class="scroll"><table><tr><th>Codigo</th><th>Nombre</th><th>Categoria</th><th>Estado</th><th>Proveedor</th><th>N&deg; factura</th><th class="num">Valor compra</th><th class="num">Km</th><th>Mantencion</th><th></th></tr>
    ${list.length ? list.map(x => `<tr><td>${esc(x.codigo)}</td><td>${esc(x.nombre)}</td><td>${esc(x.categoria||'')}</td><td>${estadoPillActivo(x.estado)}</td><td>${esc(x.proveedor||'')}</td><td>${esc(x.factura||'')}</td><td class="num">${clp(x.valor_compra)}</td><td class="num">${x.km_actual!=null?num(x.km_actual,0):'-'}</td><td>${['VEHICULO','MAQUINARIA'].includes((x.categoria||'').toUpperCase())?mantEstadoPill(x):'<span class="muted">-</span>'}</td><td><button class="btn sm ghost" onclick="verActivo(${x.id})">Ficha</button> <button class="btn sm ghost" onclick="editarActivo(${x.id})">Editar</button></td></tr>`).join('') : '<tr><td colspan="10" class="empty">Sin activos en esta categoria</td></tr>'}</table></div></div>`;
}
function formActivo() {
  modal(`<h3>Nuevo activo</h3>
    <div class="row"><div class="field"><label>Codigo</label><input id="aCod"></div><div class="field"><label>Nombre</label><input id="aNom"></div></div>
    <div class="row"><div class="field"><label>Categoria</label><select id="aCat"><option>VEHICULO</option><option>MAQUINARIA</option><option>EQUIPO</option><option>HERRAMIENTA</option><option>OTRO</option></select></div>
      <div class="field"><label>Estado</label><select id="aEstado"><option value="EN_USO">En uso</option><option value="EN_MANTENCION">En mantencion</option><option value="DADO_DE_BAJA">Dado de baja</option></select></div></div>
    <div class="row"><div class="field"><label>Proveedor</label><input id="aProv"></div><div class="field"><label>N&deg; factura</label><input id="aFact"></div></div>
    <div class="row"><div class="field"><label>Patente</label><input id="aPat"></div><div class="field"><label>Valor compra</label><input id="aValor" type="number"></div></div>
    <div class="row"><div class="field"><label>Marca</label><input id="aMarca"></div><div class="field"><label>Modelo</label><input id="aMod"></div></div>
    <div class="row"><div class="field"><label>Fecha compra</label><input id="aFecha" type="date"></div></div>
    <div class="row"><div class="field"><label><input type="checkbox" id="aDep"> Depreciable</label></div>
      <div class="field"><label>Vida util (meses)</label><input id="aVida" type="number" value="0"></div>
      <div class="field"><label>Valor residual</label><input id="aResid" type="number" value="0"></div></div>
    <div class="row"><div class="field"><label>Intervalo mantencion (km)</label><input id="aMantInt" type="number" value="0" placeholder="0 = usar 10.000 km"></div></div>
    <div class="err" id="aErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarActivo()">Guardar</button></div>`);
}
async function guardarActivo() {
  try { await api('POST', '/activos', { codigo: val('aCod'), nombre: val('aNom'), categoria: val('aCat'), estado: val('aEstado'), proveedor: val('aProv'), factura: val('aFact'), patente: val('aPat'), marca: val('aMarca'), modelo: val('aMod'), fecha_compra: val('aFecha'), valor_compra: val('aValor'), depreciable: document.getElementById('aDep') && document.getElementById('aDep').checked ? 1 : 0, vida_util_meses: val('aVida'), valor_residual: val('aResid'), mantencion_intervalo_km: val('aMantInt') }); closeModal(); actLista(); }
  catch (e) { $('#aErr').textContent = e.message; }
}
async function editarActivo(id) {
  const a = (window._activos || []).find(x => x.id === id) || await api('GET', '/activos/' + id);
  const cats = ['VEHICULO','MAQUINARIA','EQUIPO','HERRAMIENTA','OTRO'];
  const catOpts = cats.map(c => `<option ${a.categoria===c?'selected':''}>${c}</option>`).join('') + (cats.includes(a.categoria)||!a.categoria ? '' : `<option selected>${esc(a.categoria)}</option>`);
  const eo = (v, t) => `<option value="${v}" ${a.estado===v?'selected':''}>${t}</option>`;
  modal(`<h3>Editar activo</h3>
    <div class="row"><div class="field"><label>Codigo</label><input id="eaCod" value="${esc(a.codigo||'')}"></div><div class="field"><label>Nombre</label><input id="eaNom" value="${esc(a.nombre||'')}"></div></div>
    <div class="row"><div class="field"><label>Categoria</label><select id="eaCat">${catOpts}</select></div>
      <div class="field"><label>Estado</label><select id="eaEstado">${eo('EN_USO','En uso')}${eo('EN_MANTENCION','En mantencion')}${eo('DADO_DE_BAJA','Dado de baja')}</select></div></div>
    <div class="row"><div class="field"><label>Proveedor</label><input id="eaProv" value="${esc(a.proveedor||'')}"></div><div class="field"><label>N&deg; factura</label><input id="eaFact" value="${esc(a.factura||'')}"></div></div>
    <div class="row"><div class="field"><label>Patente</label><input id="eaPat" value="${esc(a.patente||'')}"></div><div class="field"><label>Valor compra</label><input id="eaValor" type="number" value="${a.valor_compra||0}"></div></div>
    <div class="row"><div class="field"><label>Marca</label><input id="eaMarca" value="${esc(a.marca||'')}"></div><div class="field"><label>Modelo</label><input id="eaMod" value="${esc(a.modelo||'')}"></div></div>
    <div class="row"><div class="field"><label>Fecha compra</label><input id="eaFecha" type="date" value="${a.fecha_compra||''}"></div>
      <div class="field"><label>Intervalo mantencion (km)</label><input id="eaMantInt" type="number" value="${a.mantencion_intervalo_km||0}" placeholder="0 = usar 10.000 km"></div></div>
    <div class="err" id="eaErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarEdicionActivo(${id})">Guardar</button></div>`);
}
async function guardarEdicionActivo(id) {
  try { await api('PUT', '/activos/' + id, { codigo: val('eaCod'), nombre: val('eaNom'), categoria: val('eaCat'), estado: val('eaEstado'), proveedor: val('eaProv'), factura: val('eaFact'), patente: val('eaPat'), valor_compra: val('eaValor'), marca: val('eaMarca'), modelo: val('eaMod'), fecha_compra: val('eaFecha'), mantencion_intervalo_km: val('eaMantInt') }); closeModal(); actLista(); }
  catch (e) { $('#eaErr').textContent = e.message; }
}
async function verActivo(id) {
  const a = await api('GET', '/activos/' + id);
  modal(`<h3>${esc(a.nombre)} <span class="muted">${esc(a.codigo)} · ${esc(a.patente||'')}</span></h3>
    <p class="muted" style="margin-top:-6px">${estadoPillActivo(a.estado)} · ${esc(a.categoria||'')} · Valor ${clp(a.valor_compra)}${a.proveedor?' · Prov: '+esc(a.proveedor):''}${a.factura?' · Factura '+esc(a.factura):''}</p>
    <div id="aDepr" class="muted" style="font-size:12px;margin-top:-4px"></div>
    <div class="tabs"><button class="active" onclick="actSub(event,'km',${id})">Kilometrajes</button><button onclick="actSub(event,'seg',${id})">Seguros</button><button onclick="actSub(event,'doc',${id})">Documentos</button><button onclick="actSub(event,'mant',${id})">Mantenciones</button></div>
    <div id="aSub"></div>
    <div class="right" style="margin-top:14px">${USER.rol === 'admin' ? `<button class="btn red" onclick="delActivo(${id})">Enviar a papelera</button> ` : ''}<button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
  window._activo = a; renderSub('km', id);
  if (a.depreciable) { api('GET', '/activos/' + id + '/depreciacion').then(d => { const el = document.getElementById('aDepr'); if (el && d.depreciable) el.innerHTML = 'Depreciacion lineal: ' + clp(d.depreciacion_mensual) + '/mes &middot; acumulada ' + clp(d.depreciacion_acumulada) + ' (' + d.meses_transcurridos + ' meses) &middot; <b>valor libro ' + clp(d.valor_libro) + '</b>'; }).catch(() => {}); }
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
      <table style="margin-top:12px"><tr><th>Compania</th><th>Poliza</th><th>Vence</th><th class="num">Prima</th><th>PDF</th><th></th></tr>${a.seguros.length ? a.seguros.map(s => `<tr><td>${esc(s.compania||'')}</td><td>${esc(s.poliza||'')}</td><td>${fdate(s.fecha_vencimiento)} ${venceBadge(s.fecha_vencimiento)}</td><td class="num">${clp(s.prima)}</td><td>${pdfCell('seguros',s,id)}</td><td><button class="btn sm red" onclick="delSub('seguros',${s.id},${id})">x</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Sin seguros</td></tr>'}</table>`;
  } else if (t === 'doc') {
    $('#aSub').innerHTML = `<div class="row"><div class="field"><label>Tipo</label><select id="dcT"><option>SOAP</option><option>PERMISO_CIRCULACION</option><option>REVISION_TECNICA</option><option>EMISIONES_CONTAMINANTES</option><option>SEGURO_OBLIGATORIO</option><option>PADRON</option><option>PRIMERA_INSCRIPCION</option><option>OTRO</option></select></div><div class="field"><label>Numero</label><input id="dcN"></div></div>
      <div class="row"><div class="field"><label>Emision</label><input id="dcE" type="date"></div><div class="field"><label>Vencimiento</label><input id="dcV" type="date"></div><button class="btn" onclick="addDoc(${id})">+ Agregar</button></div>
      <table style="margin-top:12px"><tr><th>Tipo</th><th>Numero</th><th>Vence</th><th>PDF</th><th></th></tr>${a.documentos.length ? a.documentos.map(d => `<tr><td>${esc(d.tipo)}</td><td>${esc(d.numero||'')}</td><td>${(['PADRON','PRIMERA_INSCRIPCION'].includes(d.tipo) || !d.fecha_vencimiento) ? '<span class="muted">No vence</span>' : fdate(d.fecha_vencimiento) + ' ' + venceBadge(d.fecha_vencimiento)}</td><td>${pdfCell('documentos',d,id)}</td><td><button class="btn sm red" onclick="delSub('documentos',${d.id},${id})">x</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Sin documentos</td></tr>'}</table>`;
  } else if (t === 'mant') {
    const mi = a.mantencion || {};
    const eb = mi.estado === 'VENCIDA' ? '<span class="pill no">Mantencion vencida</span>' : mi.estado === 'POR_VENCER' ? '<span class="pill warn">Mantencion proxima</span>' : mi.estado === 'OK' ? '<span class="pill ok">Al dia</span>' : '<span class="muted">Sin datos (registra una mantencion)</span>';
    $('#aSub').innerHTML = `<div class="muted" style="margin-bottom:8px">Intervalo: ${mi.intervalo ? num(mi.intervalo,0) : '10.000'} km &middot; Km actual: ${mi.km_actual!=null?num(mi.km_actual,0):'-'} &middot; Proxima a: ${mi.proximo_km!=null?num(mi.proximo_km,0)+' km':'-'} ${mi.km_restante!=null?'&middot; faltan '+num(mi.km_restante,0)+' km':''} ${eb}</div>
      <div class="row"><div class="field"><label>Fecha</label><input id="mtF" type="date" value="${hoy()}"></div><div class="field"><label>Km</label><input id="mtK" type="number" value="${mi.km_actual!=null?mi.km_actual:''}"></div><div class="field"><label>Tipo</label><input id="mtT" placeholder="Cambio de aceite, filtros..."></div></div>
      <div class="row"><div class="field"><label>Costo</label><input id="mtC" type="number"></div><div class="field"><label>Proximo km (opcional)</label><input id="mtP" type="number" placeholder="auto: km + intervalo"></div><div class="field"><label>Glosa</label><input id="mtG"></div><button class="btn" onclick="addMant(${id})">+ Registrar</button></div>
      <p class="muted" style="font-size:12px">El intervalo de km se configura al editar el activo. La alerta avisa 500 km antes (o si ya se paso).</p>
      <table style="margin-top:12px"><tr><th>Fecha</th><th class="num">Km</th><th>Tipo</th><th class="num">Costo</th><th class="num">Prox. km</th><th>PDF</th><th></th></tr>${a.mantenciones.length ? a.mantenciones.map(m => `<tr><td>${fdate(m.fecha)}</td><td class="num">${m.km!=null?num(m.km,0):'-'}</td><td>${esc(m.tipo||'')}</td><td class="num">${m.costo?clp(m.costo):'-'}</td><td class="num">${m.proximo_km!=null?num(m.proximo_km,0):'-'}</td><td>${pdfCell('mantenciones',m,id)}</td><td><button class="btn sm red" onclick="delSub('mantenciones',${m.id},${id})">x</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Sin mantenciones</td></tr>'}</table>`;
  }
}
function venceBadge(f) {
  if (!f) return '';
  const dias = Math.ceil((new Date(f) - new Date(hoy())) / 86400000);
  if (isNaN(dias)) return '';
  if (dias < 0) return '<span class="pill no">vencido</span>';
  if (dias <= 30) return `<span class="pill warn">${dias}d</span>`;
  return '';
}
async function addKm(id) { await api('POST', `/activos/${id}/kilometrajes`, { fecha: val('kmF'), km: val('kmV'), glosa: val('kmG') }); verActivo(id); }
async function addSeguro(id) { await api('POST', `/activos/${id}/seguros`, { compania: val('sgC'), poliza: val('sgP'), fecha_inicio: val('sgI'), fecha_vencimiento: val('sgV'), prima: val('sgPr') }); verActivo(id); }
async function addDoc(id) { await api('POST', `/activos/${id}/documentos`, { tipo: val('dcT'), numero: val('dcN'), fecha_emision: val('dcE'), fecha_vencimiento: val('dcV') }); verActivo(id); }
async function addMant(id) { await api('POST', `/activos/${id}/mantenciones`, { fecha: val('mtF'), km: val('mtK'), tipo: val('mtT'), costo: val('mtC'), proximo_km: val('mtP'), glosa: val('mtG') }); verActivo(id); }
function mantBadge(x) { if (x.mant_estado === 'VENCIDA') return '<span class="pill no" title="Mantencion vencida">mant!</span>'; if (x.mant_estado === 'POR_VENCER') return '<span class="pill warn" title="Mantencion proxima">mant</span>'; return ''; }
function mantEstadoPill(a) { if (a.mant_estado === 'VENCIDA') return '<span class="pill no">Vencida' + (a.mant_km_restante!=null?' ('+num(Math.abs(a.mant_km_restante),0)+' km)':'') + '</span>'; if (a.mant_estado === 'POR_VENCER') return '<span class="pill warn">Proxima (faltan ' + num(a.mant_km_restante,0) + ' km)</span>'; if (a.mant_estado === 'OK') return '<span class="pill ok">Al dia</span>'; return '<span class="muted">Sin datos</span>'; }
async function delSub(tipo, sid, aid) { await api('DELETE', `/activos/${tipo}/${sid}`); verActivo(aid); }
async function delActivo(id) { if (confirm('Enviar este activo a la papelera? Podras restaurarlo despues.')) { await api('DELETE', '/activos/' + id); closeModal(); actLista(); } }
async function actPapelera() {
  const rows = await api('GET', '/activos/papelera/lista');
  $('#actBody').innerHTML = `<div class="card"><h3>Papelera de activos</h3>
    <p class="muted">Activos eliminados. Puedes restaurarlos o borrarlos definitivamente.</p>
    <div class="scroll"><table><tr><th>Codigo</th><th>Nombre</th><th>Categoria</th><th class="num">Valor</th><th>Eliminado por</th><th>Fecha</th><th></th></tr>
    ${rows.length ? rows.map(a => `<tr><td>${esc(a.codigo)}</td><td>${esc(a.nombre)}</td><td>${esc(a.categoria||'')}</td><td class="num">${clp(a.valor_compra)}</td><td>${esc(a.eliminado_por||'')}</td><td>${a.eliminado_at ? new Date(a.eliminado_at).toLocaleString('es-CL') : ''}</td><td><button class="btn sm green" onclick="restaurarActivo(${a.id})">Restaurar</button> <button class="btn sm red" onclick="borrarDefinitivo(${a.id})">Borrar definitivo</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Papelera vacia</td></tr>'}</table></div></div>`;
}
async function vPapelera() {
  C().innerHTML = '<div class="empty">Cargando...</div>';
  const rows = await api('GET', '/activos/papelera/lista');
  C().innerHTML = `<div class="card"><h3>Papelera de activos eliminados</h3>
    <p class="muted">Activos enviados a la papelera. Puedes restaurarlos al modulo de Activos fijos o borrarlos definitivamente.</p>
    <div class="scroll"><table><tr><th>Codigo</th><th>Nombre</th><th>Categoria</th><th class="num">Valor</th><th>Eliminado por</th><th>Fecha</th><th></th></tr>
    ${rows.length ? rows.map(a => `<tr><td>${esc(a.codigo)}</td><td>${esc(a.nombre)}</td><td>${esc(a.categoria||'')}</td><td class="num">${clp(a.valor_compra)}</td><td>${esc(a.eliminado_por||'')}</td><td>${a.eliminado_at ? new Date(a.eliminado_at).toLocaleString('es-CL') : ''}</td><td><button class="btn sm green" onclick="restaurarActivo(${a.id})">Restaurar</button> <button class="btn sm red" onclick="borrarDefinitivo(${a.id})">Borrar definitivo</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Papelera vacia</td></tr>'}</table></div></div>`;
}
async function restaurarActivo(id) { await api('POST', '/activos/' + id + '/restaurar', {}); vPapelera(); }
async function borrarDefinitivo(id) { if (confirm('Borrar DEFINITIVAMENTE este activo? Esta accion no se puede deshacer.')) { await api('DELETE', '/activos/' + id + '/definitivo'); vPapelera(); } }
function pdfCell(tipo, x, aid) {
  const ver = x.archivo ? `<a href="#" onclick="descArch('${tipo}',${x.id});return false" style="margin-right:8px">ver PDF</a>` : '';
  return `${ver}<label class="btn sm ghost" style="cursor:pointer;margin:0">${x.archivo ? 'cambiar' : 'subir PDF'}<input type="file" accept="application/pdf" style="display:none" onchange="subirArch('${tipo}',${x.id},${aid},this)"></label>`;
}
async function descArch(tipo, id) {
  try {
    const r = await fetch('/api/activos/' + tipo + '/' + id + '/archivo', { headers: { Authorization: 'Bearer ' + TOKEN, 'X-Empresa': activeEmpresa() } });
    if (!r.ok) { alert('No se pudo abrir el PDF.'); return; }
    const b = await r.blob(); const url = URL.createObjectURL(b); window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { alert('Error al abrir el PDF: ' + e.message); }
}
async function subirArch(tipo, id, aid, input) {
  const file = input.files[0]; if (!file) return;
  if (file.size > 12 * 1024 * 1024) { alert('El archivo supera 12MB.'); return; }
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      await api('POST', '/activos/' + tipo + '/' + id + '/archivo', { nombre: file.name, mime: file.type || 'application/pdf', base64: String(rd.result).split(',')[1] });
      verActivo(aid);
    } catch (e) { alert('Error al subir: ' + e.message); }
  };
  rd.readAsDataURL(file);
}
async function actAlertas() {
  const al = await api('GET', '/activos/alertas/vencimientos?dias=60');
  $('#actBody').innerHTML = `<div class="card"><h3>Vencimientos proximos (60 dias) y vencidos</h3>
    <table><tr><th>Tipo</th><th>Activo</th><th>Patente</th><th>Detalle</th><th>Vence</th><th>Estado</th></tr>
    ${al.length ? al.map(x => `<tr><td>${x.clase}</td><td>${esc(x.activo)}</td><td>${esc(x.patente||'')}</td><td>${esc(x.detalle)}</td><td>${x.km?'<span class="muted">por km</span>':fdate(x.fecha_vencimiento)}</td><td><span class="pill ${x.estado==='VENCIDO'?'no':'warn'}">${x.estado}</span></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Sin vencimientos proximos</td></tr>'}</table></div>`;
}

// ===================== USUARIOS =====================
async function vUsuarios() {
  const us = await api('GET', '/usuarios');
  C().innerHTML = `<div class="card"><h3>Usuarios <button class="btn" onclick="formUsuario()">+ Nuevo usuario</button></h3>
    <table><tr><th>Nombre</th><th>Email</th><th>Empresa</th><th>Rol</th><th>Activo</th><th></th></tr>
    ${us.map(u => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.email)}</td><td>${u.empresa && BRANDS[u.empresa] ? esc(BRANDS[u.empresa].nombre) : '<span class="muted">Todas</span>'}</td><td>${u.rol}</td><td>${u.activo ? '<span class="pill ok">SI</span>' : '<span class="pill no">NO</span>'}</td><td><button class="btn sm ghost" onclick="formResetPass(${u.id},'${esc(u.email)}')">Resetear clave</button></td></tr>`).join('')}</table></div>`;
}
async function formUsuario() {
  let bods = [];
  try { bods = await api('GET', '/inventario/bodegas'); } catch (e) {}
  modal(`<h3>Nuevo usuario</h3>
    <div class="row"><div class="field"><label>Nombre</label><input id="uNom"></div><div class="field"><label>Email</label><input id="uEmail" type="email"></div></div>
    <div class="row"><div class="field"><label>Contrasena</label><input id="uPass" type="password"></div><div class="field"><label>Rol</label><select id="uRol" onchange="uRolToggle()"><option value="usuario">usuario</option><option value="admin">admin</option><option value="bodeguero">bodeguero (acceso solo a su bodega)</option></select></div></div>
    <div class="row"><div class="field"><label>Empresa</label><select id="uEmp"><option value="">Todas (puede cambiar)</option><option value="trabancura">Trabancura</option><option value="jmc">JMC Ingenieria</option></select></div></div>
    <div class="row" id="uBodRow" style="display:none"><div class="field"><label>Bodega asignada</label><select id="uBod"><option value="">-- elegir bodega --</option>${bods.map(b => `<option value="${b.id}">${esc(b.nombre)} (${esc(b.tipo || '')})</option>`).join('')}</select></div></div>
    <div class="err" id="uErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarUsuario()">Guardar</button></div>`);
}
function uRolToggle() { const r = document.getElementById('uBodRow'); if (r) r.style.display = (val('uRol') === 'bodeguero') ? '' : 'none'; }
async function guardarUsuario() {
  try { await api('POST', '/usuarios', { nombre: val('uNom'), email: val('uEmail'), password: val('uPass'), rol: val('uRol'), empresa: val('uEmp'), bodega_id: val('uRol') === 'bodeguero' ? (val('uBod') || null) : null }); closeModal(); vUsuarios(); }
  catch (e) { $('#uErr').textContent = e.message; }
}

// ===================== FLUJO DE CAJA =====================
let flujoTab = 'reporte';
let flujoParams = { granularidad: 'mensual', desde: inicioAno(), hasta: null, saldo_minimo: 0 };
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
  let ev = null; try { ev = await api('POST', '/flujo/eventos', flujoParams); } catch (e) {}
  $('#fjRes').innerHTML = renderReporte(r, ev);
}
function renderReporte(r, ev) {
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
    </table></div>` + renderDetalleCategorias(ev);
}
function renderDetalleCategorias(ev) {
  if (!ev || !ev.eventos) return '';
  const acc = {};
  PLAN_SECCIONES.forEach(sec => sec.lines.forEach(([k]) => acc[k] = { real: 0, proy: 0 }));
  ev.eventos.forEach(e => { const k = planMapLinea(e); if (acc[k]) acc[k][e.clase === 'REAL' ? 'real' : 'proy'] += e.monto; });
  const cell = v => `<td class="num">${v ? clp(v) : '<span class="muted">—</span>'}</td>`;
  return `<div class="card"><h3>Detalle por categoria (concepto de flujo)</h3>
    <p class="muted" style="margin-top:-6px">Refleja directamente la categoria que asignas a cada ingreso/egreso en Tesoreria.</p>
    <div class="scroll"><table><tr><th>Concepto</th><th class="num">Real</th><th class="num">Proyectado</th></tr>
    ${PLAN_SECCIONES.map(sec => `<tr><td colspan="3" style="background:#eaf0f6;font-weight:600;color:var(--azul)">${sec.titulo}</td></tr>` +
      sec.lines.map(([k, lab]) => `<tr><td>&nbsp;&nbsp;${lab}</td>${cell(acc[k].real)}${cell(acc[k].proy)}</tr>`).join('')).join('')}
    </table></div></div>`;
}
async function fjProy() {
  const items = await api('GET', '/flujo/proyeccion');
  window._proyItems = items;
  $('#fjBody').innerHTML = `<div class="card"><h3>Movimientos proyectados <button class="btn" onclick="formProy()">+ Nuevo movimiento</button></h3>
    <p class="muted" style="margin-bottom:10px">Las cuotas de creditos pendientes se proyectan automaticamente como egresos de financiamiento.</p>
    <div class="scroll"><table><tr><th>Fecha</th><th>Tipo</th><th>Actividad</th><th>Categoria</th><th>Descripcion</th><th>Cliente</th><th class="num">Monto</th><th class="num">Prob.</th><th>Extra/Var.</th><th></th></tr>
    ${items.length ? items.map(i => `<tr><td>${fdate(i.fecha)}</td><td><span class="pill ${i.tipo === 'INGRESO' ? 'ok' : 'no'}">${i.tipo}</span></td><td>${i.actividad}</td><td>${esc(i.categoria || '')}</td><td>${esc(i.descripcion || '')}</td><td>${esc(i.cliente || '')}</td><td class="num">${clp(i.monto)}</td><td class="num">${i.probabilidad}%</td><td>${i.extra_contable ? '<span class="pill warn">Si</span>' : ''}</td><td><button class="btn sm" onclick="editarProy(${i.id})">Editar</button> <button class="btn sm red" onclick="delProy(${i.id})">x</button></td></tr>`).join('') : '<tr><td colspan="10" class="empty">Sin proyecciones</td></tr>'}
    </table></div></div>`;
}
function editarProy(id) { formProy((window._proyItems || []).find(x => x.id === id)); }
function formProy(mov) {
  modal(`<h3>${mov ? 'Editar' : 'Nuevo'} movimiento proyectado</h3>
    <div class="row"><div class="field"><label>Fecha</label><input id="fpF" type="date" value="${mov ? fdate(mov.fecha) : hoy()}"></div>
      <div class="field"><label>Tipo</label><select id="fpT" onchange="catProyOpts()"><option value="INGRESO">INGRESO</option><option value="EGRESO">EGRESO</option></select></div></div>
    <div class="row"><div class="field"><label>Actividad</label><select id="fpA"><option value="OPERACIONAL">Operacional</option><option value="INVERSION">Inversion</option><option value="FINANCIAMIENTO">Financiamiento</option></select></div>
      <div class="field"><label>Categoria (concepto de flujo)</label><select id="fpC" onchange="catProyToggle()"></select></div></div>
    <div class="row" id="fpCOtroRow" style="display:none"><div class="field"><label>Especificar categoria</label><input id="fpCOtro"></div></div>
    <div class="row"><div class="field"><label>Descripcion</label><input id="fpD" value="${mov ? esc(mov.descripcion || '') : ''}"></div></div>
    <div class="row"><div class="field"><label>Monto</label><input id="fpM" type="number" value="${mov ? mov.monto : ''}"></div>
      <div class="field"><label>Probabilidad de ocurrencia (%)</label><input id="fpP" type="number" value="${mov ? mov.probabilidad : 100}"></div></div>
    <div class="row"><div class="field"><label>Cliente (opcional)</label><input id="fpCl" value="${mov ? esc(mov.cliente || '') : ''}"></div>
      <div class="field"><label>Movimiento</label><label style="font-weight:400;display:block;padding-top:8px"><input type="checkbox" id="fpE" style="width:auto" ${mov && mov.extra_contable ? 'checked' : ''}> Extra contable / variable</label></div></div>
    <p class="muted" style="font-size:12px">La categoria define donde aparece el movimiento en el Flujo de caja (informe y planilla).</p>
    <div class="err" id="fpErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarProy(${mov ? mov.id : 0})">Guardar</button></div>`);
  if (mov) { document.getElementById('fpT').value = mov.tipo; document.getElementById('fpA').value = mov.actividad || 'OPERACIONAL'; }
  catProyOpts();
  if (mov && mov.categoria) {
    const lista = CATS_FLUJO[mov.tipo] || [];
    if (lista.includes(mov.categoria)) { document.getElementById('fpC').value = mov.categoria; }
    else { document.getElementById('fpC').value = '__otro'; document.getElementById('fpCOtro').value = mov.categoria; }
    catProyToggle();
  }
}
function catProyOpts() {
  const tipo = val('fpT');
  const sel = document.getElementById('fpC'); if (!sel) return;
  sel.innerHTML = (CATS_FLUJO[tipo] || []).map(c => `<option>${c}</option>`).join('') + '<option value="__otro">Otro (especificar)</option>';
  catProyToggle();
}
function catProyToggle() {
  const row = document.getElementById('fpCOtroRow'); if (row) row.style.display = (val('fpC') === '__otro') ? '' : 'none';
}
async function guardarProy(id) {
  const cat = val('fpC') === '__otro' ? val('fpCOtro') : val('fpC');
  const body = { fecha: val('fpF'), tipo: val('fpT'), actividad: val('fpA'), categoria: cat, descripcion: val('fpD'), monto: val('fpM'), probabilidad: val('fpP'), cliente: val('fpCl'), extra_contable: document.getElementById('fpE').checked };
  try {
    if (id) await api('PUT', '/flujo/proyeccion/' + id, body); else await api('POST', '/flujo/proyeccion', body);
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
  const desde = inicioMes(), hasta = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
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

// ===================== CUENTAS POR COBRAR / PAGAR =====================
let facTipo = 'COBRAR';
async function vFacturas() {
  C().innerHTML = `<div class="tabs">
    <button data-ft="COBRAR">Por cobrar (clientes)</button>
    <button data-ft="PAGAR">Por pagar (proveedores)</button></div><div id="facBody"></div>`;
  C().querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { facTipo = b.dataset.ft; renderFac(); }));
  renderFac();
}
function renderFac() {
  C().querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.ft === facTipo));
  facLista();
}
async function facLista() {
  const d = await api('GET', '/facturas?tipo=' + facTipo);
  window._facturas = d.items;
  const esCobrar = facTipo === 'COBRAR';
  const pend = esCobrar ? d.resumen.cobrar_pend : d.resumen.pagar_pend;
  const hoyD = new Date(hoy() + 'T00:00:00');
  const bk = { venc: 0, b30: 0, b60: 0, b90: 0, bmas: 0 };
  d.items.filter(x => x.estado === 'PENDIENTE').forEach(x => {
    const dd = Math.ceil((new Date((x.fecha_vencimiento || hoy()) + 'T00:00:00') - hoyD) / 86400000);
    if (dd < 0) bk.venc += x.monto; else if (dd <= 30) bk.b30 += x.monto; else if (dd <= 60) bk.b60 += x.monto; else if (dd <= 90) bk.b90 += x.monto; else bk.bmas += x.monto;
  });
  $('#facBody').innerHTML = `<div class="card">
    <h3>${esCobrar ? 'Cuentas por cobrar' : 'Cuentas por pagar'} <button class="btn" onclick="formFactura()">+ Nueva factura ${esCobrar ? 'por cobrar' : 'por pagar'}</button> <button class="btn ghost" onclick="formImportFac()">Importar CSV</button> <button class="btn ghost" onclick="exportarVista()">Exportar Excel</button></h3>
    <p class="muted">Total pendiente ${esCobrar ? 'por cobrar' : 'por pagar'}: <b>${clp(pend)}</b>. Las pendientes se proyectan en el <b>Flujo de caja</b> por su fecha de vencimiento (mientras no se paguen siguen como saldo pendiente).</p>
    <div class="grid g4" style="margin:6px 0 14px">
      <div class="kpi"><div class="lbl">Vencido</div><div class="val" style="color:var(--rojo)">${clp(bk.venc)}</div></div>
      <div class="kpi"><div class="lbl">Por vencer 0-30 dias</div><div class="val">${clp(bk.b30)}</div></div>
      <div class="kpi"><div class="lbl">31-60 dias</div><div class="val">${clp(bk.b60)}</div></div>
      <div class="kpi"><div class="lbl">61-90 dias</div><div class="val">${clp(bk.b90)}</div></div>
      <div class="kpi"><div class="lbl">+ de 90 dias</div><div class="val">${clp(bk.bmas)}</div></div>
    </div>
    <div class="scroll"><table><tr><th>${esCobrar ? 'Cliente' : 'Proveedor'}</th><th>RUT</th><th>N&deg; Factura</th><th>Emision</th><th>Vence</th><th class="num">Monto</th><th>Estado</th><th></th></tr>
    ${d.items.length ? d.items.map(f => `<tr><td>${esc(f.contraparte || '')}</td><td>${esc(f.rut || '')}</td><td>${esc(f.numero || '')}</td><td>${fdate(f.fecha_emision)}</td><td>${fdate(f.fecha_vencimiento)} ${f.estado === 'PENDIENTE' ? venceBadge(f.fecha_vencimiento) : ''}</td><td class="num">${clp(f.monto)}</td><td>${f.estado === 'PAGADA' ? `<span class="pill ok">${esCobrar ? 'COBRADA' : 'PAGADA'}</span>` : '<span class="pill warn">PENDIENTE</span>'}</td>
      <td>${f.estado === 'PENDIENTE' ? `<button class="btn sm green" onclick="pagarFactura(${f.id})">${esCobrar ? 'Cobrar' : 'Pagar'}</button> <button class="btn sm ghost" onclick="formFactura(${f.id})">Editar</button> ` : ''}<button class="btn sm red" onclick="delFactura(${f.id})">x</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">Sin registros</td></tr>'}</table></div></div>`;
}
function formFactura(id) {
  const f = id ? (window._facturas || []).find(x => x.id === id) : null;
  const esCobrar = facTipo === 'COBRAR';
  modal(`<h3>${id ? 'Editar' : 'Nueva'} factura ${esCobrar ? 'por cobrar' : 'por pagar'}</h3>
    <div class="row"><div class="field"><label>${esCobrar ? 'Cliente' : 'Proveedor'}</label><input id="faC" value="${f ? esc(f.contraparte || '') : ''}"></div><div class="field"><label>RUT</label><input id="faR" value="${f ? esc(f.rut || '') : ''}"></div></div>
    <div class="row"><div class="field"><label>N&deg; Factura</label><input id="faN" value="${f ? esc(f.numero || '') : ''}"></div><div class="field"><label>Monto</label><input id="faM" type="number" value="${f ? f.monto : ''}"></div></div>
    <div class="row"><div class="field"><label>Fecha emision</label><input id="faE" type="date" value="${f && f.fecha_emision ? fdate(f.fecha_emision) : ''}"></div><div class="field"><label>Fecha vencimiento</label><input id="faV" type="date" value="${f && f.fecha_vencimiento ? fdate(f.fecha_vencimiento) : ''}"></div></div>
    <div class="row"><div class="field"><label>Glosa / detalle</label><input id="faG" value="${f ? esc(f.glosa || '') : ''}"></div></div>
    <div class="err" id="faErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarFactura(${id || 0})">Guardar</button></div>`);
}
async function guardarFactura(id) {
  const body = { tipo: facTipo, contraparte: val('faC'), rut: val('faR'), numero: val('faN'), monto: val('faM'), fecha_emision: val('faE'), fecha_vencimiento: val('faV'), glosa: val('faG') };
  if (!body.fecha_vencimiento || !body.monto) { $('#faErr').textContent = 'Fecha de vencimiento y monto son obligatorios.'; return; }
  try { if (id) await api('PUT', '/facturas/' + id, body); else await api('POST', '/facturas', body); closeModal(); facLista(); }
  catch (e) { $('#faErr').textContent = e.message; }
}
async function pagarFactura(id) {
  const cu = await api('GET', '/tesoreria/cuentas');
  const esCobrar = facTipo === 'COBRAR';
  modal(`<h3>${esCobrar ? 'Registrar cobro' : 'Registrar pago'}</h3>
    <p class="muted">Si eliges una cuenta, se genera el movimiento en Tesoreria automaticamente (opcional).</p>
    <div class="row"><div class="field"><label>Fecha</label><input id="pgF" type="date" value="${hoy()}"></div>
      <div class="field"><label>Cuenta (opcional)</label><select id="pgC"><option value="">-- sin movimiento --</option>${cu.map(c => `<option value="${c.id}">${esc(c.banco)} - ${esc(c.nombre)}</option>`).join('')}</select></div></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn green" onclick="doPagarFactura(${id})">Confirmar</button></div>`);
}
async function doPagarFactura(id) { await api('POST', '/facturas/' + id + '/pagar', { fecha_pago: val('pgF'), cuenta_id: val('pgC') || null }); closeModal(); facLista(); }
async function delFactura(id) { if (confirm('Eliminar esta factura?')) { await api('DELETE', '/facturas/' + id); facLista(); } }
function formImportFac() {
  const esCobrar = facTipo === 'COBRAR';
  modal(`<h3>Importar ${esCobrar ? 'cuentas por cobrar' : 'cuentas por pagar'} (CSV)</h3>
    <p class="muted" style="margin-bottom:10px">Columnas reconocidas: <b>${esCobrar ? 'cliente' : 'proveedor'}, rut, numero, emision, vencimiento, monto, glosa</b> (separador ; o ,). Fechas dd/mm/aaaa o aaaa-mm-dd. Se omiten filas sin vencimiento o monto, y las ya cargadas.</p>
    <div class="row"><div class="field"><label>Archivo CSV</label><input id="fiFile" type="file" accept=".csv,text/csv" onchange="leerCSVFac()"></div></div>
    <div class="row"><div class="field"><label>Contenido CSV</label><textarea id="fiTxt" rows="7" placeholder="${esCobrar ? 'cliente' : 'proveedor'};rut;numero;emision;vencimiento;monto"></textarea></div></div>
    <div class="err" id="fiErr"></div><div id="fiRes"></div>
    <div class="right" style="margin-top:10px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="importarFac()">Importar</button></div>`);
}
function leerCSVFac() {
  const f = document.getElementById('fiFile').files[0]; if (!f) return;
  const r = new FileReader(); r.onload = () => { document.getElementById('fiTxt').value = r.result; }; r.readAsText(f, 'utf-8');
}
async function importarFac() {
  try {
    let csv = val('fiTxt');
    if (!csv) { const fi = document.getElementById('fiFile'); if (fi && fi.files[0]) csv = await fi.files[0].text(); }
    if (!csv) { $('#fiErr').textContent = 'Selecciona un archivo CSV o pega el contenido primero.'; return; }
    const d = await api('POST', '/facturas/import', { tipo: facTipo, csv });
    $('#fiRes').innerHTML = `<div class="card" style="margin-top:10px"><b>${d.importadas}</b> importadas${d.omitidas ? `, <b>${d.omitidas}</b> omitidas` : ''}.</div>`;
    facLista();
  } catch (e) { $('#fiErr').textContent = e.message; }
}

// ===================== STOCK CRITICO =====================
async function invStockCritico() {
  const rows = await api('GET', '/inventario/stock-critico');
  $('#invBody').innerHTML = `<div class="card"><h3>Stock critico</h3>
    <p class="muted">Productos en o bajo el stock minimo. Conviene reponer / generar solicitud de compra.</p>
    <div class="scroll"><table><tr><th>SKU</th><th>Producto</th><th class="num">Stock</th><th class="num">Stock min</th><th class="num">PMP</th></tr>
    ${rows.length ? rows.map(p => `<tr style="background:#fff5f5"><td>${esc(p.sku)}</td><td>${esc(p.nombre)}</td><td class="num" style="color:var(--rojo);font-weight:600">${num(p.stock,2)}</td><td class="num">${num(p.stock_minimo,2)}</td><td class="num">${clp(p.costo_promedio)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">Sin productos bajo el minimo</td></tr>'}</table></div></div>`;
}

// ===================== PROVEEDORES Y CLIENTES =====================
let terTipo = '';
async function vTerceros() {
  const ts = await api('GET', '/terceros' + (terTipo ? '?tipo=' + terTipo : '')); window._terceros = ts;
  C().innerHTML = `<div class="card"><h3>Proveedores y clientes <button class="btn" onclick="formTercero()">+ Nuevo</button></h3>
    <div class="row"><div class="field" style="max-width:220px"><label>Filtrar</label><select id="terF" onchange="terTipo=this.value;vTerceros()"><option value="">Todos</option><option value="PROVEEDOR">Proveedores</option><option value="CLIENTE">Clientes</option></select></div></div>
    <div class="scroll"><table><tr><th>Tipo</th><th>RUT</th><th>Nombre / Razon social</th><th>Giro</th><th>Contacto</th><th>Email</th><th>Telefono</th><th></th></tr>
    ${ts.length ? ts.map(t => `<tr><td>${esc(t.tipo)}</td><td>${esc(t.rut||'')}</td><td>${esc(t.nombre)}</td><td>${esc(t.giro||'')}</td><td>${esc(t.contacto||'')}</td><td>${esc(t.email||'')}</td><td>${esc(t.telefono||'')}</td><td><button class="btn sm ghost" onclick="editarTercero(${t.id})">Editar</button> <button class="btn sm red" onclick="delTercero(${t.id})">x</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">Sin registros</td></tr>'}</table></div></div>`;
  document.getElementById('terF').value = terTipo;
}
function editarTercero(id) { formTercero((window._terceros || []).find(x => x.id === id)); }
function formTercero(t) {
  modal(`<h3>${t ? 'Editar' : 'Nuevo'} proveedor / cliente</h3>
    <div class="row"><div class="field"><label>Tipo</label><select id="tTipo"><option value="PROVEEDOR">Proveedor</option><option value="CLIENTE">Cliente</option><option value="AMBOS">Ambos</option></select></div><div class="field"><label>RUT</label><input id="tRut" value="${t ? esc(t.rut || '') : ''}"></div></div>
    <div class="row"><div class="field"><label>Nombre / Razon social</label><input id="tNom" value="${t ? esc(t.nombre) : ''}"></div><div class="field"><label>Giro</label><input id="tGiro" value="${t ? esc(t.giro || '') : ''}"></div></div>
    <div class="row"><div class="field"><label>Contacto</label><input id="tCont" value="${t ? esc(t.contacto || '') : ''}"></div><div class="field"><label>Email</label><input id="tEmail" value="${t ? esc(t.email || '') : ''}"></div></div>
    <div class="row"><div class="field"><label>Telefono</label><input id="tTel" value="${t ? esc(t.telefono || '') : ''}"></div><div class="field"><label>Direccion</label><input id="tDir" value="${t ? esc(t.direccion || '') : ''}"></div></div>
    <div class="err" id="tErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarTercero(${t ? t.id : 0})">Guardar</button></div>`);
  if (t) document.getElementById('tTipo').value = t.tipo;
}
async function guardarTercero(id) {
  const body = { tipo: val('tTipo'), rut: val('tRut'), nombre: val('tNom'), giro: val('tGiro'), contacto: val('tCont'), email: val('tEmail'), telefono: val('tTel'), direccion: val('tDir') };
  try { if (id) await api('PUT', '/terceros/' + id, body); else await api('POST', '/terceros', body); closeModal(); vTerceros(); } catch (e) { $('#tErr').textContent = e.message; }
}
async function delTercero(id) { if (confirm('Eliminar?')) { await api('DELETE', '/terceros/' + id); vTerceros(); } }

// ===================== ARRIENDO DE MAQUINARIAS =====================
async function vMaquinarias() {
  const [ms, provs, activos] = await Promise.all([api('GET', '/maquinarias'), api('GET', '/terceros?tipo=PROVEEDOR'), api('GET', '/activos')]); window._maqs = ms; window._provsMaq = provs;
  const maqProp = (activos || []).filter(a => ['MAQUINARIA','VEHICULO'].includes((a.categoria || '').toUpperCase()));
  const panelMant = `<div class="card"><h3>Maquinaria y vehiculos propios &mdash; mantenciones</h3>
    <p class="muted" style="margin-bottom:10px">Estado de mantencion por kilometraje de la maquinaria registrada en Activos fijos. Gestiona las mantenciones desde la ficha.</p>
    <div class="scroll"><table><tr><th>Codigo</th><th>Tipo</th><th>Nombre</th><th>Patente</th><th class="num">Km actual</th><th class="num">Proxima a</th><th>Mantencion</th><th></th></tr>
    ${maqProp.length ? maqProp.map(a => `<tr><td>${esc(a.codigo)}</td><td>${esc(a.categoria||'')}</td><td>${esc(a.nombre)}</td><td>${esc(a.patente||'')}</td><td class="num">${a.km_actual!=null?num(a.km_actual,0):'-'}</td><td class="num">${a.mant_proximo_km!=null?num(a.mant_proximo_km,0):'-'}</td><td>${mantEstadoPill(a)}</td><td><button class="btn sm ghost" onclick="verActivo(${a.id})">Ficha</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">Sin maquinaria ni vehiculos registrados en Activos fijos</td></tr>'}</table></div></div>`;
  C().innerHTML = panelMant + `<div class="card"><h3>Arriendo de maquinarias <button class="btn" onclick="formMaq()">+ Nuevo arriendo</button></h3>
    <div class="scroll"><table><tr><th>Maquina</th><th>Proveedor</th><th>Inicio</th><th>Fin</th><th>Periodo</th><th class="num">Costo</th><th>Obra</th><th>Estado</th><th></th></tr>
    ${ms.length ? ms.map(m => `<tr><td>${esc(m.maquina)}</td><td>${esc(m.proveedor||'')}</td><td>${fdate(m.fecha_inicio)}</td><td>${fdate(m.fecha_fin)}</td><td>${esc(m.periodo)}</td><td class="num">${clp(m.costo_periodo)}</td><td>${esc(m.obra||'')}</td><td>${m.estado === 'DEVUELTA' ? '<span class="pill ok">DEVUELTA</span>' : '<span class="pill warn">VIGENTE</span>'}</td><td>${m.estado !== 'DEVUELTA' ? `<button class="btn sm green" onclick="devolverMaq(${m.id})">Devolver</button> ` : ''}<button class="btn sm ghost" onclick="editarMaq(${m.id})">Editar</button> <button class="btn sm red" onclick="delMaq(${m.id})">x</button></td></tr>`).join('') : '<tr><td colspan="9" class="empty">Sin arriendos</td></tr>'}</table></div></div>`;
}
function editarMaq(id) { formMaq((window._maqs || []).find(x => x.id === id)); }
function formMaq(m) {
  const provs = window._provsMaq || [];
  modal(`<h3>${m ? 'Editar' : 'Nuevo'} arriendo de maquinaria</h3>
   <div class="row"><div class="field"><label>Maquina</label><input id="mMaq" value="${m ? esc(m.maquina) : ''}"></div><div class="field"><label>Proveedor</label><select id="mProv"><option value="">--</option>${provs.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></div></div>
   <div class="row"><div class="field"><label>Inicio</label><input id="mIni" type="date" value="${m && m.fecha_inicio ? fdate(m.fecha_inicio) : ''}"></div><div class="field"><label>Fin</label><input id="mFin" type="date" value="${m && m.fecha_fin ? fdate(m.fecha_fin) : ''}"></div></div>
   <div class="row"><div class="field"><label>Periodo</label><select id="mPer"><option>MES</option><option>SEMANA</option><option>DIA</option></select></div><div class="field"><label>Costo por periodo</label><input id="mCost" type="number" value="${m ? m.costo_periodo : ''}"></div></div>
   <div class="row"><div class="field"><label>Obra</label><input id="mObra" value="${m ? esc(m.obra || '') : ''}"></div><div class="field"><label>Glosa</label><input id="mGlosa" value="${m ? esc(m.glosa || '') : ''}"></div></div>
   <div class="err" id="mErr"></div>
   <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarMaq(${m ? m.id : 0})">Guardar</button></div>`);
  if (m) { if (m.proveedor_id) document.getElementById('mProv').value = m.proveedor_id; document.getElementById('mPer').value = m.periodo || 'MES'; }
}
async function guardarMaq(id) {
  const body = { maquina: val('mMaq'), proveedor_id: val('mProv') || null, fecha_inicio: val('mIni'), fecha_fin: val('mFin'), periodo: val('mPer'), costo_periodo: val('mCost'), obra: val('mObra'), glosa: val('mGlosa') };
  try { if (id) await api('PUT', '/maquinarias/' + id, body); else await api('POST', '/maquinarias', body); closeModal(); vMaquinarias(); } catch (e) { $('#mErr').textContent = e.message; }
}
async function devolverMaq(id) { await api('POST', '/maquinarias/' + id + '/devolver', {}); vMaquinarias(); }
async function delMaq(id) { if (confirm('Eliminar?')) { await api('DELETE', '/maquinarias/' + id); vMaquinarias(); } }

// ===================== BOLETAS DE GARANTIA =====================
async function vGarantias() {
  const gs = await api('GET', '/garantias'); window._gar = gs;
  C().innerHTML = `<div class="card"><h3>Boletas de garantia <button class="btn" onclick="formGar()">+ Nueva boleta</button></h3>
    <div class="scroll"><table><tr><th>Tipo</th><th>N&deg;</th><th>Banco</th><th>Beneficiario</th><th>Glosa/Obra</th><th class="num">Monto</th><th>Emision</th><th>Vence</th><th>Estado</th><th></th></tr>
    ${gs.length ? gs.map(g => `<tr><td>${esc(g.tipo)}</td><td>${esc(g.numero||'')}</td><td>${esc(g.banco||'')}</td><td>${esc(g.beneficiario||'')}</td><td>${esc(g.glosa||'')}</td><td class="num">${clp(g.monto)}</td><td>${fdate(g.fecha_emision)}</td><td>${fdate(g.fecha_vencimiento)} ${g.fecha_vencimiento && g.estado === 'VIGENTE' ? venceBadge(g.fecha_vencimiento) : ''}</td><td>${g.estado}</td><td><button class="btn sm ghost" onclick="editarGar(${g.id})">Editar</button> <button class="btn sm red" onclick="delGar(${g.id})">x</button></td></tr>`).join('') : '<tr><td colspan="10" class="empty">Sin boletas</td></tr>'}</table></div></div>`;
}
function editarGar(id) { formGar((window._gar || []).find(x => x.id === id)); }
function formGar(g) {
  modal(`<h3>${g ? 'Editar' : 'Nueva'} boleta de garantia</h3>
   <div class="row"><div class="field"><label>Tipo</label><select id="gTipo"><option value="EMITIDA">Emitida (la entregamos)</option><option value="RECIBIDA">Recibida (nos la dejaron)</option></select></div><div class="field"><label>N&deg; boleta</label><input id="gNum" value="${g ? esc(g.numero || '') : ''}"></div></div>
   <div class="row"><div class="field"><label>Banco</label><input id="gBanco" value="${g ? esc(g.banco || '') : ''}"></div><div class="field"><label>Beneficiario</label><input id="gBen" value="${g ? esc(g.beneficiario || '') : ''}"></div></div>
   <div class="row"><div class="field"><label>Glosa / Obra</label><input id="gGlosa" value="${g ? esc(g.glosa || '') : ''}"></div><div class="field"><label>Monto</label><input id="gMonto" type="number" value="${g ? g.monto : ''}"></div></div>
   <div class="row"><div class="field"><label>Emision</label><input id="gEmi" type="date" value="${g && g.fecha_emision ? fdate(g.fecha_emision) : ''}"></div><div class="field"><label>Vencimiento</label><input id="gVen" type="date" value="${g && g.fecha_vencimiento ? fdate(g.fecha_vencimiento) : ''}"></div></div>
   ${g ? `<div class="row"><div class="field"><label>Estado</label><select id="gEstado"><option>VIGENTE</option><option>COBRADA</option><option>DEVUELTA</option><option>VENCIDA</option></select></div></div>` : ''}
   <div class="err" id="gErr"></div>
   <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarGar(${g ? g.id : 0})">Guardar</button></div>`);
  if (g) { document.getElementById('gTipo').value = g.tipo; if (document.getElementById('gEstado')) document.getElementById('gEstado').value = g.estado; }
}
async function guardarGar(id) {
  const body = { tipo: val('gTipo'), numero: val('gNum'), banco: val('gBanco'), beneficiario: val('gBen'), glosa: val('gGlosa'), monto: val('gMonto'), fecha_emision: val('gEmi'), fecha_vencimiento: val('gVen') };
  if (id) body.estado = val('gEstado');
  try { if (id) await api('PUT', '/garantias/' + id, body); else await api('POST', '/garantias', body); closeModal(); vGarantias(); } catch (e) { $('#gErr').textContent = e.message; }
}
async function delGar(id) { if (confirm('Eliminar?')) { await api('DELETE', '/garantias/' + id); vGarantias(); } }

// ===================== CAJA CHICA =====================
async function vCajaChica() {
  const cs = await api('GET', '/cajachica'); window._cajas = cs;
  C().innerHTML = `<div class="card"><h3>Caja chica <button class="btn" onclick="formCaja()">+ Nueva caja</button></h3>
    <table><tr><th>Caja</th><th>Responsable</th><th class="num">Asignado</th><th class="num">Gastos</th><th class="num">Saldo</th><th></th></tr>
    ${cs.length ? cs.map(c => `<tr><td>${esc(c.nombre)}</td><td>${esc(c.responsable||'')}</td><td class="num">${clp(c.monto_asignado)}</td><td class="num">${clp(c.total_gastos)}</td><td class="num"><b>${clp(c.saldo)}</b></td><td><button class="btn sm" onclick="verCaja(${c.id})">Movimientos</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Sin cajas</td></tr>'}</table></div>`;
}
function formCaja() {
  modal(`<h3>Nueva caja chica</h3><div class="row"><div class="field"><label>Nombre</label><input id="kkNom"></div><div class="field"><label>Responsable</label><input id="kkResp"></div></div><div class="row"><div class="field"><label>Monto asignado</label><input id="kkMonto" type="number" value="0"></div></div><div class="err" id="kkErr"></div><div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarCaja()">Guardar</button></div>`);
}
async function guardarCaja() { try { await api('POST', '/cajachica', { nombre: val('kkNom'), responsable: val('kkResp'), monto_asignado: val('kkMonto') }); closeModal(); vCajaChica(); } catch (e) { $('#kkErr').textContent = e.message; } }
async function verCaja(id) {
  const mv = await api('GET', '/cajachica/' + id + '/movimientos'); const caja = (window._cajas || []).find(x => x.id === id) || {};
  modal(`<h3>Caja chica: ${esc(caja.nombre || '')}</h3>
    <p class="muted">Asignado ${clp(caja.monto_asignado || 0)} &middot; Saldo <b>${clp(caja.saldo || 0)}</b></p>
    <div class="row"><div class="field"><label>Tipo</label><select id="mvTipo"><option value="GASTO">Gasto</option><option value="REPOSICION">Reposicion</option></select></div><div class="field"><label>Fecha</label><input id="mvF" type="date" value="${hoy()}"></div></div>
    <div class="row"><div class="field"><label>Monto</label><input id="mvMonto" type="number"></div><div class="field"><label>Categoria</label><input id="mvCat"></div></div>
    <div class="row"><div class="field"><label>Glosa</label><input id="mvGlosa"></div><div class="field"><label>Documento</label><input id="mvDoc"></div></div>
    <div class="right" style="margin-bottom:10px"><button class="btn" onclick="addCajaMov(${id})">+ Agregar movimiento</button></div>
    <div class="scroll" style="max-height:240px"><table><tr><th>Fecha</th><th>Tipo</th><th>Glosa</th><th>Doc</th><th class="num">Monto</th><th></th></tr>
    ${mv.length ? mv.map(m => `<tr><td>${fdate(m.fecha)}</td><td>${m.tipo}</td><td>${esc(m.glosa||'')}</td><td>${esc(m.documento||'')}</td><td class="num">${clp(m.monto)}</td><td><button class="btn sm red" onclick="delCajaMov(${m.id},${id})">x</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Sin movimientos</td></tr>'}</table></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
}
async function addCajaMov(id) { try { await api('POST', '/cajachica/' + id + '/movimientos', { tipo: val('mvTipo'), fecha: val('mvF'), monto: val('mvMonto'), categoria: val('mvCat'), glosa: val('mvGlosa'), documento: val('mvDoc') }); await vCajaChica(); verCaja(id); } catch (e) { alert(e.message); } }
async function delCajaMov(mid, id) { if (confirm('Eliminar movimiento?')) { await api('DELETE', '/cajachica/movimientos/' + mid); await vCajaChica(); verCaja(id); } }


// ===================== COMPRAS / ABASTECIMIENTO =====================
let cmpTab = 'solicitudes';
let _items = [];
function pillEstado(e) { const m = { PENDIENTE: 'warn', APROBADA: 'ok', RECHAZADA: 'no', RECIBIDA: 'ok', PARCIAL: 'warn', TOTAL: 'ok' }; return `<span class="pill ${m[e] || 'warn'}">${e}</span>`; }
async function vCompras() {
  C().innerHTML = `<div class="tabs"><button data-t="solicitudes">Solicitudes de materiales</button><button data-t="ordenes">Ordenes de compra</button></div><div id="cmpBody"></div>`;
  C().querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { cmpTab = b.dataset.t; renderCmp(); }));
  renderCmp();
}
function renderCmp() { C().querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.t === cmpTab)); ({ solicitudes: cmpSolicitudes, ordenes: cmpOrdenes }[cmpTab])(); }

async function cmpSolicitudes() {
  const ss = await api('GET', '/compras/solicitudes');
  $('#cmpBody').innerHTML = `<div class="card"><h3>Solicitudes de materiales <button class="btn" onclick="formSolicitud()">+ Nueva solicitud</button></h3>
    <p class="muted">Centraliza los requerimientos por obra. Tras la aprobacion (V&deg;B&deg;) se cotiza y se genera la orden de compra.</p>
    <div class="scroll"><table><tr><th>N&deg;</th><th>Fecha</th><th>Solicitante</th><th>Bodega/Obra</th><th>Glosa</th><th>Estado</th><th></th></tr>
    ${ss.length ? ss.map(s => `<tr><td>${esc(s.numero)}</td><td>${fdate(s.fecha)}</td><td>${esc(s.solicitante||'')}</td><td>${esc(s.bodega||'')}</td><td>${esc(s.glosa||'')}</td><td>${pillEstado(s.estado)}</td>
      <td><button class="btn sm ghost" onclick="verSolicitud(${s.id})">Ver</button> ${USER.rol === 'admin' && s.estado === 'PENDIENTE' ? `<button class="btn sm green" onclick="aprobSol(${s.id},1)">Aprobar</button> <button class="btn sm red" onclick="aprobSol(${s.id},0)">Rechazar</button> ` : ''}${s.estado === 'APROBADA' ? `<button class="btn sm" onclick="ocDesdeSolicitud(${s.id})">Generar OC</button> ` : ''}<button class="btn sm red" onclick="delSol(${s.id})">x</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Sin solicitudes</td></tr>'}</table></div></div>`;
}
async function formSolicitud() {
  _items = [{ descripcion: '', producto_id: '', cantidad: 1, unidad: '' }];
  const [bods, prods] = await Promise.all([api('GET', '/inventario/bodegas'), api('GET', '/inventario/productos')]); window._prodsCmp = prods;
  modal(`<h3>Nueva solicitud de materiales</h3>
    <div class="row"><div class="field"><label>Fecha</label><input id="soF" type="date" value="${hoy()}"></div><div class="field"><label>Solicitante</label><input id="soSol"></div></div>
    <div class="row"><div class="field"><label>Bodega / obra destino</label><select id="soBod"><option value="">--</option>${bods.map(b => `<option value="${b.id}">${esc(b.nombre)}</option>`).join('')}</select></div><div class="field"><label>Glosa</label><input id="soGlosa"></div></div>
    <h4 style="margin:10px 0 4px">Items</h4><div id="soItems"></div>
    <button class="btn sm ghost" onclick="addItemRow()">+ Agregar item</button>
    <div class="err" id="soErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarSolicitud()">Guardar</button></div>`);
  renderItemRows();
}
function renderItemRows() {
  const prods = window._prodsCmp || [];
  document.getElementById('soItems').innerHTML = _items.map((it, i) => `<div class="row" style="align-items:flex-end">
    <div class="field"><label>Producto (o libre)</label><select onchange="_items[${i}].producto_id=this.value"><option value="">-- libre --</option>${prods.map(p => `<option value="${p.id}" ${it.producto_id == p.id ? 'selected' : ''}>${esc(p.sku)} - ${esc(p.nombre)}</option>`).join('')}</select></div>
    <div class="field"><label>Descripcion</label><input value="${esc(it.descripcion || '')}" oninput="_items[${i}].descripcion=this.value"></div>
    <div class="field" style="max-width:100px"><label>Cantidad</label><input type="number" value="${it.cantidad}" oninput="_items[${i}].cantidad=this.value"></div>
    <div class="field" style="max-width:90px"><label>Unidad</label><input value="${esc(it.unidad || '')}" oninput="_items[${i}].unidad=this.value"></div>
    <button class="btn sm red" onclick="rmItemRow(${i})">x</button></div>`).join('');
}
function addItemRow() { _items.push({ descripcion: '', producto_id: '', cantidad: 1, unidad: '' }); renderItemRows(); }
function rmItemRow(i) { _items.splice(i, 1); if (!_items.length) _items.push({ descripcion: '', producto_id: '', cantidad: 1, unidad: '' }); renderItemRows(); }
async function guardarSolicitud() {
  const items = _items.filter(it => (it.producto_id || it.descripcion) && Number(it.cantidad) > 0);
  if (!items.length) { $('#soErr').textContent = 'Agregue al menos un item con cantidad'; return; }
  try { await api('POST', '/compras/solicitudes', { fecha: val('soF'), solicitante: val('soSol'), bodega_id: val('soBod') || null, glosa: val('soGlosa'), items }); closeModal(); cmpSolicitudes(); } catch (e) { $('#soErr').textContent = e.message; }
}
async function aprobSol(id, ap) { await api('POST', '/compras/solicitudes/' + id + '/' + (ap ? 'aprobar' : 'rechazar'), {}); cmpSolicitudes(); }
async function delSol(id) { if (confirm('Eliminar solicitud?')) { await api('DELETE', '/compras/solicitudes/' + id); cmpSolicitudes(); } }
async function verSolicitud(id) {
  const s = await api('GET', '/compras/solicitudes/' + id);
  const provs = await api('GET', '/terceros?tipo=PROVEEDOR');
  modal(`<h3>Solicitud #${esc(s.numero)} ${pillEstado(s.estado)}</h3>
    <p class="muted">${fdate(s.fecha)} · ${esc(s.solicitante||'')} · ${esc(s.glosa||'')}</p>
    <table><tr><th>Item</th><th class="num">Cantidad</th><th>Unidad</th></tr>${s.items.map(i => `<tr><td>${esc(i.producto || i.descripcion || '')}</td><td class="num">${num(i.cantidad,2)}</td><td>${esc(i.unidad||'')}</td></tr>`).join('')}</table>
    <h4 style="margin:12px 0 4px">Cuadro comparativo de cotizaciones</h4>
    <div class="row" style="align-items:flex-end"><div class="field"><label>Proveedor</label><select id="coProv"><option value="">--</option>${provs.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></div>
      <div class="field" style="max-width:150px"><label>Total cotizado</label><input id="coTot" type="number"></div><div class="field" style="max-width:130px"><label>Plazo</label><input id="coPlazo"></div>
      <button class="btn sm" onclick="addCotiz(${id})">+ Agregar</button></div>
    <table><tr><th>Proveedor</th><th class="num">Total</th><th>Plazo</th><th></th></tr>${s.cotizaciones.length ? s.cotizaciones.map(c => `<tr style="${c.seleccionada ? 'background:#e8f5e9' : ''}"><td>${esc(c.proveedor||'')}</td><td class="num">${clp(c.total)}</td><td>${esc(c.plazo||'')}</td><td>${c.seleccionada ? '<span class="pill ok">elegida</span>' : `<button class="btn sm green" onclick="selCotiz(${c.id},${id})">Elegir</button>`} <button class="btn sm red" onclick="delCotiz(${c.id},${id})">x</button></td></tr>`).join('') : '<tr><td colspan="4" class="empty">Sin cotizaciones</td></tr>'}</table>
    <div class="right" style="margin-top:14px">${s.estado === 'APROBADA' ? `<button class="btn" onclick="ocDesdeSolicitud(${id})">Generar orden de compra</button> ` : ''}<button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
}
async function addCotiz(id) { if (!val('coTot')) { alert('Indique el total'); return; } await api('POST', '/compras/solicitudes/' + id + '/cotizaciones', { proveedor_id: val('coProv') || null, total: val('coTot'), plazo: val('coPlazo') }); verSolicitud(id); }
async function selCotiz(cid, id) { await api('POST', '/compras/cotizaciones/' + cid + '/seleccionar', {}); verSolicitud(id); }
async function delCotiz(cid, id) { await api('DELETE', '/compras/cotizaciones/' + cid); verSolicitud(id); }

async function cmpOrdenes() {
  const os = await api('GET', '/compras/ordenes');
  $('#cmpBody').innerHTML = `<div class="card"><h3>Ordenes de compra <button class="btn" onclick="ocNueva()">+ Nueva OC</button></h3>
    <div class="scroll"><table><tr><th>N&deg;</th><th>Fecha</th><th>Proveedor</th><th class="num">Total</th><th>Estado</th><th>Recepcion</th><th></th></tr>
    ${os.length ? os.map(o => `<tr><td>${esc(o.numero)}</td><td>${fdate(o.fecha)}</td><td>${esc(o.proveedor||'')}</td><td class="num">${clp(o.total)}</td><td>${pillEstado(o.estado)}</td><td>${o.recibida}</td>
      <td><button class="btn sm ghost" onclick="verOC(${o.id})">Ver</button> ${USER.rol === 'admin' && o.estado === 'PENDIENTE' ? `<button class="btn sm green" onclick="aprobOC(${o.id},1)">Aprobar</button> ` : ''}${(o.estado === 'APROBADA' || o.estado === 'RECIBIDA') && o.recibida !== 'TOTAL' ? `<button class="btn sm" onclick="recibirOC(${o.id})">Recibir</button> ` : ''}<button class="btn sm red" onclick="delOC(${o.id})">x</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Sin ordenes</td></tr>'}</table></div></div>`;
}
async function ocDesdeSolicitud(solId) {
  const s = await api('GET', '/compras/solicitudes/' + solId);
  const sel = (s.cotizaciones || []).find(c => c.seleccionada);
  _items = s.items.map(i => ({ producto_id: i.producto_id || '', descripcion: i.descripcion || i.producto || '', cantidad: i.cantidad, precio_unitario: 0, unidad: i.unidad || '' }));
  formOC({ solicitud_id: solId, proveedor_id: sel ? sel.proveedor_id : '', bodega_id: s.bodega_id });
}
function ocNueva() { _items = [{ producto_id: '', descripcion: '', cantidad: 1, precio_unitario: 0, unidad: '' }]; formOC({}); }
async function formOC(pre) {
  const [bods, prods, provs] = await Promise.all([api('GET', '/inventario/bodegas'), api('GET', '/inventario/productos'), api('GET', '/terceros?tipo=PROVEEDOR')]);
  window._prodsCmp = prods;
  modal(`<h3>Nueva orden de compra</h3>
    <div class="row"><div class="field"><label>Proveedor</label><select id="ocProv"><option value="">--</option>${provs.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></div><div class="field"><label>Fecha</label><input id="ocF" type="date" value="${hoy()}"></div></div>
    <div class="row"><div class="field"><label>Bodega recepcion</label><select id="ocBod"><option value="">--</option>${bods.map(b => `<option value="${b.id}">${esc(b.nombre)}</option>`).join('')}</select></div><div class="field" style="max-width:120px"><label>IVA %</label><input id="ocIva" type="number" value="19" oninput="ocCalc()"></div></div>
    <div class="row"><div class="field"><label>Condicion de pago</label><input id="ocCond"></div><div class="field"><label>Glosa</label><input id="ocGlosa"></div></div>
    <h4 style="margin:10px 0 4px">Items</h4><div id="ocItems"></div><button class="btn sm ghost" onclick="addOCRow()">+ Agregar item</button>
    <p id="ocTotal" style="margin-top:8px;text-align:right"></p>
    <div class="err" id="ocErr"></div>
    <div class="right" style="margin-top:14px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn" onclick="guardarOC(${pre.solicitud_id || 0})">Guardar</button></div>`);
  if (pre.proveedor_id) document.getElementById('ocProv').value = pre.proveedor_id;
  if (pre.bodega_id) document.getElementById('ocBod').value = pre.bodega_id;
  renderOCRows();
}
function renderOCRows() {
  const prods = window._prodsCmp || [];
  document.getElementById('ocItems').innerHTML = _items.map((it, i) => `<div class="row" style="align-items:flex-end">
    <div class="field"><label>Producto</label><select onchange="_items[${i}].producto_id=this.value"><option value="">-- libre --</option>${prods.map(p => `<option value="${p.id}" ${it.producto_id == p.id ? 'selected' : ''}>${esc(p.sku)} - ${esc(p.nombre)}</option>`).join('')}</select></div>
    <div class="field"><label>Descripcion</label><input value="${esc(it.descripcion || '')}" oninput="_items[${i}].descripcion=this.value"></div>
    <div class="field" style="max-width:80px"><label>Cant.</label><input type="number" value="${it.cantidad}" oninput="_items[${i}].cantidad=this.value;ocCalc()"></div>
    <div class="field" style="max-width:120px"><label>Precio</label><input type="number" value="${it.precio_unitario}" oninput="_items[${i}].precio_unitario=this.value;ocCalc()"></div>
    <button class="btn sm red" onclick="rmOCRow(${i})">x</button></div>`).join('');
  ocCalc();
}
function ocCalc() { const neto = _items.reduce((a, it) => a + (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0), 0); const iva = neto * (Number(val('ocIva')) || 0) / 100; const el = document.getElementById('ocTotal'); if (el) el.innerHTML = 'Neto ' + clp(neto) + ' · IVA ' + clp(iva) + ' · <b>Total ' + clp(neto + iva) + '</b>'; }
function addOCRow() { _items.push({ producto_id: '', descripcion: '', cantidad: 1, precio_unitario: 0, unidad: '' }); renderOCRows(); }
function rmOCRow(i) { _items.splice(i, 1); if (!_items.length) _items.push({ producto_id: '', descripcion: '', cantidad: 1, precio_unitario: 0, unidad: '' }); renderOCRows(); }
async function guardarOC(solId) {
  const items = _items.filter(it => (it.producto_id || it.descripcion) && Number(it.cantidad) > 0);
  if (!items.length) { $('#ocErr').textContent = 'Agregue items'; return; }
  try { await api('POST', '/compras/ordenes', { proveedor_id: val('ocProv') || null, fecha: val('ocF'), bodega_id: val('ocBod') || null, iva_pct: val('ocIva'), condicion_pago: val('ocCond'), glosa: val('ocGlosa'), solicitud_id: solId || null, items }); closeModal(); cmpTab = 'ordenes'; renderCmp(); } catch (e) { $('#ocErr').textContent = e.message; }
}
async function aprobOC(id, ap) { await api('POST', '/compras/ordenes/' + id + '/' + (ap ? 'aprobar' : 'rechazar'), {}); cmpOrdenes(); }
async function delOC(id) { if (confirm('Eliminar OC?')) { await api('DELETE', '/compras/ordenes/' + id); cmpOrdenes(); } }
async function verOC(id) {
  const o = await api('GET', '/compras/ordenes/' + id);
  modal(`<h3>Orden de compra #${esc(o.numero)} ${pillEstado(o.estado)}</h3>
    <p class="muted">${fdate(o.fecha)} · ${esc(o.proveedor||'')} ${o.proveedor_rut ? '(' + esc(o.proveedor_rut) + ')' : ''} · ${esc(o.glosa||'')}</p>
    ${o.solicitud ? `<p class="muted">Origen: Solicitud #${esc(o.solicitud.numero)}</p>` : ''}
    <table><tr><th>Item</th><th class="num">Cant.</th><th class="num">Recibido</th><th class="num">Precio</th><th class="num">Subtotal</th></tr>
    ${o.items.map(i => `<tr><td>${esc(i.producto || i.descripcion || '')}</td><td class="num">${num(i.cantidad,2)}</td><td class="num">${num(i.cantidad_recibida,2)}</td><td class="num">${clp(i.precio_unitario)}</td><td class="num">${clp(i.cantidad*i.precio_unitario)}</td></tr>`).join('')}</table>
    <p style="text-align:right;margin-top:8px">Neto ${clp(o.neto)} · IVA ${clp(o.iva)} · <b>Total ${clp(o.total)}</b></p>
    <p class="muted">Recepcion: <b>${o.recibida}</b>${o.factura ? ' · Factura CxP #' + esc(o.factura.numero) : ''}</p>
    <div class="right" style="margin-top:10px">${(o.estado === 'APROBADA' || o.estado === 'RECIBIDA') && o.recibida !== 'TOTAL' ? `<button class="btn green" onclick="recibirOC(${id})">Recibir</button> ` : ''}${o.recibida !== 'NO' && !o.factura_id ? `<button class="btn" onclick="facturarOC(${id})">Generar factura CxP</button> ` : ''}<button class="btn ghost" onclick="closeModal()">Cerrar</button></div>`);
}
async function recibirOC(id) {
  const o = await api('GET', '/compras/ordenes/' + id); window._ocRec = o;
  const bods = await api('GET', '/inventario/bodegas');
  modal(`<h3>Recepcion OC #${esc(o.numero)}</h3>
    <div class="row"><div class="field"><label>Bodega recepcion</label><select id="rcBod">${bods.map(b => `<option value="${b.id}" ${o.bodega_id == b.id ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('')}</select></div><div class="field"><label>Fecha</label><input id="rcF" type="date" value="${hoy()}"></div></div>
    <table><tr><th>Item</th><th class="num">Pendiente</th><th class="num">Recibir ahora</th></tr>
    ${o.items.map(i => { const pend = i.cantidad - i.cantidad_recibida; return `<tr><td>${esc(i.producto || i.descripcion || '')}</td><td class="num">${num(pend,2)}</td><td class="num"><input id="rc_${i.id}" type="number" value="${pend > 0 ? pend : 0}" style="max-width:90px"></td></tr>`; }).join('')}</table>
    <p class="muted">Los items con producto entran al stock de la bodega (ENTRADA con PMP).</p>
    <div class="err" id="rcErr"></div>
    <div class="right" style="margin-top:10px"><button class="btn ghost" onclick="closeModal()">Cancelar</button> <button class="btn green" onclick="confirmarRecepcion(${id})">Confirmar recepcion</button></div>`);
}
async function confirmarRecepcion(id) {
  const o = window._ocRec; const items = o.items.map(i => ({ oc_item_id: i.id, cantidad: Number(document.getElementById('rc_' + i.id).value) || 0 })).filter(x => x.cantidad > 0);
  if (!items.length) { $('#rcErr').textContent = 'Indique cantidades a recibir'; return; }
  try { await api('POST', '/compras/ordenes/' + id + '/recibir', { bodega_id: val('rcBod'), fecha: val('rcF'), items }); closeModal(); cmpOrdenes(); } catch (e) { $('#rcErr').textContent = e.message; }
}
async function facturarOC(id) {
  const venc = prompt('Fecha de vencimiento de la factura (AAAA-MM-DD):', hoy()); if (!venc) return;
  try { await api('POST', '/compras/ordenes/' + id + '/facturar', { fecha_vencimiento: venc }); alert('Factura por pagar creada en Cuentas C/P.'); cmpOrdenes(); } catch (e) { alert(e.message); }
}


// ===================== AUDITORIA (historial) =====================
const AUDIT_MODS = ['Sesion', 'Inventario', 'Tesoreria', 'Creditos', 'Activos', 'Flujo', 'Usuarios'];
async function vAuditoria() {
  C().innerHTML = '<div class="empty">Cargando...</div>';
  let usuarios = [];
  try { usuarios = await api('GET', '/auditoria/usuarios'); } catch (e) {}
  const ambas = !USER.empresa;
  C().innerHTML = `<div class="card">
    <h3>Auditoria <button class="btn sm ghost" onclick="vHorarios()">Horario de uso (inicio/salida)</button></h3>
    <p class="muted">Registro de inicios de sesion y de toda creacion, edicion o eliminacion en el sistema.</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin:14px 0">
      <div><label class="lbl">Usuario</label><select id="auUsuario"><option value="">Todos</option>${usuarios.map(u => `<option value="${esc(u.usuario_email)}">${esc(u.usuario_nombre || u.usuario_email)}</option>`).join('')}</select></div>
      <div><label class="lbl">Modulo</label><select id="auModulo"><option value="">Todos</option>${AUDIT_MODS.map(m => `<option>${m}</option>`).join('')}</select></div>
      <div><label class="lbl">Desde</label><input type="date" id="auDesde"></div>
      <div><label class="lbl">Hasta</label><input type="date" id="auHasta"></div>
      <div><label class="lbl">Buscar</label><input type="text" id="auQ" placeholder="texto en detalle"></div>
      ${ambas ? `<div><label class="lbl">&nbsp;</label><label style="display:flex;align-items:center;gap:6px;height:38px"><input type="checkbox" id="auTodas"> Ambas empresas</label></div>` : ''}
      <div><label class="lbl">&nbsp;</label><button class="btn" onclick="cargarAuditoria()">Filtrar</button></div>
    </div>
    <div id="auTabla"><div class="empty">Cargando...</div></div>
  </div>`;
  cargarAuditoria();
}
async function cargarAuditoria() {
  const qs = [];
  const u = val('auUsuario'), m = val('auModulo'), d = val('auDesde'), h = val('auHasta'), q = val('auQ');
  const todasEl = document.getElementById('auTodas');
  if (u) qs.push('usuario=' + encodeURIComponent(u));
  if (m) qs.push('modulo=' + encodeURIComponent(m));
  if (d) qs.push('desde=' + d);
  if (h) qs.push('hasta=' + h);
  if (q) qs.push('q=' + encodeURIComponent(q));
  if (todasEl && todasEl.checked) qs.push('todas=1');
  const cont = document.getElementById('auTabla');
  try {
    const rows = await api('GET', '/auditoria' + (qs.length ? '?' + qs.join('&') : ''));
    const fmt = (ts) => { if (!ts) return ''; const dt = new Date(ts.replace(' ', 'T') + 'Z'); return isNaN(dt) ? ts : dt.toLocaleString('es-CL'); };
    if (!rows.length) { cont.innerHTML = '<div class="empty">Sin registros para el filtro seleccionado.</div>'; return; }
    cont.innerHTML = `<table><tr><th>Fecha y hora</th><th>Usuario</th><th>Empresa</th><th>Modulo</th><th>Accion</th><th>Detalle</th></tr>
      ${rows.map(r => `<tr><td>${fmt(r.ts)}</td><td>${esc(r.usuario_nombre || r.usuario_email || '-')}</td><td>${r.empresa && BRANDS[r.empresa] ? esc(BRANDS[r.empresa].nombre) : esc(r.empresa || '-')}</td><td>${esc(r.modulo || '')}</td><td>${esc(r.accion || '')}</td><td>${esc(r.detalle || '')}</td></tr>`).join('')}</table>
      <p class="muted" style="margin-top:8px">Mostrando ${rows.length} registro(s), mas recientes primero (maximo 500).</p>`;
  } catch (e) { cont.innerHTML = '<div class="empty">Error al cargar el historial: ' + esc(e.message) + '</div>'; }
}

// ===================== HORARIO DE USO (inicio / salida) =====================
async function vHorarios() {
  C().innerHTML = '<div class="empty">Cargando...</div>';
  let usuarios = [];
  try { usuarios = await api('GET', '/auditoria/usuarios'); } catch (e) {}
  C().innerHTML = `<div class="card">
    <h3>Horario de uso del ERP <button class="btn sm ghost" onclick="vAuditoria()">Ver historial de acciones</button></h3>
    <p class="muted">Inicio (primer ingreso) y salida (ultimo cierre de sesion) por usuario y dia. La salida se registra al presionar el boton "Salir"; si se cierra el navegador sin salir, queda sin hora de salida.</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin:14px 0">
      <div><label class="lbl">Usuario</label><select id="hUsuario"><option value="">Todos</option>${usuarios.map(u => `<option value="${esc(u.usuario_email)}">${esc(u.usuario_nombre || u.usuario_email)}</option>`).join('')}</select></div>
      <div><label class="lbl">Desde</label><input type="date" id="hDesde"></div>
      <div><label class="lbl">Hasta</label><input type="date" id="hHasta"></div>
      <div><label class="lbl">&nbsp;</label><button class="btn" onclick="cargarHorarios()">Filtrar</button></div>
    </div>
    <div id="hTabla"><div class="empty">Cargando...</div></div></div>`;
  cargarHorarios();
}
async function cargarHorarios() {
  const qs = []; const u = val('hUsuario'), d = val('hDesde'), h = val('hHasta');
  if (u) qs.push('usuario=' + encodeURIComponent(u));
  if (d) qs.push('desde=' + d);
  if (h) qs.push('hasta=' + h);
  const cont = document.getElementById('hTabla');
  try {
    const rows = await api('GET', '/auditoria/horarios' + (qs.length ? '?' + qs.join('&') : ''));
    const ht = (t) => { if (!t) return '<span class="muted">—</span>'; const dt = new Date(t.replace(' ', 'T') + 'Z'); return isNaN(dt) ? t : dt.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }); };
    if (!rows.length) { cont.innerHTML = '<div class="empty">Sin registros para el filtro seleccionado.</div>'; return; }
    cont.innerHTML = `<div class="scroll"><table><tr><th>Dia</th><th>Usuario</th><th>Inicio</th><th>Salida</th><th class="num">Sesiones</th></tr>
      ${rows.map(r => `<tr><td>${esc(r.dia)}</td><td>${esc(r.usuario_nombre || r.usuario_email || '')}</td><td>${ht(r.inicio)}</td><td>${ht(r.salida)}</td><td class="num">${r.sesiones}</td></tr>`).join('')}</table></div>
      <p class="muted" style="margin-top:8px">${rows.length} registro(s).</p>`;
  } catch (e) { cont.innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>'; }
}

// ===================== BRANDING MULTI-EMPRESA =====================
const BRANDS = {
  trabancura: { id: 'trabancura', nombre: 'Trabancura', monograma: 'T', sub: 'Obras y Montajes', oro: true,
    primary: '#0f1a2b', primary2: '#1c2c44', accent: '#c7a23a', logo: 'data:image/jpeg;base64,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' },
  jmc: { id: 'jmc', nombre: 'JMC', monograma: 'JMC', sub: 'Ingenieria y Construccion', emblema: true,
    primary: '#26292e', primary2: '#383d44', accent: '#9b2d2d', logo: 'data:image/jpeg;base64,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' }
};
let currentBrand = BRANDS.trabancura;

function brandMark(b, where) {
  if (b.logo) {
    const h = where === 'side' ? 42 : 56;
    const pad = where === 'side' ? '7px 10px' : '9px 14px';
    return `<div style="display:inline-block;background:#ffffff;border-radius:12px;padding:${pad};box-shadow:0 1px 5px rgba(0,0,0,.15)"><img src="${b.logo}" alt="${esc(b.nombre)}" style="height:${h}px;max-width:212px;display:block"></div>`;
  }
  return logoSVG(b, where === 'side' ? 'light' : 'dark');
}
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
  const ll = document.getElementById('loginLogo'); if (ll) ll.innerHTML = brandMark(b, 'login');
  const sb = document.getElementById('sideBrand'); if (sb) sb.innerHTML = brandMark(b, 'side');
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
  s.onchange = () => {
    selectEmpresa(s.value);
    if (TOKEN) { const a = document.querySelector('#nav a.active'); go(a ? a.dataset.v : 'dashboard'); }
  };
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
  if (!planParams.desde) { planParams.desde = inicioMes(); const d = new Date(); d.setMonth(d.getMonth() + 2); planParams.hasta = d.toISOString().slice(0, 10); }
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
