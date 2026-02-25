// ============================================================
// GAMBIT HD2 — Phase 2: Strategic Analysis Engine
//
// A "Gambit" is the strategic choice to redirect Helldiver
// forces from defending a planet to aggressively liberating a
// key planet — accepting the risk of losing the defense in
// exchange for a decisive strategic gain.
//
// This module detects viable gambit opportunities from active
// campaigns, scores them by success probability, and surfaces
// the key conditions and requirements players need to know.
// ============================================================

// ---- Snapshot Store ----------------------------------------
// We keep the last few API snapshots to measure actual
// liberation rate deltas (far more accurate than estimates).

const snapshots = [];

/**
 * Record a planet data snapshot. Call after every successful
 * API refresh so rate deltas can be computed.
 *
 * @param {Array} planets - full planet array from API
 */
function recordSnapshot(planets) {
  const entry = {
    ts:      Date.now(),
    health:  {},   // planetIndex → current health
    players: {},   // planetIndex → playerCount
  };
  (planets ?? []).forEach(p => {
    entry.health[p.index]  = p.health;
    entry.players[p.index] = p.statistics?.playerCount ?? 0;
  });
  snapshots.push(entry);
  if (snapshots.length > 6) snapshots.shift();
}

// ---- Rate Calculation --------------------------------------

/**
 * Compute the measured net liberation rate (%/hr) for a planet
 * using the two most recent snapshots.
 *
 * Positive  = players are making progress (liberating faster than decay)
 * Negative  = enemy is winning (decay outpacing player effort)
 * null      = insufficient snapshot data
 */
function measuredNetRate(planetIndex, maxHealth) {
  if (snapshots.length < 2) return null;

  const latest = snapshots[snapshots.length - 1];
  const prev   = snapshots[snapshots.length - 2];

  const latestHealth = latest.health[planetIndex];
  const prevHealth   = prev.health[planetIndex];
  if (latestHealth == null || prevHealth == null) return null;

  const deltaHours = (latest.ts - prev.ts) / 3_600_000;
  if (deltaHours < 0.002) return null; // snapshots too close together

  // Health decreased → positive liberation progress
  const deltaHealth = prevHealth - latestHealth;
  return (deltaHealth / maxHealth) * 100 / deltaHours;
}

/**
 * Estimate net liberation rate when snapshot data is unavailable.
 * Uses decay rate vs. a community-calibrated player-rate formula.
 *
 * NOTE: This is rough — accuracy improves dramatically after the
 * first refresh populates two snapshots.
 *
 * @returns {{ value: number, estimated: true }}
 */
function estimatedNetRate(planet) {
  const decayPctHr = (planet.regenPerSecond * 3600 / planet.maxHealth) * 100;
  const players    = planet.statistics?.playerCount ?? 0;

  // Empirical estimate based on observed community data:
  //   ~1%/hr liberation per 10,000 Helldivers deployed on a standard planet.
  // NOTE: impactMultiplier is NOT used here — the API value is often < 0.001
  // which makes any formula using it produce unrealistically low player rates.
  // Snapshot-based measurement (after first refresh) replaces this estimate.
  const playerRatePctHr = (players / 10_000) * 1.0;
  return { value: playerRatePctHr - decayPctHr, estimated: true };
}

/**
 * Calculate minimum and recommended player counts.
 *
 * min         = breakeven (enough to exactly offset decay)
 * recommended = enough to reach 100% within ~24h
 *
 * @returns {{ min, recommended, estimated? } | null}
 */
function calcPlayerRequirements(planet, netRateObj, impactMultiplier) {
  const decayPctHr   = (planet.regenPerSecond * 3600 / planet.maxHealth) * 100;
  const currentPlayers = planet.statistics?.playerCount ?? 0;

  if (snapshots.length >= 2 && !netRateObj.estimated) {
    // Use measured per-player rate for accurate projections
    const latest = snapshots[snapshots.length - 1];
    const playerCount = (latest.players[planet.index] ?? currentPlayers);
    if (playerCount < 10) return null;

    const measured = netRateObj.value;
    if (measured == null) return null;

    // Gross player liberation rate = net rate + decay rate
    const grossPlayerPctHr = measured + decayPctHr;
    if (grossPlayerPctHr <= 0) return null;

    const ratePerPlayer = grossPlayerPctHr / playerCount;
    if (ratePerPlayer <= 0) return null;

    const min         = Math.max(1, Math.ceil(decayPctHr / ratePerPlayer));
    const remaining   = 100 - libPct(planet);
    const recommended = Math.max(min * 2, Math.ceil((decayPctHr + remaining * (1 / 24)) / ratePerPlayer));
    return { min, recommended };
  }

  // Fallback estimate
  const imp = impactMultiplier ?? 0.005;
  if (imp <= 0) return null;
  const min = Math.ceil(decayPctHr / (imp * 0.25));
  return { min, recommended: min * 3, estimated: true };
}

