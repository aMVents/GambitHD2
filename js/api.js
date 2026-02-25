// ============================================================
// GAMBIT HD2 — API Communication Layer
// Base: https://api.helldivers2.dev
// Docs: https://helldivers-2.github.io/api/
// ============================================================

const HD2_BASE = 'https://api.helldivers2.dev';

const HD2_HEADERS = {
  'X-Super-Client': 'GambitHD2',
  'X-Super-Contact': 'gambit-hd2-app',
  'Accept': 'application/json',
};

/**
 * Core fetch wrapper with error handling and rate-limit detection.
 */
async function hd2Fetch(path) {
  const response = await fetch(`${HD2_BASE}${path}`, { headers: HD2_HEADERS });

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') ?? '10';
    throw new Error(`RATE LIMITED — retry in ${retryAfter}s`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} on ${path}`);
  }

  return response.json();
}

/**
 * Fetch all required data in parallel (4 requests, within rate limit).
 * Returns: { war, campaigns, assignments, planets }
 */
async function fetchAll() {
  const [war, campaigns, assignments, planets] = await Promise.all([
    hd2Fetch('/api/v1/war'),
    hd2Fetch('/api/v1/campaigns'),
    hd2Fetch('/api/v1/assignments'),
    hd2Fetch('/api/v1/planets'),
  ]);

  return { war, campaigns, assignments, planets };
}
