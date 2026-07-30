/* ═══════════════════════════════════════════════════════
   SentryNet — APP SHELL JAVASCRIPT
   Navigation, identity fetch, Overview, Agent Identity,
   Live Monitoring, Verification page renderers.
   ═══════════════════════════════════════════════════════ */

'use strict';

// ─── API configuration ────────────────────────────────
// Change this one value to point the whole UI at a deployed backend.
const API_BASE_URL = 'https://sentrynet-api.onrender.com';

// ─── Active poll tracker (cleared on every navigation) ─
let _activePoll = null;
let _relativeTimer = null;   // LM page: updates relative timestamps
let _lmRenderedIds = new Set(); // LM page: tracks which alert IDs are in the DOM
let _lmFilter = 'all';  // LM page: current severity filter
let _pageParams = {};      // params passed to the current page (e.g. alertId)

// ─── Page Registry ────────────────────────────────────
const PAGES = {
  'overview': { label: 'Overview', render: renderOverview },
  'agent-identity': { label: 'Agent Identity', render: renderAgentIdentity },
  'live-monitoring': { label: 'Live Monitoring', render: renderLiveMonitoring },
  'verification': { label: 'Verification', render: renderVerification },
};

// ─── DOM References ───────────────────────────────────
const breadcrumbCurrent = document.getElementById('breadcrumb-current');
const pageContainer = document.getElementById('page-container');
const navItems = document.querySelectorAll('.nav-item');

// ─── Navigation ───────────────────────────────────────
function navigateTo(pageId, params = {}) {
  if (!PAGES[pageId]) return;
  _pageParams = params;

  // Stop any page-level timers from the previous page
  if (_activePoll) { clearInterval(_activePoll); _activePoll = null; }
  if (_relativeTimer) { clearInterval(_relativeTimer); _relativeTimer = null; }
  _lmRenderedIds = new Set();
  _lmFilter = 'all';

  navItems.forEach(btn => btn.classList.toggle('active', btn.dataset.page === pageId));
  breadcrumbCurrent.textContent = PAGES[pageId].label;

  pageContainer.style.opacity = '0';
  pageContainer.style.transform = 'translateY(8px)';

  requestAnimationFrame(() => {
    pageContainer.innerHTML = '';
    const content = PAGES[pageId].render();
    pageContainer.appendChild(content);

    requestAnimationFrame(() => {
      pageContainer.style.transition = 'opacity 220ms ease, transform 220ms ease';
      pageContainer.style.opacity = '1';
      pageContainer.style.transform = 'translateY(0)';
    });
  });

  history.replaceState(null, '', `#${pageId}`);
}

navItems.forEach(btn => btn.addEventListener('click', () => navigateTo(btn.dataset.page)));

// ─── Shared SVG gradient def ─────────────────────────
(function injectSvgDefs() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'svg-defs';
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
  svg.innerHTML = `<defs>
    <linearGradient id="nav-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7C6CF6"/>
      <stop offset="100%" stop-color="#4F9CF9"/>
    </linearGradient>
  </defs>`;
  document.body.prepend(svg);
})();

// ─── DOM helper ───────────────────────────────────────
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') e.className = v;
    else if (k === 'innerHTML') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === 'string') e.appendChild(document.createTextNode(child));
    else if (child) e.appendChild(child);
  }
  return e;
}

