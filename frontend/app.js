const API = "http://localhost:8765";

// ── State ─────────────────────────────────────────────────────────────────────
let hosts = [];
let selectedHostId = null;
let latencyChart = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const hostList       = document.getElementById("hostList");
const mainPanel      = document.getElementById("mainPanel");
const emptyState     = document.getElementById("emptyState");
const addHostBtn     = document.getElementById("addHostBtn");
const addHostModal   = document.getElementById("addHostModal");
const addHostForm    = document.getElementById("addHostForm");
const cancelModalBtn = document.getElementById("cancelModalBtn");

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

// ── Sidebar ───────────────────────────────────────────────────────────────────
async function loadHosts() {
  try {
    const res = await fetch(`${API}/hosts`);
    hosts = await res.json();
    renderSidebar();
  } catch {
    // backend not reachable yet
  }
}

function renderSidebar() {
  hostList.innerHTML = "";
  for (const host of hosts) {
    const li = document.createElement("li");
    li.className = "host-item" + (host.id === selectedHostId ? " host-item--active" : "");
    li.dataset.id = host.id;

    const dot = document.createElement("span");
    dot.className = `status-dot status-dot--${host._status ?? ""}`;

    const name = document.createElement("span");
    name.className = "host-item__name";
    name.textContent = host.label || host.address;

    li.append(dot, name);
    li.addEventListener("click", () => selectHost(host.id));
    hostList.appendChild(li);
  }
}

// ── Detail panel ──────────────────────────────────────────────────────────────
async function selectHost(id) {
  selectedHostId = id;
  renderSidebar();
  const host = hosts.find(h => h.id === id);
  if (!host) return;

  emptyState.style.display = "none";
  if (latencyChart) { latencyChart.destroy(); latencyChart = null; }

  renderDetailShell(host);

  const measurements = await fetch(`${API}/hosts/${id}/measurements`)
    .then(r => r.json()).catch(() => []);

  if (measurements.length > 0) updateStats(measurements[0]);
  renderChart(measurements);

  // port check runs in background — fast enough to not need a spinner
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
      <div class="host-header">
        <div class="host-title">
          <h2>${host.label || host.address}</h2>
          ${host.label ? `<span class="host-addr">${host.address}</span>` : ""}
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
  const labels = pts.map(m => {
    const d = new Date(m.timestamp + "Z");
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  });

  latencyChart = new Chart(canvas, {
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

    if (latencyChart) {
      const d = new Date(m.timestamp + "Z");
      latencyChart.data.labels.push(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      latencyChart.data.datasets[0].data.push(m.latency_ms);
      latencyChart.update();
    }

    const host = hosts.find(h => h.id === hostId);
    if (host) { host._status = m.status; renderSidebar(); }
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
    if (latencyChart) { latencyChart.destroy(); latencyChart = null; }
    mainPanel.innerHTML = "";
    emptyState.style.display = "";
    await loadHosts();
  } catch {
    alert("Failed to remove host.");
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadHosts();
