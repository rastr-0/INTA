const API = "http://localhost:8765";

// ── State ─────────────────────────────────────────────────────────────────────
let hosts = [];
let viewMode = 'overview'; // 'overview' | 'detail'
let selectedHostId = null;
let detailChart = null;
let hostCharts = {};
let refreshTimer = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const hostList       = document.getElementById("hostList");
const mainPanel      = document.getElementById("mainPanel");
const addHostBtn     = document.getElementById("addHostBtn");
const addHostModal   = document.getElementById("addHostModal");
const addHostForm    = document.getElementById("addHostForm");
const cancelModalBtn = document.getElementById("cancelModalBtn");

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
addHostBtn.addEventListener("click", () => addHostModal.showModal());
cancelModalBtn.addEventListener("click", () => addHostModal.close());

addHostForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const address = document.getElementById("hostAddress").value.trim();
  const label   = document.getElementById("hostLabel").value.trim() || null;
  if (!address) return;

  const submitBtn = addHostForm.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  try {
    const res = await fetch(`${API}/hosts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, label }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Error ${res.status}`);
    }
    addHostModal.close();
    addHostForm.reset();
    await loadHosts();
  } catch (err) {
    alert(`Failed to add host: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
  }
});

// ── Hosts ─────────────────────────────────────────────────────────────────────
async function loadHosts() {
  try {
    const res = await fetch(`${API}/hosts`);
    hosts = await res.json();
    renderSidebar();
    if (viewMode === 'overview') {
      renderOverview();
    } else if (viewMode === 'detail' && selectedHostId) {
      selectHost(selectedHostId);
    }
  } catch {
    // backend not reachable yet
  }
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function renderSidebar() {
  hostList.innerHTML = "";
  for (const host of hosts) {
    const li = document.createElement("li");
    li.className = "host-item" + (viewMode === 'detail' && host.id === selectedHostId ? " host-item--active" : "");
    li.dataset.id = host.id;

    const dot = document.createElement("span");
    dot.className = `status-dot status-dot--${host._status ?? ""}`;

    const name = document.createElement("span");
    name.className = "host-item__name";
    name.textContent = host.label || host.address;

    li.append(dot, name);
    li.addEventListener("click", () => {
      if (viewMode === 'overview') {
        const panel = document.getElementById(`panel-${host.id}`);
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        selectHost(host.id);
      }
    });
    hostList.appendChild(li);
  }
}

function updateSidebarDot(hostId, status) {
  const item = hostList.querySelector(`[data-id="${hostId}"]`);
  const dot = item?.querySelector('.status-dot');
  if (dot) dot.className = `status-dot status-dot--${status}`;
}

// ── Overview ──────────────────────────────────────────────────────────────────
function renderOverview() {
  viewMode = 'overview';
  selectedHostId = null;
  stopRefresh();
  destroyDetailChart();
  destroyHostCharts();
  renderSidebar();

  mainPanel.innerHTML = '';

  if (!hosts.length) {
    mainPanel.innerHTML = '<p class="empty-state">No hosts added yet. Click "+ Add Host" to get started.</p>';
    return;
  }

  const overview = document.createElement('div');
  overview.className = 'overview';

  for (const host of hosts) {
    overview.appendChild(buildHostPanel(host));
  }

  mainPanel.appendChild(overview);

  // Load data for all panels concurrently
  hosts.forEach(h => loadPanelData(h.id));

  // Auto-refresh every 30s
  refreshTimer = setInterval(() => hosts.forEach(h => loadPanelData(h.id)), 30000);
}

function buildHostPanel(host) {
  const panel = document.createElement('div');
  panel.className = 'host-panel';
  panel.id = `panel-${host.id}`;

  panel.innerHTML = `
    <div class="host-panel__header">
      <div class="host-panel__left">
        <button class="host-panel__toggle" title="Collapse section">▾</button>
        <span class="status-dot status-dot--${escapeHtml(host._status ?? '')}"></span>
        <span class="host-panel__name">${escapeHtml(host.label || host.address)}</span>
        ${host.label ? `<span class="host-panel__addr">${escapeHtml(host.address)}</span>` : ''}
      </div>
      <div class="host-panel__right">
        <span class="latency-badge" id="badge-${host.id}">—</span>
        <button class="btn btn--sm" id="panelPing-${host.id}">Ping</button>
        <button class="btn btn--sm btn--primary" id="panelDetail-${host.id}">Detail ›</button>
      </div>
    </div>
    <div class="host-panel__body" id="body-${host.id}">
      <div class="chart-wrap chart-wrap--sm"><canvas id="chart-${host.id}"></canvas></div>
      <div class="panel-stats">
        <div class="panel-stat"><span class="stat-label">Loss</span><span id="ploss-${host.id}">—</span></div>
        <div class="panel-stat"><span class="stat-label">Status</span><span id="pstatus-${host.id}">—</span></div>
        <div class="panel-stat"><span class="stat-label">Updated</span><span class="muted" id="pupdated-${host.id}">—</span></div>
      </div>
    </div>
  `;

  panel.querySelector('.host-panel__toggle').addEventListener('click', () => {
    const body = document.getElementById(`body-${host.id}`);
    const btn = panel.querySelector('.host-panel__toggle');
    const collapsed = body.classList.toggle('host-panel__body--collapsed');
    btn.textContent = collapsed ? '▸' : '▾';
  });

  panel.querySelector(`#panelPing-${host.id}`).addEventListener('click', () => pingInPanel(host.id));
  panel.querySelector(`#panelDetail-${host.id}`).addEventListener('click', () => openDetail(host.id));

  return panel;
}

async function loadPanelData(hostId) {
  const measurements = await fetch(`${API}/hosts/${hostId}/measurements`)
    .then(r => r.json()).catch(() => []);
  applyPanelData(hostId, measurements);
}

function applyPanelData(hostId, measurements) {
  if (!document.getElementById(`panel-${hostId}`)) return;

  if (measurements.length) {
    const m = measurements[0];

    const badge = document.getElementById(`badge-${hostId}`);
    if (badge) {
      badge.textContent = m.latency_ms != null ? `${m.latency_ms.toFixed(1)} ms` : '—';
      badge.className = `latency-badge latency-badge--${m.status}`;
    }

    const lossEl = document.getElementById(`ploss-${hostId}`);
    if (lossEl) lossEl.textContent = `${m.packet_loss}%`;

    const statusEl = document.getElementById(`pstatus-${hostId}`);
    if (statusEl) { statusEl.textContent = m.status; statusEl.className = `stat-value--${m.status}`; }

    const updatedEl = document.getElementById(`pupdated-${hostId}`);
    if (updatedEl) {
      updatedEl.textContent = new Date(m.timestamp + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const dot = document.querySelector(`#panel-${hostId} .status-dot`);
    if (dot) dot.className = `status-dot status-dot--${m.status}`;

    const hostObj = hosts.find(h => h.id === hostId);
    if (hostObj) hostObj._status = m.status;
    updateSidebarDot(hostId, m.status);
  }

  renderPanelChart(hostId, measurements);
}

function renderPanelChart(hostId, measurements) {
  const canvas = document.getElementById(`chart-${hostId}`);
  if (!canvas) return;

  const pts = [...measurements].reverse();
  const labels = pts.map(m =>
    new Date(m.timestamp + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
  const data = pts.map(m => m.latency_ms);

  if (hostCharts[hostId]) {
    hostCharts[hostId].data.labels = labels;
    hostCharts[hostId].data.datasets[0].data = data;
    hostCharts[hostId].update('none');
    return;
  }

  hostCharts[hostId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.08)',
        borderWidth: 2,
        pointRadius: 2,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: '#94a3b8', maxTicksLimit: 6, font: { size: 10 } },
          grid: { color: '#2a2d3a' },
        },
        y: {
          ticks: { color: '#94a3b8', callback: v => `${v}ms`, font: { size: 10 } },
          grid: { color: '#2a2d3a' },
          beginAtZero: true,
        },
      },
    },
  });
}

