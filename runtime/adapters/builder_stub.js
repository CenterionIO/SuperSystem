'use strict';

const crypto = require('crypto');

class BuilderStub {
  async build(correlationId, executionPlan, evidenceRegistry) {
    const stepResults = [];
    const evidenceMap = {};

    for (const step of executionPlan.steps) {
      const evidenceIds = [];

      // Register a diff evidence for each step
      const diffRecord = evidenceRegistry.register(
        correlationId,
        'diff',
        `--- /dev/null\n+++ ${step.paths_affected[0] || 'src/file.js'}\n@@ -0,0 +1,10 @@\n+// Stub implementation for step ${step.step_id}`,
        'Builder'
      );
      evidenceIds.push(diffRecord.evidence_id);

      // Register test log if verification_type includes test
      if (step.verification_type === 'unit' || step.verification_type === 'integration') {
        const testRecord = evidenceRegistry.register(
          correlationId,
          'test_log',
          JSON.stringify({
            suite: step.step_id,
            tests: [{ name: `test_${step.step_id}`, status: 'pass', duration_ms: 42 }],
            total: 1, passed: 1, failed: 0,
          }),
          'Builder'
        );
        evidenceIds.push(testRecord.evidence_id);
      }

      stepResults.push({
        step_id: step.step_id,
        criteria_ids: step.criteria_ids,
        status: 'completed',
        plan_blocker_detail: null,
        evidence_ids: evidenceIds,
        action_log: [
          {
            timestamp: new Date().toISOString(),
            tool: step.tools_required[0] || 'file.write',
            action: step.action,
            result: 'success',
          },
        ],
      });

      // Map criteria to evidence
      for (const critId of step.criteria_ids) {
        if (!evidenceMap[critId]) evidenceMap[critId] = [];
        evidenceMap[critId].push(...evidenceIds);
      }
    }

    // Register a command_log for the overall build
    const cmdRecord = evidenceRegistry.register(
      correlationId,
      'command_log',
      JSON.stringify({ command: 'npm test', exit_code: 0, stdout: 'All tests passed' }),
      'Builder'
    );

    // Add command log to last criteria
    const lastCritId = executionPlan.acceptance_criteria[executionPlan.acceptance_criteria.length - 1].criteria_id;
    if (evidenceMap[lastCritId]) {
      evidenceMap[lastCritId].push(cmdRecord.evidence_id);
    }

    const buildReport = {
      build_report_id: crypto.randomUUID(),
      correlation_id: correlationId,
      execution_plan_id: executionPlan.execution_plan_id,
      workflow_class: executionPlan.workflow_class,
      created_at: new Date().toISOString(),
      step_results: stepResults,
      evidence_map: evidenceMap,
      status: 'complete',
    };

    return { build_report: buildReport };
  }
}

module.exports = { BuilderStub };