// ─── String utilities ─────────────────────────────────
function escHTML(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function shortAddr(full, f = 6, b = 5) { return (!full || full.length <= f + b + 1) ? (full || '—') : `${full.slice(0, f)}…${full.slice(-b)}`; }
function shortHash(h, f = 6, b = 4) { return (!h || h.length <= f + b + 1) ? (h || '—') : `${h.slice(0, f)}…${h.slice(-b)}`; }
function formatUTC(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toUTCString().replace(' GMT', ' UTC'); } catch { return iso; }
}
function formatShortDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  } catch { return iso; }
}
function humanizeType(type) {
  return String(type || '').replace(/([A-Z])/g, ' $1').trim();
}
function capitalise(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

// ─── Icon SVGs ────────────────────────────────────────
function copySvg() {
  return `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <rect x="4" y="4" width="7.5" height="7.5" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
    <path d="M2 8.5V2C2 1.45 2.45 1 3 1H9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`;
}
function checkSvg() {
  return `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M2.5 6.5L5.5 9.5L10.5 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// ─── Shared card HTML (placeholder pages) ────────────
function cardHTML(label, value, sub, trend, isWarning = false) {
  return `<div class="placeholder-card">
    <div class="accent-line"></div>
    <div class="card-label">${label}</div>
    <div class="card-value" style="${isWarning ? 'color:var(--warn-amber)' : ''}">${value}</div>
    ${sub ? `<div class="card-mono">${sub}</div>` : ''}
    ${trend ? `<div class="card-trend">${trend}</div>` : ''}
  </div>`;
}

// ═══════════════════════════════════════════════════════
// OVERVIEW PAGE
// ═══════════════════════════════════════════════════════

function renderOverview() {
  const page = el('div', { className: 'ov-page' });

  page.innerHTML = `
    <!-- ── Hero ── -->
    <div class="ov-hero">
      <div class="ov-badge">
        <span class="ov-badge-dot"></span>
        AI SECURITY AGENT FOR BOT CHAIN
      </div>
      <h1 class="ov-title">Autonomous Security<br>for the DePIN Layer</h1>
      <p class="ov-subtitle">SentryNet continuously watches compute nodes, detects anomalous behaviour, generates AI security reports and records verifiable evidence on BOT Chain.</p>
      <div class="ov-cta-row">
        <button class="ov-btn-primary" id="ov-btn-dashboard">
          Launch Dashboard
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="ov-btn-outline" id="ov-btn-monitoring">
          View Live Monitoring
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- ── Browser Window ── -->
    <div class="ov-browser-window">

      <!-- Chrome bar -->
      <div class="ov-browser-bar">
        <div class="ov-browser-dots">
          <span class="ov-dot ov-dot-red"></span>
          <span class="ov-dot ov-dot-yellow"></span>
          <span class="ov-dot ov-dot-green"></span>
        </div>
        <div class="ov-browser-nav">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7L9 11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </div>
        <div class="ov-browser-url">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <rect x="1" y="3.5" width="9" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.1"/>
            <path d="M3.5 3.5V2.5C3.5 1.67 4.17 1 5 1H6C6.83 1 7.5 1.67 7.5 2.5V3.5" stroke="currentColor" stroke-width="1.1"/>
          </svg>
          app.sentrynet.io
        </div>
        <div class="ov-browser-actions">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2.5L8.24 5.62L11.5 5.88L9.09 8L9.85 11.18L7 9.5L4.15 11.18L4.91 8L2.5 5.88L5.76 5.62L7 2.5Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="2" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.1"/><rect x="8" y="2" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.1"/><rect x="2" y="8" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.1"/><rect x="8" y="8" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.1"/></svg>
        </div>
      </div>

      <!-- App content -->
      <div class="ov-browser-content">

        <!-- Stat row -->
        <div class="ov-stat-row">

          <!-- Nodes Monitored -->
          <div class="ov-stat-card">
            <div class="ov-stat-icon ov-icon-purple">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="5" cy="10" r="2.5" stroke="currentColor" stroke-width="1.4"/>
                <circle cx="15" cy="5" r="2.5" stroke="currentColor" stroke-width="1.4"/>
                <circle cx="15" cy="15" r="2.5" stroke="currentColor" stroke-width="1.4"/>
                <path d="M7.5 10H10M12.5 5.8L10.5 9M12.5 14.2L10.5 11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
            </div>
            <div class="ov-stat-info">
              <div class="ov-stat-label">Nodes Monitored</div>
              <div class="ov-stat-val" id="ov-nodes-val"><span class="ov-skeleton" style="width:32px;height:28px"></span></div>
              <div class="ov-stat-sub" id="ov-nodes-sub">
                <span class="ov-live-dot"></span> <span id="ov-nodes-sub-txt">loading…</span>
              </div>
            </div>
          </div>

          <!-- Threats Detected -->
          <div class="ov-stat-card">
            <div class="ov-stat-icon ov-icon-rose">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 3L17.5 17H2.5L10 3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
                <path d="M10 9V12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                <circle cx="10" cy="14.5" r="0.8" fill="currentColor"/>
              </svg>
            </div>
            <div class="ov-stat-info">
              <div class="ov-stat-label">Threats Detected</div>
              <div class="ov-stat-val" id="ov-threats-val"><span class="ov-skeleton" style="width:32px;height:28px"></span></div>
              <div class="ov-stat-sub">
                <span class="ov-warn-dot"></span> <span id="ov-threats-sub-txt">loading…</span>
              </div>
            </div>
          </div>

          <!-- Network Uptime -->
          <div class="ov-stat-card">
            <div class="ov-stat-icon ov-icon-emerald">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <polyline points="2,10 5,10 7,4 10,17 13,7 15,10 18,10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="ov-stat-info">
              <div class="ov-stat-label">Network Uptime</div>
              <div class="ov-stat-val">100%</div>
              <div class="ov-stat-sub">
                <span class="ov-live-dot"></span> All systems operational
              </div>
            </div>
          </div>

        </div><!-- /ov-stat-row -->

        <!-- Events section -->
        <div class="ov-events-section">
          <div class="ov-events-header">
            <div>
              <div class="ov-events-title">Recent Security Events</div>
              <div class="ov-events-sub">Live feed of the latest detections and verifications.</div>
            </div>
            <button class="ov-view-all-btn" id="ov-view-all">View all alerts</button>
          </div>
          <div class="ov-events-list" id="ov-events-list">
            <!-- skeleton rows -->
            ${[1, 2, 3].map(() => `
              <div class="ov-event-row ov-event-skeleton">
                <div class="ov-skeleton" style="width:28px;height:28px;border-radius:50%"></div>
                <div style="display:flex;flex-direction:column;gap:6px">
                  <div class="ov-skeleton" style="width:180px;height:13px"></div>
                  <div class="ov-skeleton" style="width:90px;height:11px"></div>
                </div>
                <div class="ov-skeleton" style="width:60px;height:22px;border-radius:100px"></div>
                <div class="ov-skeleton" style="width:130px;height:13px"></div>
                <div class="ov-skeleton" style="width:100px;height:13px"></div>
                <div class="ov-skeleton" style="width:76px;height:30px;border-radius:8px"></div>
              </div>
            `).join('')}
          </div>
        </div>

      </div><!-- /ov-browser-content -->
    </div><!-- /ov-browser-window -->
  `;

  // Wire hero buttons
  page.querySelector('#ov-btn-dashboard').addEventListener('click', () => navigateTo('agent-identity'));
  page.querySelector('#ov-btn-monitoring').addEventListener('click', () => navigateTo('live-monitoring'));
  page.querySelector('#ov-view-all').addEventListener('click', () => navigateTo('live-monitoring'));

  // Initial load + 6s poll
  loadOverviewData();
  _activePoll = setInterval(loadOverviewData, 6000);

  return page;
}

// ── Data fetch & update ───────────────────────────────
async function loadOverviewData() {
  try {
    const [iRes, aRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/identity`),
      fetch(`${API_BASE_URL}/api/alerts`),
    ]);
    const identity = iRes.ok ? await iRes.json() : null;
    const alerts = aRes.ok ? await aRes.json() : [];
    updateOverviewStats(identity, alerts);
    updateOverviewEvents(alerts);
  } catch (err) {
    console.warn('[Overview] fetch failed:', err.message);
    showOverviewOffline();
  }
}

