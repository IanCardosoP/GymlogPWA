const REFRESH_MS = 60_000;

const els = {
  statusDot: document.getElementById('status-dot'),
  updatedAt: document.getElementById('updated-at'),
  errorBanner: document.getElementById('error-banner'),
  refreshBtn: document.getElementById('refresh-btn'),
  autoRefresh: document.getElementById('auto-refresh'),
  dispositivos: document.getElementById('stat-dispositivos'),
  aperturas: document.getElementById('stat-aperturas'),
  nuevosHoy: document.getElementById('stat-nuevos-hoy'),
  activosHoy: document.getElementById('stat-activos-hoy'),
  topDevicesBody: document.querySelector('#table-top-devices tbody'),
  logsBody: document.querySelector('#table-logs tbody'),
  versionesBody: document.getElementById('versiones-body'),
  fallosBody: document.getElementById('fallos-body'),
};

// Libreta de etiquetas (device_id → nombre), la sirve /api/dashboard desde
// monitor/etiquetas.js. Vive solo acá: la telemetría en D1 es anónima.
let etiquetas = {};
const nombreDe = id => etiquetas[id] ?? null;

// Marca una celda como fuente del device_id completo: sigue mostrándose
// abreviado, pero un clic copia el UUID entero. Es la forma de sacar un id para
// pegarlo en etiquetas.js sin ir a buscarlo a D1 con un LIKE por prefijo.
function marcarCopiable(td, deviceId) {
  if (!deviceId) return td;
  td.dataset.deviceId = deviceId;
  td.title = `${deviceId} — clic para copiar`;
  td.classList.add('id-copiable');
  return td;
}

// Celda de "usuario": el nombre si lo conocemos, el id recortado si no. Así una
// fila de Diego o Alex se localiza de un vistazo sin comparar UUIDs.
function celdaUsuario(deviceId) {
  const td = document.createElement('td');
  const nombre = nombreDe(deviceId);
  if (nombre) {
    td.textContent = nombre;
    td.classList.add('usuario');
  } else {
    td.textContent = shortId(deviceId);
    td.classList.add('mono-id', 'usuario-anon');
  }
  return marcarCopiable(td, deviceId);
}

async function copiarAlPortapapeles(texto) {
  // localhost cuenta como contexto seguro, así que la API moderna alcanza; el
  // fallback cubre el caso de abrir el dashboard por IP de la LAN.
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(texto);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = texto;
  ta.setAttribute('readonly', '');
  ta.classList.add('offscreen');
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

// Delegación en el documento: las tablas se re-renderizan enteras cada 60s, así
// que enganchar el listener por celda duplicaría handlers en cada refresco.
document.addEventListener('click', async (ev) => {
  const td = ev.target.closest('.id-copiable');
  if (!td) return;
  const deviceId = td.dataset.deviceId;
  if (!deviceId) return;

  const original = td.textContent;
  try {
    await copiarAlPortapapeles(deviceId);
    td.textContent = 'copiado ✓';
    td.classList.add('copiado');
  } catch {
    td.textContent = 'error ✗';
    td.classList.add('copia-fallida');
  }
  setTimeout(() => {
    // Si el auto-refresh ya reemplazó la fila, este nodo quedó huérfano y no
    // pasa nada: restaurar sobre un nodo desconectado es inocuo.
    td.textContent = original;
    td.classList.remove('copiado', 'copia-fallida');
  }, 1200);
});

const CHART_FONT = { family: "'JetBrains Mono', ui-monospace, monospace", size: 11 };
Chart.defaults.color = '#6b6b6b';
Chart.defaults.font = CHART_FONT;
Chart.defaults.borderColor = '#262626';

const charts = {};

function fmtNum(n) {
  return new Intl.NumberFormat('es-AR').format(n ?? 0);
}

function fmtTs(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function shortId(id) {
  return id ? `${id.slice(0, 8)}…` : '—';
}

function upsertLineChart(canvasId, labels, datasets, opts = {}) {
  const ctx = document.getElementById(canvasId);
  if (charts[canvasId]) {
    charts[canvasId].data.labels = labels;
    charts[canvasId].data.datasets.forEach((ds, i) => { ds.data = datasets[i].data; });
    charts[canvasId].update();
    return;
  }
  charts[canvasId] = new Chart(ctx, {
    type: opts.type || 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { color: '#1a1a1a' }, stacked: !!opts.stacked },
        y: { grid: { color: '#1a1a1a' }, beginAtZero: true, stacked: !!opts.stacked, ticks: { precision: 0 } },
      },
      plugins: { legend: { labels: { boxWidth: 12, padding: 12 } } },
    },
  });
}

