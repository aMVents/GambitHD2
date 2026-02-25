// ============================================================
// GAMBIT HD2 — Application Logic & Rendering
// ============================================================

// ---- State -------------------------------------------------

const state = {
  planetMap: {},            // index (number) → planet name (string)
  liberationCampaigns: [],
  defenseCampaigns: [],
  allPlanets: [],           // full planet list — used by Strategic Scout
  timerInterval: null,
  lastUpdated: null,
};

// ---- Utilities ---------------------------------------------

/** Format a number with locale-appropriate thousands separators. */
function fmt(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString();
}

/** Format milliseconds remaining as HH:MM:SS. */
function fmtCountdown(endTimeStr) {
  const diff = new Date(endTimeStr).getTime() - Date.now();
  if (diff <= 0) return 'EXPIRED';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Human-readable "X mins ago" from a Date object. */
function timeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/** Returns a CSS class key for a faction string. */
function factionCls(faction) {
  if (!faction) return '';
  const f = faction.toLowerCase();
  if (f.includes('terminid')) return 'terminid';
  if (f.includes('automaton')) return 'automaton';
  if (f.includes('illuminate')) return 'illuminate';
  return 'human';
}

/** Returns an uppercase display label for a faction string. */
function factionLabel(faction) {
  if (!faction) return 'UNKNOWN';
  const f = faction.toLowerCase();
  if (f.includes('terminid')) return 'TERMINIDS';
  if (f.includes('automaton')) return 'AUTOMATONS';
  if (f.includes('illuminate')) return 'ILLUMINATE';
  if (f.includes('human')) return 'SUPER EARTH';
  return faction.toUpperCase();
}

/**
 * Liberation % for a planet.
 * Enemy holds HP — reducing to 0 = liberated.
 * liberationPct = (1 - health / maxHealth) * 100
 */
function libPct(planet) {
  if (!planet.maxHealth) return 0;
  return Math.max(0, Math.min(100, (1 - planet.health / planet.maxHealth) * 100));
}

/**
 * Defense success % for a planet event.
 * defPct = (1 - event.health / event.maxHealth) * 100
 */
function defPct(event) {
  if (!event || !event.maxHealth) return 0;
  return Math.max(0, Math.min(100, (1 - event.health / event.maxHealth) * 100));
}

/**
 * Hourly decay rate in percent for a liberation campaign.
 * decayPctPerHr = (regenPerSecond * 3600 / maxHealth) * 100
 */
function decayRate(planet) {
  if (!planet.regenPerSecond || !planet.maxHealth) return 0;
  return (planet.regenPerSecond * 3600 / planet.maxHealth) * 100;
}

/** Hours remaining until a defense event expires. */
function hoursLeft(endTimeStr) {
  return (new Date(endTimeStr).getTime() - Date.now()) / 3_600_000;
}

// ---- Render: Header ----------------------------------------

function renderHeader(war) {
  const statsEl = document.getElementById('war-stats');
  if (!statsEl) return;

  const players = war?.statistics?.playerCount;
  const impact = war?.impactMultiplier;
  const factions = (war?.factions ?? [])
    .filter(f => !f.toLowerCase().includes('human'))
    .map(f => factionLabel(f));

  statsEl.innerHTML = `
    <div class="stat-item">
      <div class="stat-label">HELLDIVERS DEPLOYED</div>
      <div class="stat-value gold">${fmt(players)}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">IMPACT MULTIPLIER</div>
      <div class="stat-value">${impact != null ? impact.toFixed(4) + '×' : '—'}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">ACTIVE FRONTS</div>
      <div class="stat-value">${factions.length ? factions.join(' · ') : '—'}</div>
    </div>
  `;
}

// ---- Render: Major Orders ----------------------------------

function renderOrders(assignments) {
  const container = document.getElementById('orders-container');
  const countEl = document.getElementById('orders-count');
  if (!container) return;

  countEl.textContent = assignments.length;

  if (!assignments.length) {
    container.innerHTML = '<div class="empty-state">NO ACTIVE MAJOR ORDERS</div>';
    return;
  }

  container.innerHTML = assignments.map(order => {
    const text = order.briefing || order.description || 'Stand by for further orders.';
    const reward = order.reward;
    const expiry = order.expiration ? new Date(order.expiration) : null;

    return `
      <div class="order-card">
        <div class="order-title">${order.title ?? 'CLASSIFIED OPERATION'}</div>
        <div class="order-briefing">${text}</div>
        <div class="order-meta">
          ${reward ? `<span class="order-reward">REWARD: <span class="reward-val">${fmt(reward.amount)} ${reward.type ?? 'MEDALS'}</span></span>` : ''}
          ${expiry ? `<span class="order-expiry">EXPIRES: ${expiry.toLocaleString()}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ---- Render: Planet Card -----------------------------------

function renderPlanetCard(campaign, mode) {
  const planet = campaign.planet;
  const event = planet.event;

  // For defense, the attacker faction is on the event; for liberation, the current owner is the enemy.
  const enemyFaction = mode === 'defense'
    ? (event?.faction ?? campaign.faction)
    : (planet.currentOwner ?? campaign.faction);

  const fCls = factionCls(enemyFaction);
  const fLabel = factionLabel(enemyFaction);

  const players = planet.statistics?.playerCount ?? 0;
  const decay = decayRate(planet);

  // Resolve waypoint indices to planet names
  const waypoints = (planet.waypoints ?? [])
    .map(idx => state.planetMap[idx])
    .filter(Boolean);

  // Planets this one is currently pushing toward
  const attacking = (planet.attacking ?? [])
    .map(idx => state.planetMap[idx])
    .filter(Boolean);

  // ---- Progress bar ----
  let progressHtml = '';
  if (mode === 'liberation') {
    const pct = libPct(planet);
    progressHtml = `
      <div class="progress-section">
        <div class="progress-header">
          <span class="progress-label">LIBERATION PROGRESS</span>
          <span class="progress-value">${pct.toFixed(1)}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill lib" style="width:${pct}%" data-pct="${pct}"></div>
        </div>
      </div>`;
  } else {
    const pct = defPct(event);
    progressHtml = `
      <div class="progress-section">
        <div class="progress-header">
          <span class="progress-label">DEFENSE INTEGRITY</span>
          <span class="progress-value">${pct.toFixed(1)}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill def" style="width:${pct}%" data-pct="${pct}"></div>
        </div>
      </div>`;
  }

  // ---- Timer (defense only) ----
  let timerHtml = '';
  if (mode === 'defense' && event?.endTime) {
    const remaining = fmtCountdown(event.endTime);
    const hrs = hoursLeft(event.endTime);
    const urgentCls = hrs < 6 ? (hrs < 1 ? 'critical' : 'urgent') : '';
    timerHtml = `
      <div class="defense-timer ${urgentCls}">
        <span class="timer-label">TIME REMAINING</span>
        <span class="timer-value ${urgentCls}" data-end="${event.endTime}">${remaining}</span>
      </div>`;
  }

  // ---- Stats row ----
  const statsHtml = `
    <div class="stats-row">
      <div class="stat-chip">
        <span class="chip-icon">&#128101;</span>
        <span class="chip-val">${fmt(players)}</span>
        <span class="chip-unit">HELLDIVERS</span>
      </div>
      ${mode === 'liberation' ? `
        <div class="stat-chip">
          <span class="chip-icon">&#8595;</span>
          <span class="chip-val negative">−${decay.toFixed(2)}%/hr</span>
          <span class="chip-unit">DECAY</span>
        </div>` : ''}
    </div>`;

  // ---- Supply lines ----
  let supplyHtml = '';
  if (waypoints.length) {
    supplyHtml += `
      <div class="supply-lines">
        <span class="supply-label">SUPPLY LINES</span>
        ${waypoints.map(n => `<span class="planet-tag">${n}</span>`).join('')}
      </div>`;
  }
  if (attacking.length) {
    supplyHtml += `
      <div class="supply-lines attacking">
        <span class="supply-label">PUSHING &#8594;</span>
        ${attacking.map(n => `<span class="planet-tag attack">${n}</span>`).join('')}
      </div>`;
  }

  return `
    <div class="planet-card ${fCls}" data-planet-index="${planet.index}" data-mode="${mode}">
      <div class="planet-header">
        <div class="planet-name-block">
          <div class="planet-name">${planet.name ?? `PLANET ${planet.index}`}</div>
          <div class="planet-sector">${planet.sector ?? '—'}</div>
        </div>
        <div class="planet-badges">
          <div class="faction-badge ${fCls}">${fLabel}</div>
          <div class="mode-badge ${mode}">${mode === 'liberation' ? 'LIBERATE' : 'DEFEND'}</div>
        </div>
      </div>
      ${progressHtml}
      ${statsHtml}
      ${timerHtml}
      ${supplyHtml}
    </div>`;
}

// ---- Render: Campaigns -------------------------------------

function renderLiberation(campaigns) {
  const container = document.getElementById('liberation-container');
  const countEl = document.getElementById('liberation-count');
  if (!container) return;

  // Sort by player count descending (most active front first)
  const sorted = [...campaigns].sort(
    (a, b) => (b.planet.statistics?.playerCount ?? 0) - (a.planet.statistics?.playerCount ?? 0)
  );

  countEl.textContent = sorted.length;

  if (!sorted.length) {
    container.innerHTML = '<div class="empty-state">NO ACTIVE LIBERATION CAMPAIGNS</div>';
    return;
  }

  container.innerHTML = sorted.map(c => renderPlanetCard(c, 'liberation')).join('');
}

function renderDefense(campaigns) {
  const container = document.getElementById('defense-container');
  const countEl = document.getElementById('defense-count');
  if (!container) return;

  // Sort by time remaining ascending (most urgent first)
  const sorted = [...campaigns].sort((a, b) => {
    const ta = a.planet.event?.endTime ? new Date(a.planet.event.endTime).getTime() : Infinity;
    const tb = b.planet.event?.endTime ? new Date(b.planet.event.endTime).getTime() : Infinity;
    return ta - tb;
  });

  countEl.textContent = sorted.length;

  if (!sorted.length) {
    container.innerHTML = '<div class="empty-state">NO ACTIVE DEFENSE CAMPAIGNS</div>';
    return;
  }

  container.innerHTML = sorted.map(c => renderPlanetCard(c, 'defense')).join('');
}

// ---- Timers ------------------------------------------------

/** Update all visible countdown timers without re-rendering the whole DOM. */
function tickTimers() {
  document.querySelectorAll('[data-end]').forEach(el => {
    const endTime = el.getAttribute('data-end');
    el.textContent = fmtCountdown(endTime);

    const hrs = hoursLeft(endTime);
    el.className = 'timer-value' + (hrs < 1 ? ' critical' : hrs < 6 ? ' urgent' : '');
  });
}

function startTimerTick() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(tickTimers, 1000);
}

// ---- Last Updated ------------------------------------------

function updateLastUpdated() {
  const el = document.getElementById('last-updated');
  if (!el) return;
  if (!state.lastUpdated) {
    el.textContent = 'CONNECTING...';
    return;
  }
  el.innerHTML = `<span class="live-dot"></span>&nbsp;UPDATED ${timeAgo(state.lastUpdated)}`;
}

// ---- Main --------------------------------------------------

/**
 * Process raw API data and render all sections.
 */
function render(data) {
  const { war, campaigns, assignments, planets } = data;

  // Build planet name lookup map and store full list for Scout tab
  state.planetMap = {};
  state.allPlanets = planets ?? [];
  (planets ?? []).forEach(p => {
    if (p.index != null) state.planetMap[p.index] = p.name ?? `#${p.index}`;
  });

  // Separate campaigns by type: defense = has planet.event, liberation = no event
  state.liberationCampaigns = (campaigns ?? []).filter(c => !c.planet?.event);
  state.defenseCampaigns = (campaigns ?? []).filter(c => !!c.planet?.event);

  // Render all sections
  renderHeader(war);
  renderOrders(assignments ?? []);
  renderLiberation(state.liberationCampaigns);
  renderDefense(state.defenseCampaigns);

  // Phase 2: Record snapshot for rate measurement, then run gambit analysis.
  // gambit.js is loaded after app.js, but by the time fetchAll() resolves
  // these functions are always available.
  if (typeof recordSnapshot === 'function') {
    recordSnapshot(planets);
  }
  if (typeof detectGambits === 'function' && typeof renderGambits === 'function') {
    const gambits = detectGambits(state.liberationCampaigns, state.defenseCampaigns, war);
    renderGambits(gambits);
  }

  // Phase 3: Strategic Scout tab
  if (typeof renderScout === 'function') {
    renderScout();
  }

  // Track timing
  state.lastUpdated = new Date();
  updateLastUpdated();
  startTimerTick();
}

/**
 * Full data refresh. Shows/hides loading and error states as needed.
 */
async function refresh() {
  const btn = document.getElementById('refresh-btn');
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error-screen');
  const contentEl = document.getElementById('content');

  // Spin the refresh icon without hiding content on subsequent loads
  if (btn) btn.setAttribute('data-loading', 'true');

  try {
    const data = await fetchAll();

    // First successful load: reveal content
    if (loadingEl) loadingEl.style.display = 'none';
    if (errorEl) errorEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');

    render(data);
  } catch (err) {
    console.error('[GAMBIT] Uplink failure:', err);

    // Only show full error screen if content was never rendered
    const hasContent = contentEl && !contentEl.classList.contains('hidden');
    if (!hasContent) {
      if (loadingEl) loadingEl.style.display = 'none';
      if (errorEl) {
        errorEl.classList.remove('hidden');
        const msgEl = document.getElementById('error-msg');
        if (msgEl) msgEl.textContent = err.message ?? 'UPLINK FAILED';
      }
    }
    // If we already have content, silently fail and show a stale-data indicator
    updateLastUpdated();
  } finally {
    if (btn) btn.removeAttribute('data-loading');
  }
}

// ---- Init --------------------------------------------------

// Expose refresh globally so inline onclick handlers work
window.refresh = refresh;

// ---- Tab Switching -----------------------------------------

/**
 * Switch between the Gambit Analysis and Strategic Scout tabs.
 * Called by the tab buttons' onclick handlers in index.html.
 */
function switchTab(tabName) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tabName}`)?.classList.remove('hidden');
  document.querySelector(`.tab-btn[data-tab="${tabName}"]`)?.classList.add('active');
}

window.switchTab = switchTab;

// Initial load
refresh();

// Auto-refresh every 60 seconds
setInterval(refresh, 60_000);

// Update "X seconds ago" label every 15 seconds
setInterval(updateLastUpdated, 15_000);