function updateOverviewStats(identity, alerts) {
  // Nodes
  const nodesVal = document.getElementById('ov-nodes-val');
  const nodesSub = document.getElementById('ov-nodes-sub-txt');
  if (nodesVal) nodesVal.textContent = identity?.nodesMonitored ?? '—';
  if (nodesSub) nodesSub.textContent = `${identity?.nodesMonitored ?? 0} active`;

  // Threats
  const threatsVal = document.getElementById('ov-threats-val');
  const threatsSub = document.getElementById('ov-threats-sub-txt');
  const highCount = Array.isArray(alerts) ? alerts.filter(a => a.severity === 'high').length : 0;
  if (threatsVal) threatsVal.textContent = Array.isArray(alerts) ? String(alerts.length) : '—';
  if (threatsSub) threatsSub.textContent = `${highCount} high severity`;
}

function updateOverviewEvents(alerts) {
  const list = document.getElementById('ov-events-list');
  if (!list) return;

  const recent = Array.isArray(alerts) ? alerts.slice(0, 4) : [];

  if (recent.length === 0) {
    list.innerHTML = `
      <div class="ov-empty-state">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" style="opacity:.3">
          <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="1.4"/>
          <path d="M16 10v7M16 20v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
        <span>No anomalies detected yet — SentryNet is watching.</span>
      </div>`;
    return;
  }

  // Compare with existing rendered rows to avoid unnecessary DOM churn
  const existing = list.getAttribute('data-rendered');
  const key = recent.map(a => a.id).join(',');
  if (existing === key) return; // Nothing changed
  list.setAttribute('data-rendered', key);

  list.innerHTML = recent.map(alert => buildEventRow(alert)).join('');

  // Wire copy buttons
  list.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.copy;
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('copied');
        btn.innerHTML = checkSvg();
        setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = copySvg(); }, 1800);
      });
    });
  });

  // Wire View Proof buttons → Verification page
  list.querySelectorAll('.ov-view-proof-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo('verification', { alertId: btn.dataset.id }));
  });
}

function buildEventRow(alert) {
  const sev = (alert.severity || 'info').toLowerCase();
  const sevClass = sev === 'high' ? 'sev-high' : sev === 'medium' ? 'sev-medium' : 'sev-info';
  const sevLabel = capitalise(sev);
  const humanType = humanizeType(alert.type);
  const hash = alert.txHash || '';
  const shortH = shortHash(hash);

  // Icon per severity
  const icon = sev === 'high'
    ? `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2L12.5 12H1.5L7 2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M7 6.5V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="7" cy="10.5" r=".6" fill="currentColor"/></svg>`
    : sev === 'medium'
      ? `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2L12.5 12H1.5L7 2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M7 6.5V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="7" cy="10.5" r=".6" fill="currentColor"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M7 5.5V7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="7" cy="9.2" r=".6" fill="currentColor"/></svg>`;

  return `
    <div class="ov-event-row ${sevClass}">
      <div class="ov-event-icon-wrap ${sevClass}">${icon}</div>
      <div class="ov-event-main">
        <div class="ov-event-type">${escHTML(humanType)}</div>
        <div class="ov-event-node">Node: ${escHTML(alert.nodeId || '—')}</div>
      </div>
      <div class="ov-event-col">
        <div class="ov-col-label">Severity</div>
        <span class="ov-sev-pill ${sevClass}">
          <span class="ov-pill-dot ${sevClass}"></span>${sevLabel}
        </span>
      </div>
      <div class="ov-event-col">
        <div class="ov-col-label">Detected At</div>
        <span class="mono ov-event-ts">${escHTML(formatShortDate(alert.detectedAt))}</span>
      </div>
      <div class="ov-event-col">
        <div class="ov-col-label">Tx Hash</div>
        <span class="ov-hash-row">
          <span class="mono ov-event-hash-val">${escHTML(shortH)}</span>
          ${hash ? `<button class="ov-icon-copy-btn" data-copy="${escAttr(hash)}" aria-label="Copy tx hash">${copySvg()}</button>` : ''}
        </span>
      </div>
      <button class="ov-view-proof-btn" data-id="${escAttr(alert.id || '')}">View Proof</button>
    </div>`;
}

function showOverviewOffline() {
  const nodesVal = document.getElementById('ov-nodes-val');
  const nodesSub = document.getElementById('ov-nodes-sub-txt');
  const threatsVal = document.getElementById('ov-threats-val');
  const threatsSub = document.getElementById('ov-threats-sub-txt');
  if (nodesVal) nodesVal.textContent = '—';
  if (nodesSub) nodesSub.textContent = 'agent offline';
  if (threatsVal) threatsVal.textContent = '—';
  if (threatsSub) threatsSub.textContent = '—';
  const list = document.getElementById('ov-events-list');
  if (list && !list.getAttribute('data-rendered')) {
    list.innerHTML = `<div class="ov-empty-state">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" style="opacity:.3">
        <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="1.4"/>
        <path d="M16 10v7M16 20v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
      <span>Agent offline — start <code>node agent/sentinel.js</code> and refresh.</span>
    </div>`;
  }
}