function upsertDoughnut(canvasId, labels, data, colors) {
  const ctx = document.getElementById(canvasId);
  if (charts[canvasId]) {
    charts[canvasId].data.labels = labels;
    charts[canvasId].data.datasets[0].data = data;
    charts[canvasId].update();
    return;
  }
  charts[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#0a0a0a', borderWidth: 2 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } } },
    },
  });
}

function renderCards(overview, hoy) {
  els.dispositivos.textContent = fmtNum(overview[0]?.dispositivos);
  els.aperturas.textContent = fmtNum(overview[0]?.aperturas);
  els.nuevosHoy.textContent = fmtNum(hoy[0]?.nuevos_hoy);
  els.activosHoy.textContent = fmtNum(hoy[0]?.activos_hoy);
}

function renderDiario(rows) {
  const labels = rows.map(r => r.dia);
  upsertLineChart('chart-diario', labels, [
    { label: 'Aperturas', data: rows.map(r => r.aperturas), borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.1)', tension: 0.25 },
    { label: 'Dispositivos únicos', data: rows.map(r => r.dispositivos), borderColor: '#00ff88', backgroundColor: 'rgba(0,255,136,0.1)', tension: 0.25 },
  ]);
}

function renderTendencia(rows) {
  const labels = rows.map(r => r.dia);
  upsertLineChart('chart-tendencia', labels, [
    { label: 'Nuevos', data: rows.map(r => r.nuevos), backgroundColor: '#00ff88', maxBarThickness: 48 },
    { label: 'Recurrentes', data: rows.map(r => r.recurrentes), backgroundColor: '#00d4ff', maxBarThickness: 48 },
  ], { type: 'bar', stacked: true });
}

function renderOS(rows) {
  const labels = rows.map(r => r.os);
  const palette = { ios: '#d7d7d7', android: '#00ff88', other: '#6b6b6b' };
  upsertDoughnut('chart-os', labels, rows.map(r => r.dispositivos), labels.map(l => palette[l] || '#00d4ff'));
}

function renderPWA(rows) {
  const map = { 0: 'Navegador', 1: 'PWA instalada' };
  const labels = rows.map(r => map[r.pwa] ?? String(r.pwa));
  upsertDoughnut('chart-pwa', labels, rows.map(r => r.aperturas), ['#6b6b6b', '#00ff88']);
}

function renderTopDevices(rows) {
  els.topDevicesBody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.appendChild(celdaUsuario(r.device_id));

    const tdId = document.createElement('td');
    tdId.textContent = shortId(r.device_id);
    tdId.classList.add('mono-id');
    tr.appendChild(marcarCopiable(tdId, r.device_id));

    const cells = [
      [r.version ?? '—', 'mono-id'],
      [`${r.os ?? '—'}${r.pwa ? ' · PWA' : ''}`, null],
      [fmtNum(r.aperturas), null],
      [r.ultima_vez, null],
    ];
    for (const [value, cls] of cells) {
      const td = document.createElement('td');
      td.textContent = value;
      if (cls) td.classList.add(cls);
      tr.appendChild(td);
    }
    els.topDevicesBody.appendChild(tr);
  }
}

function renderVersiones(rows) {
  els.versionesBody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    const cells = [
      [r.version, 'mono-id'],
      [fmtNum(r.dispositivos), null],
      [fmtNum(r.ios), null],
      [r.ultima_vez ? fmtTs(r.ultima_vez) : '—', null],
    ];
    for (const [value, cls] of cells) {
      const td = document.createElement('td');
      td.textContent = value;
      if (cls) td.classList.add(cls);
      tr.appendChild(td);
    }
    els.versionesBody.appendChild(tr);
  }
}