// ---- Conditions Checklist ----------------------------------

/**
 * Evaluate the specific conditions that determine gambit viability.
 * Each condition object: { label, detail, pass: bool }
 */
function buildConditions(libCampaign, netRateObj, timeToComplete, connectedDefenses, playerReqs) {
  const planet  = libCampaign.planet;
  const libPct_ = libPct(planet);
  const players = planet.statistics?.playerCount ?? 0;
  const rate    = netRateObj.value;

  const conds = [];

  // 1. Liberation progress — has meaningful work already been done?
  {
    const pass = libPct_ >= 25;
    const status = libPct_ >= 60 ? 'STRONG' : libPct_ >= 25 ? 'ADEQUATE' : 'LOW';
    conds.push({
      label:  'Liberation progress ≥ 25%',
      detail: `${libPct_.toFixed(1)}% — ${status}`,
      pass,
    });
  }

  // 2. Net liberation rate is positive — players outpacing decay?
  {
    const pass = rate != null && rate > 0;
    let detail;
    if (rate == null) {
      detail = 'Insufficient data — refresh again';
    } else {
      const label = rate > 3 ? 'STRONG' : rate > 0 ? 'MARGINAL' : rate > -2 ? 'LOSING' : 'CRITICAL';
      detail = `${rate >= 0 ? '+' : ''}${rate.toFixed(2)}%/hr${netRateObj.estimated ? '*' : ''} — ${label}`;
    }
    conds.push({ label: 'Net rate positive (liberating > decay)', detail, pass });
  }

  // 3. Can we actually finish within a reasonable timeframe?
  {
    const pass = timeToComplete != null && isFinite(timeToComplete) && timeToComplete <= 48;
    let detail;
    if (timeToComplete == null || !isFinite(timeToComplete)) {
      detail = rate != null && rate <= 0 ? 'IMPOSSIBLE — rate must turn positive' : 'UNKNOWN — rate data needed';
    } else {
      const speed = timeToComplete < 6 ? 'VERY FAST' : timeToComplete < 12 ? 'FAST' : timeToComplete < 24 ? 'FEASIBLE' : 'SLOW';
      detail = `~${timeToComplete.toFixed(1)}h to completion — ${speed}`;
    }
    conds.push({ label: 'Liberation completable within 48h', detail, pass });
  }

  // 4. Supply-line defense timing — do we finish before we lose the defense?
  if (connectedDefenses.length > 0) {
    const defHours = connectedDefenses.map(dc =>
      dc.planet.event?.endTime ? hoursLeft(dc.planet.event.endTime) : Infinity
    );
    const minDefHr = Math.min(...defHours);
    const pass = timeToComplete != null && isFinite(timeToComplete) && timeToComplete < minDefHr;
    let detail;
    if (timeToComplete == null || !isFinite(timeToComplete)) {
      detail = `Defense expires in ${minDefHr.toFixed(1)}h — ETA unknown`;
    } else {
      const buffer = minDefHr - timeToComplete;
      detail = `${timeToComplete.toFixed(1)}h ETA vs ${minDefHr.toFixed(1)}h defense remaining`
        + (pass ? ` (+${buffer.toFixed(1)}h buffer)` : ' — TOO SLOW');
    }
    conds.push({ label: 'ETA beats defense expiry', detail, pass });
  }

  // 5. Player count at or above minimum breakeven
  if (playerReqs) {
    const pass = players >= playerReqs.min;
    const status = players >= playerReqs.recommended ? 'SUFFICIENT'
      : players >= playerReqs.min ? 'ADEQUATE'
      : 'INSUFFICIENT';
    conds.push({
      label:  `Players ≥ minimum (${playerReqs.min.toLocaleString()})`,
      detail: `${players.toLocaleString()} deployed — ${status}${playerReqs.estimated ? '*' : ''}`,
      pass,
    });
  }

  return conds;
}

// ---- Success Scoring ---------------------------------------

/**
 * Calculate overall gambit success probability as a 0–100 integer.
 *
 * Scoring components:
 *   Liberation progress  0–25 pts   (higher % = more invested)
 *   Net rate             0–30 pts   (speed of progress)
 *   Time viability       0–25 pts   (ETA vs. defense timer / raw speed)
 *   Condition pass rate  0–20 pts   (how many green checks)
 */
