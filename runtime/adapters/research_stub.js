'use strict';

const crypto = require('crypto');

class ResearchStub {
  async research(correlationId, workflowClass, goal) {
    return {
      research_report_id: crypto.randomUUID(),
      correlation_id: correlationId,
      workflow_class: workflowClass,
      created_at: new Date().toISOString(),
      findings: [
        {
          finding_id: 'f-001',
          claim: `Codebase analysis for: ${goal}`,
          confidence: 'high',
          sources: ['codebase-analysis'],
          freshness_checked_at: null,
        },
      ],
      confidence: 'high',
      freshness: {
        policy_applied: true,
        all_time_sensitive_checked: true,
      },
      sources: ['codebase-analysis'],
      gaps: [],
    };
  }
}

module.exports = { ResearchStub };
