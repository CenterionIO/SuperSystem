'use strict';

const crypto = require('crypto');

class PlannerStub {
  async plan(correlationId, workflowClass, goal, researchReport) {
    if (typeof goal === 'string' && /(ambiguous|plan_blocker)/i.test(goal)) {
      return {
        _plan_blocker: true,
        blocker_reason: 'Planner detected ambiguous goal; clarification required.',
      };
    }
    const researchReportId = researchReport ? researchReport.research_report_id : null;

    return {
      execution_plan_id: crypto.randomUUID(),
      correlation_id: correlationId,
      workflow_class: workflowClass,
      version: 1,
      created_at: new Date().toISOString(),
      research_report_id: researchReportId,
      steps: [
        {
          step_id: 'step-001',
          order: 1,
          action: `Implement: ${goal}`,
          description: `Create the primary implementation for: ${goal}`,
          criteria_ids: ['crit-001'],
          tools_required: ['file.write'],
          paths_affected: ['src/output.js'],
          verification_type: 'unit',
        },
        {
          step_id: 'step-002',
          order: 2,
          action: 'Add tests',
          description: 'Create unit and integration tests for the implementation.',
          criteria_ids: ['crit-002'],
          tools_required: ['file.write', 'bash.run'],
          paths_affected: ['tests/output.test.js'],
          verification_type: 'integration',
        },
      ],
      acceptance_criteria: [
        {
          criteria_id: 'crit-001',
          description: `Implementation satisfies: ${goal}`,
          required: true,
        },
        {
          criteria_id: 'crit-002',
          description: 'All unit and integration tests pass.',
          required: true,
        },
      ],
      verification_requirements: {
        minimum_ladder: workflowClass === 'research_only' ? ['freshness'] : ['unit', 'integration'],
        freshness_required: false,
      },
    };
  }
}

module.exports = { PlannerStub };