// ═══════════════════════════════════════════════════════
// AGENT IDENTITY PAGE
// ═══════════════════════════════════════════════════════
function renderAgentIdentity() {
  const page = el('div', { className: 'ai-page' });

  page.innerHTML = `
    <div class="ai-header">
      <h1 class="ai-title">Agent Identity</h1>
      <p class="ai-subtitle">Cryptographically verifiable identity for the autonomous monitoring agent.</p>
    </div>
    <div class="ai-body">
      <!-- LEFT: Identity Card -->
      <div class="ai-identity-card" id="ai-identity-card">
        <div class="ai-emblem-zone">
          <div class="ai-emblem">
            <div class="ai-emblem-ring"></div>
            <div class="ai-emblem-inner">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                <defs>
                  <linearGradient id="emblem-grad" x1="6" y1="3" x2="30" y2="33" gradientUnits="userSpaceOnUse">
                    <stop stop-color="#7C6CF6"/><stop offset="1" stop-color="#4F9CF9"/>
                  </linearGradient>
                </defs>
                <path d="M18 3L5 8.5V17C5 24.18 10.8 30.93 18 33C25.2 30.93 31 24.18 31 17V8.5L18 3Z"
                      stroke="url(#emblem-grad)" stroke-width="1.6" fill="none" stroke-linejoin="round"/>
                <path d="M13 17.5L16.5 21L23 14.5"
                      stroke="url(#emblem-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </div>
          <div class="ai-agent-name">SentryNet</div>
          <div class="ai-agent-role">AI Security Agent</div>
        </div>
        <div class="ai-divider-top"></div>
        <div class="ai-rows" id="ai-rows">
          ${['Agent Address', 'Contract Address', 'Network', 'Chain ID', 'Started At'].map(l => `
            <div class="ai-row">
              <span class="ai-row-label">${l}</span>
              <span class="ai-skeleton" style="width:${l === 'Network' ? 100 : 160}px"></span>
              <span style="width:120px"></span>
            </div>`).join('')}
        </div>
      </div>
      <!-- RIGHT -->
      <div class="ai-right">
        <div class="ai-explain-card">
          <div class="ai-explain-header">
            <div class="ai-explain-icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 1.5L2.5 4.25V8.5C2.5 12.17 5.33 15.6 9 16.5C12.67 15.6 15.5 12.17 15.5 8.5V4.25L9 1.5Z"
                      stroke="url(#nav-grad)" stroke-width="1.4" stroke-linejoin="round"/>
                <path d="M6.5 9L8 10.5L11.5 7" stroke="url(#nav-grad)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <span class="ai-explain-title">On-Chain Identity Verification</span>
          </div>
          <div class="ai-explain-body">
            <p>SentryNet's identity is anchored on BOT Chain. All actions performed by this agent are cryptographically signed and recorded on-chain for transparency and auditability.</p>
            <p>This ensures that every detection, report, and verification is fully verifiable, immutable, and tamper-proof — providing operators with a trustless audit trail.</p>
          </div>
        </div>
        <div class="ai-stat-row" id="ai-stat-row">
          <div class="ai-stat-card">
            <div class="ai-stat-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="5.5" stroke="url(#nav-grad)" stroke-width="1.4"/>
                <path d="M8 2.5C8 2.5 5.5 5 5.5 8C5.5 11 8 13.5 8 13.5" stroke="url(#nav-grad)" stroke-width="1.2" stroke-linecap="round"/>
                <path d="M8 2.5C8 2.5 10.5 5 10.5 8C10.5 11 8 13.5 8 13.5" stroke="url(#nav-grad)" stroke-width="1.2" stroke-linecap="round"/>
                <line x1="2.5" y1="8" x2="13.5" y2="8" stroke="url(#nav-grad)" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
            </div>
            <div class="ai-stat-label">Network</div>
            <div class="ai-stat-value" id="stat-network"><span class="ai-skeleton" style="width:80px;height:18px"></span></div>
            <div class="ai-stat-sub"><span class="ai-stat-live-dot"></span>Active</div>
          </div>
          <div class="ai-stat-card">
            <div class="ai-stat-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="1.5" y="5.5" width="4" height="4" rx="1" stroke="url(#nav-grad)" stroke-width="1.3"/>
                <rect x="10.5" y="5.5" width="4" height="4" rx="1" stroke="url(#nav-grad)" stroke-width="1.3"/>
                <rect x="6" y="1.5" width="4" height="4" rx="1" stroke="url(#nav-grad)" stroke-width="1.3"/>
                <path d="M8 5.5V10.5M3.5 9.5V13M12.5 9.5V13" stroke="url(#nav-grad)" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
            </div>
            <div class="ai-stat-label">Nodes Monitored</div>
            <div class="ai-stat-value" id="stat-nodes"><span class="ai-skeleton" style="width:40px;height:18px"></span></div>
            <div class="ai-stat-sub">Across 1 registry</div>
          </div>
        </div>
      </div>
    </div>`;

  fetch(`${API_BASE_URL}/api/identity`)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(d => populateIdentityPage(d))
    .catch(err => { console.warn('[Identity] fetch failed:', err.message); showIdentityError(err.message); });

  return page;
}

function populateIdentityPage(d) {
  const rows = [
    { label: 'Agent Address', value: shortAddr(d.agentAddress), full: d.agentAddress, mono: true, url: d.explorerAgentUrl },
    { label: 'Contract Address', value: shortAddr(d.contractAddress), full: d.contractAddress, mono: true, url: d.explorerContractUrl },
    { label: 'Network', value: d.network || '—', full: d.network, mono: false, url: null },
    { label: 'Chain ID', value: d.chainId != null ? String(d.chainId) : '—', full: d.chainId != null ? String(d.chainId) : null, mono: true, url: null },
    { label: 'Started At', value: formatUTC(d.startedAt), full: d.startedAt, mono: true, url: null },
  ];

  const rowsEl = document.getElementById('ai-rows');
  if (!rowsEl) return;
  rowsEl.innerHTML = rows.map(r => `
    <div class="ai-row">
      <span class="ai-row-label">${r.label}</span>
      <span class="${r.mono ? 'ai-row-value' : 'ai-row-value plain'}" title="${escAttr(r.full || '')}">${escHTML(r.value)}</span>
      <span class="ai-row-actions">
        ${r.full ? `<button class="ai-copy-btn" data-copy="${escAttr(r.full)}" aria-label="Copy ${r.label}">${copySvg()}</button>` : ''}
        ${r.url ? `<a class="ai-explorer-link" href="${escAttr(r.url)}" target="_blank" rel="noopener">View on Explorer <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 8L8 2M5 2H8V5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></a>` : ''}
      </span>
    </div>`).join('');

  rowsEl.querySelectorAll('.ai-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.copy).then(() => {
        btn.classList.add('copied'); btn.innerHTML = checkSvg();
        setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = copySvg(); }, 1800);
      });
    });
  });

  const netEl = document.getElementById('stat-network');
  const nodesEl = document.getElementById('stat-nodes');
  if (netEl) netEl.textContent = d.network || '—';
  if (nodesEl) nodesEl.textContent = d.nodesMonitored != null ? String(d.nodesMonitored) : '—';
}

