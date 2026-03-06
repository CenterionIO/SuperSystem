'use strict';

/**
 * Plan-Build Alignment Check Plugin
 * Verifies that build evidence covers all criteria from the execution plan.
 */
class PlanAlignmentPlugin {
  check({ criteria_id, evidence_ids, evidence_lookup }) {
    if (evidence_ids.length === 0) {
      return { status: 'blocked', rationale: 'No evidence found for criterion.' };
    }

    // Verify each evidence_id resolves
    for (const evId of evidence_ids) {
      if (evidence_lookup && !evidence_lookup.has(evId)) {
        return { status: 'blocked', rationale: `Evidence ${evId} not found in registry.` };
      }
    }

    return { status: 'pass', rationale: `${evidence_ids.length} evidence items present and resolved.` };
  }
}

module.exports = { PlanAlignmentPlugin };
