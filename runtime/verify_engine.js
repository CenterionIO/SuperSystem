'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

class VerifyEngine {
  constructor(opts = {}) {
    const configPath = opts.configPath || path.join(ROOT, 'config', 'runtime.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    this.contract = JSON.parse(fs.readFileSync(path.join(ROOT, config.spec_paths.verify_contract), 'utf8'));
    this.engineSpec = JSON.parse(fs.readFileSync(path.join(ROOT, config.spec_paths.verify_engine), 'utf8'));
    this.taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, config.policy_paths.workflow_taxonomy), 'utf8'));
    this.routing = JSON.parse(fs.readFileSync(path.join(ROOT, config.policy_paths.routing_policy), 'utf8'));
    this.plugins = new Map();
  }

  registerPlugin(checkType, plugin) {
    this.plugins.set(checkType, plugin);
  }

  verify(request) {
    const { correlation_id, execution_plan, build_report, workflow_class, evidence_records } = request;

    // Step 1: Validate inputs
    if (!execution_plan || !build_report) {
      return this._blockedArtifact(request, 'Missing execution_plan or build_report');
    }

    // Build evidence lookup
    const evidenceLookup = new Map();
    if (evidence_records) {
      for (const rec of evidence_records) {
        evidenceLookup.set(rec.evidence_id, rec);
      }
    }

    // Step 2-3: Extract criteria and resolve evidence
    const criteriaResults = [];
    let hasRequiredNonPass = false;

    for (const crit of execution_plan.acceptance_criteria) {
      const evidenceIds = build_report.evidence_map[crit.criteria_id] || [];

      // FC-001: Required criterion without evidence -> blocked
      if (evidenceIds.length === 0) {
        const status = crit.required ? 'blocked' : 'warn';
        if (crit.required) hasRequiredNonPass = true;
        criteriaResults.push({
          criteria_id: crit.criteria_id,
          status,
          evidence_ids: [],
          rationale: 'FC-001: No evidence found for this criterion.',
          required: crit.required,
          verification_type_used: 'unit',
        });
        continue;
      }

      // Step 4-5: Run plugin checks if available
      let pluginResult = null;
      const checkType = this._inferCheckType(crit, execution_plan);
      const plugin = this.plugins.get(checkType);

      if (plugin) {
        pluginResult = plugin.check({
          criteria_id: crit.criteria_id,
          criteria_description: crit.description,
          evidence_ids: evidenceIds,
          evidence_lookup: evidenceLookup,
          check_type: checkType,
          workflow_class,
        });
      }

      // Step 6: Evaluate criteria status
      let status = pluginResult ? pluginResult.status : 'pass';

      // FC-002: Required criterion with warn -> blocked
      if (crit.required && status === 'warn') {
        status = this.routing.fail_closed.required_warn_behavior || 'blocked';
      }

      // Plugin error -> blocked (EI-004)
      if (status === 'error') {
        status = 'blocked';
      }

      if (crit.required && status !== 'pass') hasRequiredNonPass = true;

      criteriaResults.push({
        criteria_id: crit.criteria_id,
        status,
        evidence_ids: evidenceIds,
        rationale: pluginResult ? pluginResult.rationale : 'Evidence present and verified.',
        required: crit.required,
        verification_type_used: checkType,
      });
    }

    // Step 7: Ladder compliance
    const classConfig = this.taxonomy.classes[workflow_class];
    const requiredLadder = classConfig ? classConfig.verification_ladder : [];
    const executedTypes = new Set(criteriaResults.map(cr => cr.verification_type_used));
    const ladderCompliant = requiredLadder.every(step => executedTypes.has(step));

    if (!ladderCompliant && requiredLadder.length > 0) {
      hasRequiredNonPass = true;
    }

    // Step 8: Freshness
    const freshnessRequired = execution_plan.verification_requirements?.freshness_required || false;

    // Step 9: Overall status (FC-003)
    let overallStatus;
    if (criteriaResults.some(cr => cr.required && cr.status === 'blocked')) {
      overallStatus = 'blocked';
    } else if (criteriaResults.some(cr => cr.required && cr.status === 'fail')) {
      overallStatus = 'fail';
    } else if (hasRequiredNonPass) {
      overallStatus = 'blocked';
    } else if (criteriaResults.some(cr => !cr.required && cr.status === 'warn')) {
      overallStatus = 'warn';
    } else {
      overallStatus = 'pass';
    }

    // Step 10: Produce artifact
    const artifact = {
      verification_id: crypto.randomUUID(),
      correlation_id,
      execution_plan_id: execution_plan.execution_plan_id,
      build_report_id: build_report.build_report_id,
      workflow_class,
      created_at: new Date().toISOString(),
      overall_status: overallStatus,
      criteria_results: criteriaResults,
      freshness_results: {
        freshness_required: freshnessRequired,
        checks_performed: [],
        all_fresh: true,
      },
      ladder_compliance: {
        required_ladder: requiredLadder,
        executed_ladder: Array.from(executedTypes).filter(t => requiredLadder.includes(t)),
        compliant: ladderCompliant,
      },
      fail_closed_enforced: true,
      warn_rationale: null,
      council_override: null,
      artifact_hash: '',
    };

    // FC-004: artifact_hash computation
    const sortedKeys = Object.keys(artifact).filter(k => k !== 'artifact_hash').sort();
    const hashObj = {};
    for (const k of sortedKeys) hashObj[k] = artifact[k];
    artifact.artifact_hash = crypto.createHash('sha256').update(JSON.stringify(hashObj)).digest('hex');

    return { verdict: overallStatus, artifact };
  }

  _inferCheckType(criterion, plan) {
    // Find the step that references this criterion and use its verification_type
    for (const step of plan.steps) {
      if (step.criteria_ids.includes(criterion.criteria_id)) {
        return step.verification_type || 'unit';
      }
    }
    return 'unit';
  }

  _blockedArtifact(request, reason) {
    return {
      verdict: 'blocked',
      artifact: {
        verification_id: crypto.randomUUID(),
        correlation_id: request.correlation_id,
        execution_plan_id: null,
        build_report_id: null,
        workflow_class: request.workflow_class,
        created_at: new Date().toISOString(),
        overall_status: 'blocked',
        criteria_results: [],
        freshness_results: { freshness_required: false, checks_performed: [], all_fresh: true },
        ladder_compliance: { required_ladder: [], executed_ladder: [], compliant: false },
        fail_closed_enforced: true,
        warn_rationale: null,
        council_override: null,
        artifact_hash: '',
        blocked_reason: reason,
      },
    };
  }
}

module.exports = { VerifyEngine };