function showIdentityError(msg) {
  const card = document.getElementById('ai-identity-card');
  if (!card) return;
  const banner = document.createElement('div');
  banner.className = 'ai-error-banner';
  banner.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M7 4v3.5M7 9.5v.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
    Agent unavailable — start <code>node agent/sentinel.js</code> and refresh.`;
  card.prepend(banner);
  const rows = document.getElementById('ai-rows');
  if (rows) rows.querySelectorAll('.ai-skeleton').forEach(s => { s.textContent = '—'; s.className = 'ai-row-value'; });
}

// ═══════════════════════════════════════════════════════
// LIVE MONITORING PAGE
// ═══════════════════════════════════════════════════════

// Verbose type labels matching the reference image
const LM_TYPE_MAP = {
  'ProofFromInactiveNode': 'Proof Submitted From Inactive Node',
  'ImplausibleOutputClaim': 'Implausible Output Claim Detected',
  'ImplausibleOutputFlag': 'Implausible Output Claim Detected',
  'NodeRegistered': 'Node Registered On-Chain',
  'NodeDeactivated': 'Node Deactivated',
  'NodeReactivated': 'Node Reactivated',
  'ProofSubmitted': 'Proof Submitted On-Chain',
  'NodeHeartbeat': 'Node Heartbeat Verified',
};
function humanizeVerbose(type) {
  return LM_TYPE_MAP[type] || humanizeType(type);
}

function sevToLabel(sev) {
  return sev === 'high' ? 'High' : sev === 'medium' ? 'Medium' : 'Info';
}

function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} second${s !== 1 ? 's' : ''} ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m !== 1 ? 's' : ''} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h !== 1 ? 's' : ''} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d !== 1 ? 's' : ''} ago`;
}

function renderLiveMonitoring() {
  const page = el('div', { className: 'lm-page' });

  page.innerHTML = `
    <!-- ── Header ── -->
    <div class="lm-header">
      <div class="lm-title-area">
        <h1 class="lm-title">Live Monitoring</h1>
        <p class="lm-subtitle">Continuous verification of compute-node behaviour across BOT Chain.</p>
      </div>
      <div class="lm-live-badge">
        <span class="lm-live-dot"></span>
        <span class="lm-live-label">LIVE</span>
        <span class="lm-polling-text">Polling every 6 seconds</span>
      </div>
    </div>

    <!-- ── Stat cards ── -->
    <div class="lm-stat-row">

      <!-- Nodes Watched -->
      <div class="lm-stat-card">
        <div class="lm-stat-icon lm-icon-purple">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="5.5" cy="11" r="3" stroke="currentColor" stroke-width="1.4"/>
            <circle cx="16.5" cy="5.5" r="3" stroke="currentColor" stroke-width="1.4"/>
            <circle cx="16.5" cy="16.5" r="3" stroke="currentColor" stroke-width="1.4"/>
            <path d="M8.5 11H11M13.5 6.8L11.5 10M13.5 15.2L11.5 12"
                  stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="lm-stat-info">
          <div class="lm-stat-label">Nodes Watched</div>
          <div class="lm-stat-value" id="lm-nodes-val"><span class="lm-skel" style="width:36px;height:32px"></span></div>
          <div class="lm-stat-sub">Across 1 network</div>
        </div>
      </div>

      <!-- Active Alerts -->
      <div class="lm-stat-card">
        <div class="lm-stat-icon lm-icon-blue">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M11 2L2.5 19.5H19.5L11 2Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="M11 9V13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="11" cy="16" r="0.9" fill="currentColor"/>
          </svg>
        </div>
        <div class="lm-stat-info">
          <div class="lm-stat-label">Active Alerts</div>
          <div class="lm-stat-value" id="lm-alerts-val"><span class="lm-skel" style="width:36px;height:32px"></span></div>
          <div class="lm-stat-sub">Across all severities</div>
        </div>
      </div>

      <!-- Critical Events -->
      <div class="lm-stat-card">
        <div class="lm-stat-icon lm-icon-rose">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M11 3L4.5 11H9V20L17.5 11H13V3Z"
                  stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="lm-stat-info">
          <div class="lm-stat-label">Critical Events</div>
          <div class="lm-stat-value" id="lm-critical-val"><span class="lm-skel" style="width:36px;height:32px"></span></div>
          <div class="lm-stat-sub">Requires attention</div>
        </div>
      </div>

    </div><!-- /lm-stat-row -->

    <!-- ── Feed ── -->
    <div class="lm-feed-section">
      <div class="lm-feed-header">
        <div class="lm-feed-header-left">
          <div class="lm-feed-title-row">
            <span class="lm-feed-icon" aria-hidden="true">
              <!-- broadcast icon -->
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.2"/>
                <path d="M3.5 10.5C2.12 9.12 2.12 6.88 3.5 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                <path d="M10.5 5.5C11.88 6.88 11.88 9.12 10.5 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                <path d="M1.5 12.5C-0.5 10.5-0.5 3.5 1.5 1.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                <path d="M12.5 1.5C14.5 3.5 14.5 10.5 12.5 12.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
              </svg>
            </span>
            <span class="lm-feed-name">Live Activity Feed</span>
          </div>
          <div class="lm-feed-subtitle">Real-time security events and verifications.</div>
        </div>
        <div class="lm-filter-wrap">
          <select class="lm-severity-select" id="lm-filter" aria-label="Filter by severity">
            <option value="all">All Severities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
          </select>
          <svg class="lm-filter-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>
      <div class="lm-feed-list" id="lm-feed-list">
        <!-- skeleton placeholder -->
        ${[1, 2, 3].map(() => `
          <div class="lm-alert-card lm-skel-row">
            <div class="lm-skel" style="width:36px;height:36px;border-radius:50%;flex-shrink:0"></div>
            <div style="display:flex;flex-direction:column;gap:7px;flex:1">
              <div class="lm-skel" style="width:260px;height:14px"></div>
              <div class="lm-skel" style="width:110px;height:11px"></div>
            </div>
            <div class="lm-skel" style="width:130px;height:12px"></div>
            <div class="lm-skel" style="width:72px;height:24px;border-radius:100px"></div>
            <div class="lm-skel" style="width:90px;height:32px;border-radius:8px"></div>
          </div>`).join('')}
      </div>
    </div>
  `;

  // Wire severity filter
  page.querySelector('#lm-filter').addEventListener('change', e => {
    _lmFilter = e.target.value;
    applyLmFilter();
  });

  // Initial load + poll
  loadLmData();
  _activePoll = setInterval(loadLmData, 6000);
  // Update relative timestamps without re-fetching
  _relativeTimer = setInterval(updateLmRelTimes, 15000);

  return page;
}

