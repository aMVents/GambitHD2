// ============================================================
// GAMBIT HD2 — Strategic Scout
//
// Identifies enemy-held planets with supply-line connections
// to active defense campaigns that have NO active liberation
// campaign yet. These are "untapped attack vectors" — starting
// a liberation on any of these planets would directly support
// the connected defense.
//
// Depends on globals from app.js: state, factionCls,
// factionLabel, fmtCountdown, hoursLeft, defPct, fmt
// ============================================================

// ---- Detection ---------------------------------------------

/**
 * For each active defense campaign, find enemy-held planets that
 * are connected via supply lines but have no active campaign yet.
 *
 * @param {Array} defenseCampaigns
 * @param {Array} liberationCampaigns
 * @param {Array} allPlanets          - full /api/v1/planets response
 * @returns {Array} results — [{ defenseCampaign, targets[] }]
 */
function detectScoutTargets(defenseCampaigns, liberationCampaigns, allPlanets) {
  // Planet indices already being actively fought over
  const activePlanetIndices = new Set([
    ...liberationCampaigns.map(c => c.planet.index),
    ...defenseCampaigns.map(c => c.planet.index),
  ]);

  // Full planet lookup by index
  const planetByIndex = {};
  allPlanets.forEach(p => {
    if (p.index != null) planetByIndex[p.index] = p;
  });

  const results = [];

  for (const dc of defenseCampaigns) {
    const defPlanet = dc.planet;

    // Collect all planet indices connected via supply lines (bidirectional)
    const connectedIndices = new Set([
      ...(defPlanet.waypoints ?? []),
      // Also include planets that list this defense planet in their own waypoints
      ...allPlanets
        .filter(p => (p.waypoints ?? []).includes(defPlanet.index))
        .map(p => p.index),
    ]);

    // Filter to enemy-held planets not already in any active campaign
    const targets = [];
    for (const idx of connectedIndices) {
      if (activePlanetIndices.has(idx)) continue;

      const planet = planetByIndex[idx];
      if (!planet) continue;

      const owner = (planet.currentOwner ?? '').toLowerCase();
      // Skip planets we already own or with no ownership data
      if (!owner || owner.includes('human')) continue;

      const decayPctHr = planet.maxHealth
        ? (planet.regenPerSecond * 3600 / planet.maxHealth) * 100
        : null;

      targets.push({ planet, decayPctHr });
    }

    // Sort: easiest to liberate first (lowest enemy regen rate)
    targets.sort((a, b) => (a.decayPctHr ?? Infinity) - (b.decayPctHr ?? Infinity));

    if (targets.length > 0) {
      results.push({ defenseCampaign: dc, targets });
    }
  }

  // Sort results by defense urgency: least time remaining first
  results.sort((a, b) => {
    const ta = a.defenseCampaign.planet.event?.endTime
      ? new Date(a.defenseCampaign.planet.event.endTime).getTime()
      : Infinity;
    const tb = b.defenseCampaign.planet.event?.endTime
      ? new Date(b.defenseCampaign.planet.event.endTime).getTime()
      : Infinity;
    return ta - tb;
  });

  return results;
}

// ---- Rendering ---------------------------------------------

/** Render a single scout recon card for one defense campaign. */
function renderScoutCard(result) {
  const dc        = result.defenseCampaign;
  const defPlanet = dc.planet;
  const event     = defPlanet.event;

  const defFCls   = factionCls(event?.faction ?? dc.faction ?? '');
  const defFLabel = factionLabel(event?.faction ?? dc.faction ?? '');

  const hrs     = event?.endTime ? hoursLeft(event.endTime) : Infinity;
  const urgCls  = hrs < 1 ? 'critical' : hrs < 6 ? 'urgent' : '';
  const timerVal = event?.endTime ? fmtCountdown(event.endTime) : '—';
  const defPct_ = defPct(event);

  // Target planet rows
  const targetsHtml = result.targets.map(({ planet, decayPctHr }) => {
    const fCls   = factionCls(planet.currentOwner ?? '');
    const fLabel = factionLabel(planet.currentOwner ?? '');
    const decay  = decayPctHr != null ? decayPctHr.toFixed(2) : '?';
    const sector = planet.sector ? `${planet.sector}  ·  ` : '';

    return `
      <div class="scout-target">
        <div class="scout-target-header">
          <div class="scout-target-name">${planet.name ?? `PLANET #${planet.index}`}</div>
          <span class="faction-badge ${fCls}">${fLabel}</span>
        </div>
        <div class="scout-target-meta">
          <span class="scout-meta-item">${sector}Enemy regen: <strong>${decay}%/hr</strong></span>
          <span class="scout-cta">▶ START LIBERATION HERE TO SUPPORT THIS DEFENSE</span>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="scout-card ${urgCls}">

      <!-- Defense being supported -->
      <div class="scout-card-header">
        <div class="scout-defense-info">
          <div class="scout-label">◈ SUPPORT THIS DEFENSE</div>
          <div class="scout-defense-name">${defPlanet.name ?? `PLANET #${defPlanet.index}`}</div>
          <div class="scout-defense-meta">
            <span class="faction-badge ${defFCls}">${defFLabel}</span>
            ${defPlanet.sector ? `<span class="scout-sector">${defPlanet.sector}</span>` : ''}
          </div>
        </div>
        <div class="scout-timer-block">
          <div class="scout-timer-label">TIME REMAINING</div>
          <div class="timer-value ${urgCls}" data-end="${event?.endTime ?? ''}">${timerVal}</div>
          <div class="scout-def-pct">${defPct_.toFixed(1)}% integrity</div>
        </div>
      </div>

      <!-- Untapped attack vectors -->
      <div class="scout-targets-section">
        <div class="gambit-section-label scout-vectors-label">
          UNTAPPED ATTACK VECTORS — liberating any of these planets will cut off the enemy's supply lines to this defense
        </div>
        ${targetsHtml}
      </div>

    </div>`;
}

/**
 * Render Strategic Scout tab content into #scout-container.
 * Reads from state — called after every data refresh.
 */
function renderScout() {
  const container = document.getElementById('scout-container');
  const countEl   = document.getElementById('scout-count');
  if (!container) return;

  const results = detectScoutTargets(
    state.defenseCampaigns,
    state.liberationCampaigns,
    state.allPlanets,
  );

  const totalTargets = results.reduce((n, r) => n + r.targets.length, 0);
  if (countEl) countEl.textContent = totalTargets;

  if (!results.length) {
    container.innerHTML = `
      <div class="empty-state">
        NO UNTAPPED ATTACK VECTORS DETECTED
        <span>All supply-line connected planets are already under active campaign — check the Gambit Analysis tab for current opportunities.</span>
      </div>`;
    return;
  }

  container.innerHTML = results.map(renderScoutCard).join('');
}