async function pingInPanel(hostId) {
  const btn = document.getElementById(`panelPing-${hostId}`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const res = await fetch(`${API}/hosts/${hostId}/ping`, { method: 'POST' });
    if (!res.ok) throw new Error();
    await loadPanelData(hostId);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Ping'; }
  }
}

function openDetail(hostId) {
  stopRefresh();
  destroyHostCharts();
  selectHost(hostId);
}

// ── Detail ────────────────────────────────────────────────────────────────────
async function selectHost(id) {
  viewMode = 'detail';
  selectedHostId = id;
  renderSidebar();
  const host = hosts.find(h => h.id === id);
  if (!host) return;

  destroyDetailChart();
  renderDetailShell(host);

  const measurements = await fetch(`${API}/hosts/${id}/measurements`)
    .then(r => r.json()).catch(() => []);

  if (measurements.length > 0) updateStats(measurements[0]);
  renderChart(measurements);

  fetch(`${API}/hosts/${id}/ports`)
    .then(r => r.json())
    .then(renderPorts)
    .catch(() => {
      const el = document.getElementById("portsGrid");
      if (el) el.innerHTML = '<span class="muted">Failed to load.</span>';
    });
}

function renderDetailShell(host) {
  mainPanel.innerHTML = `
    <div class="host-detail">
      <div class="detail-nav">
        <button class="btn btn--sm" id="backBtn">← Overview</button>
      </div>

      <div class="host-header">
        <div class="host-title">
          <h2>${escapeHtml(host.label || host.address)}</h2>
          ${host.label ? `<span class="host-addr">${escapeHtml(host.address)}</span>` : ""}
        </div>
        <div class="host-actions">
          <button class="btn btn--primary" id="pingBtn">Ping</button>
          <button class="btn btn--danger" id="deleteBtn">Remove</button>
        </div>
      </div>

      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-label">Latency</div>
          <div class="stat-value" id="statLatency">—</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Packet Loss</div>
          <div class="stat-value" id="statLoss">—</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Status</div>
          <div class="stat-value" id="statStatus">—</div>
        </div>
      </div>

      <div class="card">
        <div class="card__header">Latency History</div>
        <div class="chart-wrap"><canvas id="latencyChart"></canvas></div>
      </div>

      <div class="card">
        <div class="card__header">Ports</div>
        <div class="ports-grid" id="portsGrid"><span class="muted">Checking…</span></div>
      </div>

      <div class="card">
        <div class="card__header">
          Traceroute
          <button class="btn btn--sm" id="traceBtn">Run</button>
        </div>
        <div id="traceResult"><span class="muted">Click Run to trace the route.</span></div>
      </div>
    </div>
  `;

  document.getElementById("backBtn").addEventListener("click", () => {
    destroyDetailChart();
    renderOverview();
  });
  document.getElementById("pingBtn").addEventListener("click", () => runPing(host.id));
  document.getElementById("deleteBtn").addEventListener("click", () => deleteHost(host.id));
  document.getElementById("traceBtn").addEventListener("click", () => runTraceroute(host.id));
}