async function loadLmData() {
  try {
    const [iRes, aRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/identity`),
      fetch(`${API_BASE_URL}/api/alerts`),
    ]);
    const identity = iRes.ok ? await iRes.json() : null;
    const alerts = aRes.ok ? await aRes.json() : [];
    updateLmStats(identity, alerts);
    updateLmFeed(alerts);
  } catch (err) {
    console.warn('[LM] fetch error:', err.message);
    updateLmStats(null, []);
  }
}

function updateLmStats(identity, alerts) {
  const nodesEl = document.getElementById('lm-nodes-val');
  const alertsEl = document.getElementById('lm-alerts-val');
  const criticalEl = document.getElementById('lm-critical-val');
  const high = Array.isArray(alerts) ? alerts.filter(a => a.severity === 'high').length : 0;
  if (nodesEl) nodesEl.textContent = identity?.nodesMonitored ?? '—';
  if (alertsEl) alertsEl.textContent = Array.isArray(alerts) ? String(alerts.length) : '—';
  if (criticalEl) criticalEl.textContent = String(high);
}

function updateLmFeed(alerts) {
  const list = document.getElementById('lm-feed-list');
  if (!list) return;

  if (!Array.isArray(alerts) || alerts.length === 0) {
    _lmRenderedIds = new Set();
    list.innerHTML = `
      <div class="lm-empty-state">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" style="opacity:.3">
          <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="1.4"/>
          <path d="M16 10v7M16 20v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
        <span>No anomalies detected yet — SentryNet is watching.</span>
      </div>`;
    return;
  }

  // Find IDs not yet in the DOM (new alerts since last poll)
  const newAlerts = alerts.filter(a => !_lmRenderedIds.has(a.id));

  // First render: replace skeletons wholesale
  if (_lmRenderedIds.size === 0) {
    list.innerHTML = '';
    alerts.forEach(a => {
      const card = buildLmCard(a, false);
      list.appendChild(card);
      _lmRenderedIds.add(a.id);
    });
    applyLmFilter();
    return;
  }

  // Incremental: prepend only genuinely new rows with slide-in animation
  newAlerts.forEach(a => {
    const card = buildLmCard(a, true);
    list.prepend(card);
    _lmRenderedIds.add(a.id);
  });
  if (newAlerts.length) applyLmFilter();
}

function buildLmCard(alert, animate) {
  const sev = (alert.severity || 'info').toLowerCase();
  const sevClass = sev === 'high' ? 'sev-high' : sev === 'medium' ? 'sev-medium' : 'sev-info';
  const label = sevToLabel(sev);
  const title = humanizeVerbose(alert.type);
  const ts = formatShortDate(alert.detectedAt);
  const rel = relativeTime(alert.detectedAt);

  // Severity icon
  const iconInner = sev === 'high'
    ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14.5 14H1.5L8 2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 7V10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="12" r=".7" fill="currentColor"/></svg>`
    : sev === 'medium'
      ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14.5 14H1.5L8 2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 7V10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="12" r=".7" fill="currentColor"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M8 6V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="11" r=".7" fill="currentColor"/></svg>`;

  const div = document.createElement('div');
  div.className = `lm-alert-card ${sevClass}${animate ? ' lm-card-new' : ''}`;
  div.dataset.sev = sev;
  div.dataset.id = alert.id || '';

  div.innerHTML = `
    <div class="lm-alert-icon ${sevClass}">${iconInner}</div>
    <div class="lm-alert-main">
      <div class="lm-alert-title">${escHTML(title)}</div>
      <div class="lm-alert-node">Node ID: ${escHTML(alert.nodeId || '—')}</div>
    </div>
    <div class="lm-alert-time">
      <span class="mono lm-alert-ts">${escHTML(ts)}</span>
      <span class="lm-alert-rel" data-detected="${escAttr(alert.detectedAt || '')}">${escHTML(rel)}</span>
    </div>
    <span class="lm-sev-pill ${sevClass}">
      <span class="lm-pill-dot ${sevClass}"></span>${escHTML(label)}
    </span>
    <button class="lm-proof-btn" data-id="${escAttr(alert.id || '')}">
      View Proof
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
        <path d="M2 9L9 2M6 2H9V5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>`;

  div.querySelector('.lm-proof-btn').addEventListener('click', () => navigateTo('verification', { alertId: alert.id }));
  return div;
}

function applyLmFilter() {
  const list = document.getElementById('lm-feed-list');
  if (!list) return;
  list.querySelectorAll('.lm-alert-card').forEach(card => {
    const match = _lmFilter === 'all' || card.dataset.sev === _lmFilter;
    card.classList.toggle('lm-hidden', !match);
  });
}

function updateLmRelTimes() {
  document.querySelectorAll('.lm-alert-rel').forEach(span => {
    const iso = span.dataset.detected;
    if (iso) span.textContent = relativeTime(iso);
  });
}

// ═══════════════════════════════════════════════════════
// VERIFICATION & PROOF PAGE
// ═══════════════════════════════════════════════════════

function humanizeKey(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

function renderReport(text) {
  if (!text) return '<p class="vp-no-report">No report generated for this alert.</p>';
  return text.split(/\n+/).filter(p => p.trim())
    .map(p => `<p>${escHTML(p.trim())}</p>`).join('');
}

function renderVerification() {
  const page = el('div', { className: 'vp-page' });
  const alertId = _pageParams.alertId || null;

  // Loading scaffold — populated after fetch
  page.innerHTML = `
    <!-- Header -->
    <div class="vp-header">
      <div class="vp-header-left">
        <button class="vp-back-btn" id="vp-back">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7L9 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Back to Alerts
        </button>
        <h1 class="vp-title">Verification &amp; Proof</h1>
        <p class="vp-subtitle">Every detection is backed by verifiable on-chain evidence.</p>
      </div>
      <div class="vp-header-right">
        <div class="vp-live-badge">
          <span class="vp-live-dot"></span>
          <span class="vp-live-label">LIVE</span>
          <span class="vp-live-polling">Polling every 6 seconds</span>
        </div>
        <button class="vp-lm-btn" id="vp-lm-btn">
          View in Live Monitoring
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M2 9L9 2M6 2H9V5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Main content area -->
    <div id="vp-content">
      <div class="vp-loading">
        <div class="vp-panels">
          <div class="vp-left-panel">
            <div class="vp-panel-header">
              <div class="vp-panel-icon vp-icon-purple">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M9 1.5L1.5 4.5V9C1.5 13 5 16.5 9 17.5C13 16.5 16.5 13 16.5 9V4.5L9 1.5Z" stroke="url(#nav-grad)" stroke-width="1.4" stroke-linejoin="round"/>
                  <path d="M6 9L8 11L12 7" stroke="url(#nav-grad)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <span class="vp-panel-title">On-Chain Verification</span>
            </div>
            <div class="vp-rows">${[1, 2, 3, 4, 5].map(() =>
    `<div class="vp-row"><span class="lm-skel" style="width:110px;height:12px"></span><span class="lm-skel" style="width:180px;height:12px"></span></div>`
  ).join('')}</div>
          </div>
          <div class="vp-right-panel">
            <div class="vp-panel-header">
              <div class="vp-panel-icon vp-icon-purple">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M3 5H15M3 9H11M3 13H9" stroke="url(#nav-grad)" stroke-width="1.4" stroke-linecap="round"/>
                </svg>
              </div>
              <span class="vp-panel-title">AI Security Analysis</span>
              <span class="vp-gemini-tag">&#10022; Generated by Gemini</span>
            </div>
            <div class="vp-report-body">${[1, 2, 3].map(() =>
    `<div class="lm-skel" style="width:100%;height:13px;margin-bottom:8px"></div>`
  ).join('')}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer note -->
    <div class="vp-footer-note">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="opacity:.35;flex-shrink:0">
        <path d="M7 1L1 3.5V7C1 10.5 3.5 13.5 7 14.5C10.5 13.5 13 10.5 13 7V3.5L7 1Z" stroke="currentColor" stroke-width="1.2"/>
        <path d="M5 7L6.5 8.5L9 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
      All evidence is permanently recorded on BOT Chain and cannot be tampered with.
    </div>
  `;

  // Wire static nav buttons immediately (they don't need data)
  page.querySelector('#vp-back').addEventListener('click', () => navigateTo('live-monitoring'));
  page.querySelector('#vp-lm-btn').addEventListener('click', () => navigateTo('live-monitoring'));

  // Fetch and render
  fetch(`${API_BASE_URL}/api/alerts`)
    .then(r => r.ok ? r.json() : [])
    .then(alerts => {
      const found = alertId
        ? alerts.find(a => String(a.id) === String(alertId))
        : alerts[0];
      const content = document.getElementById('vp-content');
      if (!content) return;
      if (!found) {
        content.innerHTML = `
          <div class="vp-not-found">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style="opacity:.25">
              <circle cx="20" cy="20" r="18" stroke="currentColor" stroke-width="1.5"/>
              <path d="M20 12v10M20 26v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            <div>
              <div class="vp-nf-title">Alert not found</div>
              <div class="vp-nf-sub">This alert could not be found &mdash; it may have been cleared when the agent last restarted.</div>
            </div>
            <button class="vp-lm-btn" id="vp-nf-lm">View Live Monitoring</button>
          </div>`;
        document.getElementById('vp-nf-lm')?.addEventListener('click', () => navigateTo('live-monitoring'));
        return;
      }
      renderVpDetail(content, found);
    })
    .catch(err => {
      const content = document.getElementById('vp-content');
      if (content) content.innerHTML = `<div class="vp-not-found"><div class="vp-nf-title">Agent unavailable</div><div class="vp-nf-sub">Start <code>node agent/sentinel.js</code> and refresh.</div></div>`;
    });

  // Poll every 6s to refresh the detail if the alert updates
  _activePoll = setInterval(() => {
    fetch(`${API_BASE_URL}/api/alerts`)
      .then(r => r.ok ? r.json() : [])
      .then(alerts => {
        const found = alertId
          ? alerts.find(a => String(a.id) === String(alertId))
          : alerts[0];
        const content = document.getElementById('vp-content');
        if (content && found) renderVpDetail(content, found);
      })
      .catch(() => { });
  }, 6000);

  return page;
}

function renderVpDetail(container, alert) {
  const sev = (alert.severity || 'info').toLowerCase();
  const sevClass = sev === 'high' ? 'sev-high' : sev === 'medium' ? 'sev-medium' : 'sev-info';
  const sevLabel = sevToLabel(sev);

  // ── Fixed rows ───────────────────────────────────────
  const fixedRows = [
    { label: 'Alert Type', value: alert.type || '—', mono: false, full: alert.type, tag: sevClass },
    { label: 'Node ID', value: alert.nodeId || '—', mono: true, full: alert.nodeId },
    { label: 'Transaction Hash', value: shortHash(alert.txHash, 10, 6), mono: true, full: alert.txHash },
    { label: 'Detected At', value: formatUTC(alert.detectedAt), mono: true, full: alert.detectedAt },
    { label: 'Severity', value: sevLabel, mono: false, full: null, sevClass },
  ];

  // ── Dynamic detail rows from alert.details ───────────
  const detailRows = [];
  if (alert.details && typeof alert.details === 'object') {
    for (const [k, v] of Object.entries(alert.details)) {
      if (v == null) continue;
      detailRows.push({ label: humanizeKey(k), value: String(v), mono: true, full: String(v) });
    }
  }

  const allRows = [...fixedRows, ...detailRows];

  const rowsHtml = allRows.map(r => {
    let valueHtml;
    if (r.tag) {
      // Alert type — small colored tag
      valueHtml = `<span class="vp-type-tag ${r.tag}">${escHTML(r.value)}</span>`;
    } else if (r.sevClass) {
      // Severity — pill badge
      valueHtml = `<span class="vp-sev-pill ${sevClass}"><span class="lm-pill-dot ${sevClass}"></span>${escHTML(r.value)}</span>`;
    } else {
      valueHtml = `<span class="${r.mono ? 'mono vp-mono-val' : 'vp-plain-val'}" title="${escAttr(r.full || '')}">${escHTML(r.value)}</span>`;
    }
    const copyBtn = r.full
      ? `<button class="vp-copy-btn" data-copy="${escAttr(r.full)}" aria-label="Copy ${r.label}">${copySvg()}</button>`
      : '';
    return `
      <div class="vp-row">
        <span class="vp-row-label">${escHTML(r.label)}</span>
        ${valueHtml}
        <span class="vp-row-copy">${copyBtn}</span>
      </div>`;
  }).join('');

  const explorerBtn = alert.explorerTxUrl
    ? `<a class="vp-explorer-btn" href="${escAttr(alert.explorerTxUrl)}" target="_blank" rel="noopener">
         View on Block Explorer
         <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
           <path d="M3 10L10 3M7 3H10V6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
         </svg>
       </a>`
    : '';

  const reportHtml = renderReport(alert.report);

  container.innerHTML = `
    <div class="vp-panels">

      <!-- LEFT: On-Chain Verification -->
      <div class="vp-left-panel">
        <div class="vp-panel-header">
          <div class="vp-panel-icon vp-icon-purple">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 1.5L1.5 4.5V9C1.5 13 5 16.5 9 17.5C13 16.5 16.5 13 16.5 9V4.5L9 1.5Z"
                    stroke="url(#nav-grad)" stroke-width="1.4" stroke-linejoin="round"/>
              <path d="M6 9L8 11L12 7" stroke="url(#nav-grad)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="vp-panel-title">On-Chain Verification</span>
        </div>
        <div class="vp-rows" id="vp-rows">${rowsHtml}</div>
        ${explorerBtn}
      </div>

      <!-- RIGHT: AI Security Analysis -->
      <div class="vp-right-panel">
        <div class="vp-panel-header">
          <div class="vp-panel-icon vp-icon-spark">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 1.5L10.5 7.5H16.5L11.5 11L13.5 17L9 13.5L4.5 17L6.5 11L1.5 7.5H7.5L9 1.5Z"
                    stroke="url(#nav-grad)" stroke-width="1.3" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="vp-panel-title">AI Security Analysis</span>
          <span class="vp-gemini-tag">&#10022; Generated by Gemini</span>
        </div>
        <div class="vp-report-body">${reportHtml}</div>
        <div class="vp-status-row">
          <span class="vp-status-label">Verification Status</span>
          <span class="vp-verified-badge">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="6.5" cy="6.5" r="5.5" fill="rgba(16,185,129,0.2)" stroke="#10B981" stroke-width="1"/>
              <path d="M4 6.5L6 8.5L9.5 5" stroke="#10B981" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Verified On-Chain
          </span>
        </div>
      </div>

    </div>
  `;

  // Wire copy buttons
  container.querySelectorAll('.vp-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.copy).then(() => {
        btn.classList.add('copied'); btn.innerHTML = checkSvg();
        setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = copySvg(); }, 1800);
      });
    });
  });
}