function calcSuccessPct(libPct_, netRate, timeToComplete, connectedDefenses, conditions) {
  let score = 0;

  // Liberation progress component
  score += (Math.min(libPct_, 100) / 100) * 25;

  // Net rate component
  if (netRate != null) {
    if (netRate > 0) {
      score += Math.min(netRate / 5, 1) * 30;      // cap at 5%/hr for max points
    } else {
      score += Math.max(netRate / 5, -1) * 10;     // penalty, floor at -10
    }
  }

  // Time viability component
  if (timeToComplete != null && isFinite(timeToComplete)) {
    if (connectedDefenses.length > 0) {
      const minDefHr = Math.min(...connectedDefenses.map(dc =>
        dc.planet.event?.endTime ? hoursLeft(dc.planet.event.endTime) : Infinity
      ));
      if (timeToComplete < minDefHr) {
        const buffer = minDefHr - timeToComplete;
        score += Math.min(buffer / 12, 1) * 25;   // 12h buffer = max points
      } else {
        score -= 15;                                // ETA exceeds defense timer
      }
    } else {
      // No defense at risk — reward faster completion
      score += Math.max(0, 1 - timeToComplete / 48) * 25;
    }
  }

  // Condition pass rate component
  if (conditions.length > 0) {
    const passRatio = conditions.filter(c => c.pass).length / conditions.length;
    score += passRatio * 20;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Map a success score to a risk-level display object. */
function toRiskLevel(pct) {
  if (pct >= 85) return { label: 'OPTIMAL',   cls: 'optimal'   };
  if (pct >= 70) return { label: 'FAVORABLE', cls: 'favorable' };
  if (pct >= 55) return { label: 'VIABLE',    cls: 'viable'    };
  if (pct >= 35) return { label: 'RISKY',     cls: 'risky'     };
  return               { label: 'CRITICAL',  cls: 'critical'  };
}

// ---- Detection ---------------------------------------------

/**
 * Main entry point. Analyses all active liberation campaigns
 * and returns an array of gambit objects sorted by success
 * probability (descending).
 *
 * @param {Array}  liberationCampaigns
 * @param {Array}  defenseCampaigns
 * @param {Object} war  - top-level war object (for impactMultiplier)
 * @returns {Array} gambits
 */
function detectGambits(liberationCampaigns, defenseCampaigns, war) {
  const imp     = war?.impactMultiplier ?? 0.005;
  const gambits = [];

  for (const libCampaign of liberationCampaigns) {
    const planet  = libCampaign.planet;
    const libPct_ = libPct(planet);

    // Include any planet that's actively being pushed — even 0.0% counts
    // if it's on a supply line connected to a defense campaign (classic gambit).
    if (libPct_ < 0 && connected.length === 0) continue;

    // Find defense campaigns connected via supply lines
    const connected = defenseCampaigns.filter(dc => {
      const dp = dc.planet;
      return (planet.waypoints ?? []).includes(dp.index) ||
             (dp.waypoints   ?? []).includes(planet.index);
    });

    // Determine net liberation rate (measured if available, else estimated)
    const measured = measuredNetRate(planet.index, planet.maxHealth);
    const netRateObj = measured != null
      ? { value: measured, estimated: false }
      : estimatedNetRate(planet);

    const netRate = netRateObj.value;

    // Estimate time to complete liberation (hours)
    const remaining     = 100 - libPct_;
    const timeToComplete = netRate > 0 ? remaining / netRate : null;

    // Player requirements
    const players    = planet.statistics?.playerCount ?? 0;
    const playerReqs = calcPlayerRequirements(planet, netRateObj, imp);

    // Conditions checklist
    const conditions = buildConditions(libCampaign, netRateObj, timeToComplete, connected, playerReqs);

    // Overall success score
    const successPct = calcSuccessPct(libPct_, netRate, timeToComplete, connected, conditions);

    gambits.push({
      libCampaign,
      connectedDefenses: connected,
      libPct:            libPct_,
      netRateObj,
      netRate,
      timeToComplete,
      players,
      playerReqs,
      conditions,
      successPct,
      risk: toRiskLevel(successPct),
    });
  }

  return gambits.sort((a, b) => b.successPct - a.successPct);
}

// ---- Rendering ---------------------------------------------

/**
 * Return a deployment recommendation based on gambit success probability.
 * This is the bottom-line answer shown prominently on every card.
 */
function getRecommendation(successPct, planetName) {
  if (successPct >= 85) return {
    cls:      'deploy-now',
    icon:     '▶',
    headline: 'DEPLOY IMMEDIATELY',
    sub:      `${planetName} needs Helldivers NOW — conditions are ideal for a successful gambit`,
  };
  if (successPct >= 70) return {
    cls:      'recommended',
    icon:     '▶',
    headline: 'GAMBIT RECOMMENDED',
    sub:      `Deploy to ${planetName} — your presence will meaningfully tip the balance`,
  };
  if (successPct >= 55) return {
    cls:      'consider',
    icon:     '▶',
    headline: 'GAMBIT POSSIBLE',
    sub:      `${planetName} is viable but needs sustained commitment — consider deploying`,
  };
  if (successPct >= 35) return {
    cls:      'caution',
    icon:     '⚠',
    headline: 'PROCEED WITH CAUTION',
    sub:      `Gambit on ${planetName} is risky — only attempt with a significant player surge`,
  };
  return {
    cls:      'not-recommended',
    icon:     '✗',
    headline: 'NOT RECOMMENDED',
    sub:      `Conditions on ${planetName} are unfavourable — gambit unlikely to succeed`,
  };
}

/** Render a single gambit opportunity card. */
function renderGambitCard(g) {
  const planet  = g.libCampaign.planet;
  const fCls    = factionCls(planet.currentOwner ?? g.libCampaign.faction);
  const fLabel  = factionLabel(planet.currentOwner ?? g.libCampaign.faction);

  // Rate display
  let rateDisplay = 'AWAITING DATA';
  let rateClass   = '';
  if (g.netRate != null) {
    const sign = g.netRate >= 0 ? '+' : '';
    rateDisplay = `${sign}${g.netRate.toFixed(2)}%/hr${g.netRateObj.estimated ? '*' : ''}`;
    rateClass   = g.netRate > 0 ? 'positive' : 'negative';
  }

  // ETA display
  let etaDisplay = '—';
  if (g.timeToComplete != null && isFinite(g.timeToComplete)) {
    etaDisplay = `~${g.timeToComplete.toFixed(1)}h`;
  } else if (g.netRate != null && g.netRate <= 0) {
    etaDisplay = 'STALLED';
  }

  // Connected defense summary
  let defenseHtml = '';
  if (g.connectedDefenses.length > 0) {
    // Show the most urgent defense
    const dc       = g.connectedDefenses.reduce((a, b) => {
      const ta = a.planet.event?.endTime ? new Date(a.planet.event.endTime).getTime() : Infinity;
      const tb = b.planet.event?.endTime ? new Date(b.planet.event.endTime).getTime() : Infinity;
      return ta < tb ? a : b;
    });
    const event    = dc.planet.event;
    const remaining = event?.endTime ? fmtCountdown(event.endTime) : '—';
    const hrs       = event?.endTime ? hoursLeft(event.endTime) : Infinity;
    const urgCls    = hrs < 1 ? 'critical' : hrs < 6 ? 'urgent' : '';
    const extra     = g.connectedDefenses.length - 1;

    defenseHtml = `
      <div class="gambit-at-risk">
        <div class="gambit-section-label">⚠ SUPPLY LINE AT RISK</div>
        <div class="gambit-risk-planet">
          <div class="risk-planet-name">${dc.planet.name ?? `PLANET #${dc.planet.index}`}</div>
          <span class="timer-value ${urgCls} sm" data-end="${event?.endTime ?? ''}">${remaining}</span>
        </div>
        ${extra > 0 ? `<div class="more-defenses">+${extra} more defense campaign${extra > 1 ? 's' : ''} at risk</div>` : ''}
      </div>`;
  }

  // Player requirements
  let reqsHtml = '';
  if (g.playerReqs) {
    reqsHtml += `
      <div class="req-item">
        <span class="req-icon">◆</span>
        <span>Breakeven (min. to halt decay): <strong>${g.playerReqs.min.toLocaleString()}</strong>${g.playerReqs.estimated ? '*' : ''}</span>
      </div>
      <div class="req-item">
        <span class="req-icon">◆</span>
        <span>Recommended for confident win: <strong>${g.playerReqs.recommended.toLocaleString()}</strong></span>
      </div>`;
  }

  // Commit window
  let windowHtml = '';
  if (g.connectedDefenses.length > 0 && g.timeToComplete != null && isFinite(g.timeToComplete)) {
    const minDefHr = Math.min(...g.connectedDefenses.map(dc =>
      dc.planet.event?.endTime ? hoursLeft(dc.planet.event.endTime) : Infinity
    ));
    if (isFinite(minDefHr)) {
      const window_ = Math.max(0, minDefHr - g.timeToComplete);
      const winLabel = window_ < 1
        ? `${Math.round(window_ * 60)} mins`
        : `${window_.toFixed(1)} hrs`;
      const winClass = window_ < 1 ? 'negative' : window_ < 6 ? '' : 'positive';
      windowHtml = `
        <div class="req-item">
          <span class="req-icon">◆</span>
          <span>Commit window: <strong class="${winClass}">${winLabel}</strong>
            ${window_ <= 0 ? '<em class="req-warn">— WINDOW CLOSED</em>' : ''}</span>
        </div>`;
    }
  }

  // Conditions checklist
  const condsHtml = g.conditions.map(c => `
    <div class="condition ${c.pass ? 'pass' : 'fail'}">
      <span class="cond-icon">${c.pass ? '✓' : '✗'}</span>
      <span class="cond-text">
        ${c.label}
        <em class="cond-detail">${c.detail}</em>
      </span>
    </div>`).join('');

  const hasEstimates = g.netRateObj.estimated || g.playerReqs?.estimated;
  const rec = getRecommendation(g.successPct, planet.name ?? `Planet #${planet.index}`);

  return `
    <div class="gambit-card ${g.risk.cls}" data-planet-index="${planet.index}">

      <!-- Header: Title + Score -->
      <div class="gambit-card-header">
        <div class="gambit-card-title">
          <span class="gambit-sword">&#9876;</span>
          <div>
            <div class="gambit-label">GAMBIT OPPORTUNITY</div>
            <div class="gambit-planet-title">${planet.name ?? `PLANET #${planet.index}`}</div>
          </div>
        </div>
        <div class="gambit-score-block">
          <div class="score-number ${g.risk.cls}">${g.successPct}%</div>
          <div class="risk-badge ${g.risk.cls}">${g.risk.label}</div>
        </div>
      </div>

      <!-- Success meter bar -->
      <div class="gambit-success-bar">
        <div class="success-fill ${g.risk.cls}" style="width:${g.successPct}%"></div>
      </div>

      <!-- Liberation Target -->
      <div class="gambit-target">
        <div class="gambit-section-label">LIBERATION TARGET</div>
        <div class="gambit-target-header">
          <span class="target-planet-name">${planet.name}</span>
          <span class="faction-badge ${fCls}">${fLabel}</span>
        </div>
        <div class="progress-bar mt-sm">
          <div class="progress-fill lib" style="width:${Math.min(g.libPct, 100)}%"></div>
        </div>
        <div class="gambit-target-stats">
          <span class="tstat">${g.libPct.toFixed(1)}% liberated</span>
          <span class="tstat ${rateClass}">${rateDisplay}</span>
          <span class="tstat">${etaDisplay} to completion</span>
          <span class="tstat">&#128101;&nbsp;${fmt(g.players)}</span>
        </div>
      </div>

      <!-- Defense at risk -->
      ${defenseHtml}

      <!-- Player requirements + time window -->
      <div class="gambit-requirements">
        <div class="gambit-section-label">REQUIREMENTS</div>
        ${reqsHtml}
        ${windowHtml}
        ${hasEstimates ? '<div class="estimate-note">* Estimated — measured data available after next refresh</div>' : ''}
      </div>

      <!-- Conditions checklist -->
      <div class="gambit-conditions">
        <div class="gambit-section-label">CONDITIONS FOR SUCCESS</div>
        ${condsHtml}
      </div>

      <!-- Deployment recommendation banner -->
      <div class="gambit-recommendation ${rec.cls}">
        <span class="rec-icon">${rec.icon}</span>
        <div class="rec-text">
          <div class="rec-headline">${rec.headline}</div>
          <div class="rec-sub">${rec.sub}</div>
        </div>
      </div>

    </div>`;
}

/**
 * Render gambit cards into #gambit-container.
 * Filters to gambits with successPct >= 20 (low-viability gambits
 * are noise and confuse more than they help).
 */
function renderGambits(gambits) {
  const container = document.getElementById('gambit-container');
  const countEl   = document.getElementById('gambit-count');
  if (!container) return;

  // Show all detected gambits (score already visible on card); cap at 6
  const viable = gambits.slice(0, 6);

  if (countEl) countEl.textContent = viable.length;

  if (!viable.length) {
    const hasAny = gambits.length > 0;
    container.innerHTML = `
      <div class="empty-state gambit-empty">
        ${hasAny
          ? 'No viable gambits detected — all liberation campaigns have low success probability.'
          : 'No active liberation campaigns to analyse.'}
        <span>Gambit windows open as campaigns make progress. Check back as the front lines shift.</span>
      </div>`;
    return;
  }

  container.innerHTML = viable.map(renderGambitCard).join('');
}