function updateStats(m) {
  const latencyEl = document.getElementById("statLatency");
  const lossEl    = document.getElementById("statLoss");
  const statusEl  = document.getElementById("statStatus");
  if (!latencyEl) return;

  latencyEl.textContent = m.latency_ms != null ? `${m.latency_ms.toFixed(1)} ms` : "—";
  lossEl.textContent    = m.packet_loss != null ? `${m.packet_loss}%` : "—";
  statusEl.textContent  = m.status;
  statusEl.className    = `stat-value stat-value--${m.status}`;
}

function renderChart(measurements) {
  const canvas = document.getElementById("latencyChart");
  if (!canvas) return;

  const pts = [...measurements].reverse();
  const labels = pts.map(m =>
    new Date(m.timestamp + "Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );

  detailChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: pts.map(m => m.latency_ms),
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,0.08)",
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: "#94a3b8", maxTicksLimit: 8, font: { size: 11 } },
          grid: { color: "#2a2d3a" },
        },
        y: {
          ticks: { color: "#94a3b8", callback: v => `${v}ms`, font: { size: 11 } },
          grid: { color: "#2a2d3a" },
          beginAtZero: true,
        },
      },
    },
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function runPing(hostId) {
  const btn = document.getElementById("pingBtn");
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const res = await fetch(`${API}/hosts/${hostId}/ping`, { method: "POST" });
    if (!res.ok) throw new Error();
    const m = await res.json();

    updateStats(m);

    if (detailChart) {
      detailChart.data.labels.push(new Date(m.timestamp + "Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      detailChart.data.datasets[0].data.push(m.latency_ms);
      detailChart.update();
    }

    const host = hosts.find(h => h.id === hostId);
    if (host) { host._status = m.status; updateSidebarDot(hostId, m.status); }
  } finally {
    btn.disabled = false;
    btn.textContent = "Ping";
  }
}

function renderPorts(ports) {
  const el = document.getElementById("portsGrid");
  if (!el) return;
  el.innerHTML = ports.map(p => `
    <div class="port-badge port-badge--${p.open ? "open" : "closed"}">
      <span class="port-num">${p.port}</span>
      <span class="port-status">${p.open ? "open" : "closed"}</span>
    </div>
  `).join("");
}

async function runTraceroute(hostId) {
  const btn    = document.getElementById("traceBtn");
  const result = document.getElementById("traceResult");
  btn.disabled = true;
  btn.textContent = "Running…";
  result.innerHTML = '<span class="muted">Tracing route…</span>';
  try {
    const res = await fetch(`${API}/hosts/${hostId}/traceroute`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    renderTraceroute(data.hops);
  } catch {
    result.innerHTML = '<span class="muted">Traceroute failed.</span>';
  } finally {
    btn.disabled = false;
    btn.textContent = "Run";
  }
}

function renderTraceroute(hops) {
  const el = document.getElementById("traceResult");
  if (!el) return;
  if (!hops || !hops.length) {
    el.innerHTML = '<span class="muted">No hops returned.</span>';
    return;
  }
  el.innerHTML = `
    <table class="trace-table">
      <thead><tr><th>#</th><th>Address</th><th>RTT</th></tr></thead>
      <tbody>
        ${hops.map(h => `
          <tr>
            <td class="muted">${h.hop}</td>
            <td>${h.address ?? '<span class="muted">*</span>'}</td>
            <td>${h.rtt_ms != null ? h.rtt_ms.toFixed(2) + " ms" : '<span class="muted">*</span>'}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function deleteHost(hostId) {
  if (!confirm("Remove this host?")) return;
  try {
    await fetch(`${API}/hosts/${hostId}`, { method: "DELETE" });
    selectedHostId = null;
    viewMode = 'overview';
    destroyDetailChart();
    await loadHosts();
  } catch {
    alert("Failed to remove host.");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function stopRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

function destroyDetailChart() {
  if (detailChart) { detailChart.destroy(); detailChart = null; }
}

function destroyHostCharts() {
  Object.values(hostCharts).forEach(c => c.destroy());
  hostCharts = {};
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadHosts();