// ─── Notification button ───────────────────────────────
document.getElementById('notif-btn').addEventListener('click', function () {
  const badge = document.getElementById('notif-badge');
  if (badge) {
    badge.style.transform = 'scale(0)';
    badge.style.transition = 'transform 180ms ease';
    setTimeout(() => badge.remove(), 200);
  }
});

// ─── Sidebar footer: fetch real agent address ─────────
async function fetchIdentity() {
  const addrEl = document.getElementById('operator-address');
  const shortEl = addrEl ? addrEl.querySelector('.footer-addr') : null;
  try {
    const res = await fetch(`${API_BASE_URL}/api/identity`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const full = data.agentAddress || '';
    if (!full) throw new Error('agentAddress missing');
    const short = full.length > 11 ? `${full.slice(0, 6)}…${full.slice(-5)}` : full;
    if (shortEl) shortEl.textContent = short;
    if (addrEl) addrEl.title = `Operator: ${full}`;
  } catch (err) {
    console.warn('[SentryNet] Could not fetch identity:', err.message);
    if (shortEl) shortEl.textContent = '——';
  }
}

// ─── Boot ─────────────────────────────────────────────
(function boot() {
  const hash = location.hash.replace('#', '');
  const initial = PAGES[hash] ? hash : 'overview';
  navigateTo(initial);
  fetchIdentity();
})();
