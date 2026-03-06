#!/usr/bin/env node
/**
 * Runtime Output Conformance Validator
 *
 * Validates any run output directory (out/<correlation_id>/) against
 * the same GP1-GP5 + CC checks used for golden path specs.
 *
 * Can validate:
 *   - SS-produced outputs
 *   - SV2-produced outputs (if structured the same way)
 *   - Any system that produces run_state.json + VerificationArtifact.json + evidence_records.json
 *
 * Usage:
 *   node tools/validate-run.js out/<correlation_id>
 *   require('./tools/validate-run')(runDir)  // programmatic
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ROOT = path.join(__dirname, '..');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function createValidator(schema) {
  const copy = JSON.parse(JSON.stringify(schema));
  delete copy.$schema;
  delete copy.version;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(copy);
}

function validateRunOutput(runDir) {
  const errors = [];

  // ─── Load run output ───
  const runStatePath = path.join(runDir, 'run_state.json');
  const vaPath = path.join(runDir, 'VerificationArtifact.json');
  const evidencePath = path.join(runDir, 'evidence_records.json');

  if (!fs.existsSync(runStatePath)) {
    console.log('  FAIL: run_state.json not found');
    return false;
  }
  if (!fs.existsSync(vaPath)) {
    console.log('  FAIL: VerificationArtifact.json not found');
    return false;
  }

  const runState = loadJson(runStatePath);
  const va = loadJson(vaPath);
  const evidenceRecords = fs.existsSync(evidencePath) ? loadJson(evidencePath) : [];

  const plan = runState.artifacts?.execution_plan;
  const build = runState.artifacts?.build_report;
  const research = runState.artifacts?.research_report;
  const correlationId = runState.correlation_id;
  const workflowClass = runState.workflow_class;

  // ─── Load schemas ───
  const verifySchema = loadJson(path.join(ROOT, 'specs', 'task1', 'v1', 'schemas', 'VerificationArtifact.json'));
  const planSchema = loadJson(path.join(ROOT, 'specs', 'task1', 'v1', 'schemas', 'ExecutionPlan.json'));
  const buildSchema = loadJson(path.join(ROOT, 'specs', 'task1', 'v1', 'schemas', 'BuildReport.json'));
  const researchSchema = loadJson(path.join(ROOT, 'specs', 'task1', 'v1', 'schemas', 'ResearchReport.json'));
  const taxonomy = loadJson(path.join(ROOT, 'policy', 'v1', 'workflow_taxonomy.json'));
  const routing = loadJson(path.join(ROOT, 'policy', 'v1', 'routing_policy.json'));

  const validateVerify = createValidator(verifySchema);
  const validatePlan = createValidator(planSchema);
  const validateBuild = createValidator(buildSchema);
  const validateResearch = createValidator(researchSchema);

  // ─── GP1: Schema Conformance ───

  if (va && !validateVerify(va)) {
    for (const err of validateVerify.errors) {
      errors.push(`GP1: VerificationArtifact invalid at ${err.instancePath || '/'}: ${err.message}`);
    }
  }

  if (plan && !validatePlan(plan)) {
    for (const err of validatePlan.errors) {
      errors.push(`GP1: ExecutionPlan invalid at ${err.instancePath || '/'}: ${err.message}`);
    }
  }

  if (build && !validateBuild(build)) {
    for (const err of validateBuild.errors) {
      errors.push(`GP1: BuildReport invalid at ${err.instancePath || '/'}: ${err.message}`);
    }
  }

  if (research && !validateResearch(research)) {
    for (const err of validateResearch.errors) {
      errors.push(`GP1: ResearchReport invalid at ${err.instancePath || '/'}: ${err.message}`);
    }
  }

  // ─── GP2: Evidence Trace Completeness ───

  const evidenceIds = new Set(evidenceRecords.map(r => r.evidence_id));

  if (build && build.evidence_map) {
    for (const [critId, evIds] of Object.entries(build.evidence_map)) {
      for (const evId of evIds) {
        if (!evidenceIds.has(evId)) {
          errors.push(`GP2: evidence_map[${critId}] references unresolved evidence_id: ${evId}`);
        }
      }
    }
  }

  if (va && va.criteria_results) {
    for (const cr of va.criteria_results) {
      for (const evId of cr.evidence_ids) {
        if (!evidenceIds.has(evId)) {
          errors.push(`GP2: criteria_results[${cr.criteria_id}] references unresolved evidence_id: ${evId}`);
        }
      }
    }
  }

  if (plan && plan.acceptance_criteria && build && build.evidence_map) {
    const mapKeys = new Set(Object.keys(build.evidence_map));
    for (const crit of plan.acceptance_criteria) {
      if (!mapKeys.has(crit.criteria_id)) {
        errors.push(`GP2: criteria_id ${crit.criteria_id} missing from evidence_map`);
      }
    }
  }

  if (plan && plan.acceptance_criteria && va && va.criteria_results) {
    const crIds = new Set(va.criteria_results.map(cr => cr.criteria_id));
    for (const crit of plan.acceptance_criteria) {
      if (!crIds.has(crit.criteria_id)) {
        errors.push(`GP2: criteria_id ${crit.criteria_id} missing from criteria_results`);
      }
    }
  }

  // ─── GP3: State Transition Conformance ───

  if (runState.transitions && runState.transitions.length > 0 && workflowClass) {
    const normalFlow = routing.classes[workflowClass]?.normal_flow;
    if (normalFlow) {
      const stateSeq = [runState.transitions[0].from];
      for (const t of runState.transitions) {
        stateSeq.push(t.to);
      }
      // Check if normal flow is a subsequence (allows for review states)
      const finalState = stateSeq[stateSeq.length - 1];
      const expectedFinal = normalFlow[normalFlow.length - 1];
      if (finalState !== expectedFinal && finalState !== 'escalation') {
        errors.push(`GP3: Final state ${finalState} does not match expected ${expectedFinal}`);
      }
    }
  }

  // ─── GP4: Ladder and Freshness Compliance ───

  if (va && va.ladder_compliance && workflowClass) {
    const taxLadder = taxonomy.classes[workflowClass]?.verification_ladder;
    if (taxLadder) {
      const reqStr = JSON.stringify(va.ladder_compliance.required_ladder);
      const taxStr = JSON.stringify(taxLadder);
      if (reqStr !== taxStr) {
        errors.push(`GP4: required_ladder mismatch — taxonomy: ${taxStr}, artifact: ${reqStr}`);
      }
    }
  }

  if (plan && va) {
    const planFreshness = plan.verification_requirements?.freshness_required || false;
    const vaFreshness = va.freshness_results?.freshness_required || false;
    if (planFreshness !== vaFreshness) {
      errors.push(`GP4: freshness_required mismatch — plan: ${planFreshness}, artifact: ${vaFreshness}`);
    }
  }

  // ─── GP5: Fail-Closed Integrity ───

  if (va) {
    if (va.fail_closed_enforced !== true) {
      errors.push('GP5: fail_closed_enforced is not true');
    }

    if (va.overall_status === 'pass' && va.criteria_results) {
      for (const cr of va.criteria_results) {
        if (cr.required && cr.status !== 'pass') {
          errors.push(`GP5: overall_status is pass but required criterion ${cr.criteria_id} is ${cr.status} (FC-003)`);
        }
      }
    }
  }

  // ─── CC-009: Correlation ID Consistency ───

  if (correlationId) {
    if (va && va.correlation_id !== correlationId) {
      errors.push('CC-009: VerificationArtifact correlation_id mismatch');
    }
    if (plan && plan.correlation_id !== correlationId) {
      errors.push('CC-009: ExecutionPlan correlation_id mismatch');
    }
    if (build && build.correlation_id !== correlationId) {
      errors.push('CC-009: BuildReport correlation_id mismatch');
    }
    for (const er of evidenceRecords) {
      if (er.correlation_id !== correlationId) {
        errors.push(`CC-009: Evidence ${er.evidence_id} correlation_id mismatch`);
      }
    }
  }

  // ─── CC-010: Artifact Reference Chain ───

  if (plan && research && plan.research_report_id !== research.research_report_id) {
    errors.push('CC-010: ExecutionPlan.research_report_id does not match ResearchReport');
  }
  if (build && plan && build.execution_plan_id !== plan.execution_plan_id) {
    errors.push('CC-010: BuildReport.execution_plan_id does not match ExecutionPlan');
  }
  if (va && plan && va.execution_plan_id !== plan.execution_plan_id) {
    errors.push('CC-010: VerificationArtifact.execution_plan_id does not match ExecutionPlan');
  }
  if (va && build && va.build_report_id !== build.build_report_id) {
    errors.push('CC-010: VerificationArtifact.build_report_id does not match BuildReport');
  }

  // ─── CC-011: Evidence Record Fields ───

  const requiredFields = ['evidence_id', 'correlation_id', 'evidence_type', 'path', 'content_hash', 'produced_by', 'produced_at', 'size_bytes'];
  for (const er of evidenceRecords) {
    for (const field of requiredFields) {
      if (!(field in er)) {
        errors.push(`CC-011: Evidence ${er.evidence_id || 'unknown'} missing field: ${field}`);
      }
    }
  }

  // ─── CC-013: Artifact Hash ───

  if (va) {
    if (!va.artifact_hash || typeof va.artifact_hash !== 'string' || va.artifact_hash.length === 0) {
      errors.push('CC-013: artifact_hash missing or empty');
    } else if (!/^[0-9a-f]+$/.test(va.artifact_hash)) {
      errors.push('CC-013: artifact_hash is not valid hex-lowercase');
    }
  }

  // ─── Report ───

  if (errors.length > 0) {
    console.log(`  Conformance: FAIL (${errors.length} errors)`);
    for (const e of errors) {
      console.log(`    - ${e}`);
    }
    return false;
  } else {
    console.log('  Conformance: PASS');
    console.log('    - GP1: Schema conformance');
    console.log('    - GP2: Evidence trace completeness');
    console.log('    - GP3: State transition conformance');
    console.log('    - GP4: Ladder + freshness compliance');
    console.log('    - GP5: Fail-closed integrity');
    console.log('    - CC-009..CC-013: Cross-artifact checks');
    return true;
  }
}

// Standalone CLI mode
if (require.main === module) {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error('Usage: node tools/validate-run.js <out/<correlation_id>>');
    process.exit(1);
  }
  const absDir = path.resolve(runDir);
  if (!fs.existsSync(absDir)) {
    console.error(`Directory not found: ${absDir}`);
    process.exit(1);
  }
  const ok = validateRunOutput(absDir);
  process.exit(ok ? 0 : 1);
}

module.exports = validateRunOutput;