function renderFallos(rows) {
  els.fallosBody.innerHTML = '';
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.textContent = 'Sin fallos de arranque reportados.';
    td.classList.add('usuario-anon');
    tr.appendChild(td);
    els.fallosBody.appendChild(tr);
    return;
  }
  for (const r of rows) {
    const tr = document.createElement('tr');

    // 'boot_fail:motor' → 'motor'. El prefijo es ruido en una tabla que ya
    // se titula "Fallos de arranque".
    const tdMotivo = document.createElement('td');
    tdMotivo.textContent = String(r.motivo ?? '').replace(/^boot_fail:?/, '') || '(sin motivo)';
    tr.appendChild(tdMotivo);

    const tdOs = document.createElement('td');
    tdOs.textContent = r.os ?? '—';
    tr.appendChild(tdOs);

    const tdPwa = document.createElement('td');
    const badge = document.createElement('span');
    badge.textContent = r.pwa ? 'PWA' : 'web';
    badge.classList.add('badge', r.pwa ? 'pwa' : 'web');
    tdPwa.appendChild(badge);
    tr.appendChild(tdPwa);

    const cells = [[r.version ?? '—', 'mono-id'], [fmtNum(r.veces), null], [fmtTs(r.ultima_vez), null]];
    for (const [value, cls] of cells) {
      const td = document.createElement('td');
      td.textContent = value;
      if (cls) td.classList.add(cls);
      tr.appendChild(td);
    }
    els.fallosBody.appendChild(tr);
  }
}

function renderLogs(rows) {
  els.logsBody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');

    const tdTs = document.createElement('td');
    tdTs.textContent = fmtTs(r.ts);
    tr.appendChild(tdTs);

    tr.appendChild(celdaUsuario(r.device_id));

    const tdEvt = document.createElement('td');
    tdEvt.textContent = r.evt;
    // Un fallo de arranque tiene que saltar a la vista en el log en vivo.
    if (String(r.evt ?? '').startsWith('boot_fail')) tdEvt.classList.add('evt-fallo');
    tr.appendChild(tdEvt);

    const tdVer = document.createElement('td');
    tdVer.textContent = r.version ?? '—';
    tdVer.classList.add('mono-id');
    tr.appendChild(tdVer);

    const tdPwa = document.createElement('td');
    const badge = document.createElement('span');
    badge.textContent = r.pwa ? 'PWA' : 'web';
    badge.classList.add('badge', r.pwa ? 'pwa' : 'web');
    tdPwa.appendChild(badge);
    tr.appendChild(tdPwa);

    const tdOs = document.createElement('td');
    tdOs.textContent = r.os;
    tr.appendChild(tdOs);

    els.logsBody.appendChild(tr);
  }
}

function showError(msg) {
  els.errorBanner.textContent = `⚠ ${msg}`;
  els.errorBanner.hidden = false;
  els.statusDot.classList.add('error');
}

function clearError() {
  els.errorBanner.hidden = true;
  els.statusDot.classList.remove('error');
}

async function loadDashboard() {
  els.refreshBtn.textContent = '[ CARGANDO... ]';
  try {
    const res = await fetch('/api/dashboard');
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || 'Error desconocido');

    clearError();
    etiquetas = body.etiquetas ?? {};
    const { overview, hoy, diario, tendencia, os, pwa, topDevices, versiones, fallos, logs } = body.data;
    renderCards(overview, hoy);
    renderDiario(diario);
    renderTendencia(tendencia);
    renderOS(os);
    renderPWA(pwa);
    renderTopDevices(topDevices);
    renderVersiones(versiones);
    renderFallos(fallos);
    renderLogs(logs);
    els.updatedAt.textContent = `actualizado ${new Date(body.fetchedAt).toLocaleTimeString('es-AR')}`;
  } catch (err) {
    showError(`No se pudo consultar D1 — ¿corriste "wrangler login"? (${err.message})`);
  } finally {
    els.refreshBtn.textContent = '[ REFRESCAR ]';
  }
}

let timer = null;
function scheduleAutoRefresh() {
  if (timer) clearInterval(timer);
  if (els.autoRefresh.checked) {
    timer = setInterval(loadDashboard, REFRESH_MS);
  }
}

els.refreshBtn.addEventListener('click', loadDashboard);
els.autoRefresh.addEventListener('change', scheduleAutoRefresh);

loadDashboard();
scheduleAutoRefresh();
