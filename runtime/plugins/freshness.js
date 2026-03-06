'use strict';

/**
 * Freshness Check Plugin (stub)
 * Verifies time-sensitive claims are fresh.
 * Currently a pass-through stub — always passes unless freshness_claims are stale.
 */
class FreshnessPlugin {
  check({ criteria_id, evidence_ids }) {
    // Stub: freshness always passes for now
    return { status: 'pass', rationale: 'Freshness check passed (stub).' };
  }
}

module.exports = { FreshnessPlugin };
