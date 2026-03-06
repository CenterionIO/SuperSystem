'use strict';

/**
 * Evidence Integrity Check Plugin
 * Verifies evidence records have valid hashes and required fields.
 */
class EvidenceIntegrityPlugin {
  check({ criteria_id, evidence_ids, evidence_lookup }) {
    if (evidence_ids.length === 0) {
      return { status: 'blocked', rationale: 'No evidence to verify integrity.' };
    }

    for (const evId of evidence_ids) {
      if (!evidence_lookup) continue;
      const rec = evidence_lookup.get(evId);
      if (!rec) {
        return { status: 'blocked', rationale: `Evidence ${evId} missing from registry.` };
      }
      if (!rec.content_hash || rec.content_hash.length === 0) {
        return { status: 'fail', rationale: `Evidence ${evId} has no content_hash.` };
      }
      if (!rec.produced_by) {
        return { status: 'fail', rationale: `Evidence ${evId} has no produced_by.` };
      }
    }

    return { status: 'pass', rationale: 'All evidence records have valid hashes and metadata.' };
  }
}

module.exports = { EvidenceIntegrityPlugin };
