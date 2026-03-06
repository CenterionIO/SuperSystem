#!/usr/bin/env node
/**
 * Stage 5 Golden Paths and Conformance Gate Validator
 * Gates GP1-GP5: Schema conformance, evidence trace, gate verdict determinism,
 * ladder/freshness compliance, fail-closed integrity.
 * Plus CC-009 through CC-013 from conformance-report-spec.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ROOT = path.join(__dirname, '..', '..', '..');
const TASK5_DIR = path.join(ROOT, 'specs', 'task5', 'v1');
const TASK1_DIR = path.join(ROOT, 'specs', 'task1', 'v1');
const TASK3_DIR = path.join(ROOT, 'specs', 'task3', 'v1');
const POLICY_DIR = path.join(ROOT, 'policy', 'v1');

const errors = [];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ─── Load schemas ───

const researchSchema = loadJson(path.join(TASK1_DIR, 'schemas', 'ResearchReport.json'));
const planSchema = loadJson(path.join(TASK1_DIR, 'schemas', 'ExecutionPlan.json'));
const buildSchema = loadJson(path.join(TASK1_DIR, 'schemas', 'BuildReport.json'));
const verifySchema = loadJson(path.join(TASK1_DIR, 'schemas', 'VerificationArtifact.json'));

// ─── Load policy and specs ───

const taxonomy = loadJson(path.join(POLICY_DIR, 'workflow_taxonomy.json'));
const routing = loadJson(path.join(POLICY_DIR, 'routing_policy.json'));
const gateSequence = loadJson(path.join(TASK3_DIR, 'gate-sequence.json'));
const conformanceSpec = loadJson(path.join(TASK5_DIR, 'conformance-report-spec.json'));

// ─── Load golden paths ───

const goldenPaths = [
  { name: 'code_change', data: loadJson(path.join(TASK5_DIR, 'golden-path-code-change.json')) },
  { name: 'mcp_tool', data: loadJson(path.join(TASK5_DIR, 'golden-path-mcp-tool.json')) },
];

// ─── AJV setup ───

function createValidator(schema) {
  const schemaCopy = JSON.parse(JSON.stringify(schema));
  delete schemaCopy.$schema;
  // Remove version field that's not part of JSON Schema
  delete schemaCopy.version;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schemaCopy);
}

const validateResearch = createValidator(researchSchema);
const validatePlan = createValidator(planSchema);
const validateBuild = createValidator(buildSchema);
const validateVerify = createValidator(verifySchema);

// ─── Gate GP1: Schema Conformance ───

function gateGP1() {
  for (const { name, data } of goldenPaths) {
    const a = data.artifacts;

    // ResearchReport
    if (!validateResearch(a.research_report)) {
      for (const err of validateResearch.errors) {
        errors.push(`GP1 [${name}]: ResearchReport invalid at ${err.instancePath || '/'}: ${err.message}`);
      }
    }

    // ExecutionPlan
    if (!validatePlan(a.execution_plan)) {
      for (const err of validatePlan.errors) {
        errors.push(`GP1 [${name}]: ExecutionPlan invalid at ${err.instancePath || '/'}: ${err.message}`);
      }
    }

    // BuildReport
    if (!validateBuild(a.build_report)) {
      for (const err of validateBuild.errors) {
        errors.push(`GP1 [${name}]: BuildReport invalid at ${err.instancePath || '/'}: ${err.message}`);
      }
    }

    // VerificationArtifact
    if (!validateVerify(a.verification_artifact)) {
      for (const err of validateVerify.errors) {
        errors.push(`GP1 [${name}]: VerificationArtifact invalid at ${err.instancePath || '/'}: ${err.message}`);
      }
    }
  }
}

// ─── Gate GP2: Evidence Trace Completeness ───

function gateGP2() {
  for (const { name, data } of goldenPaths) {
    const a = data.artifacts;
    const evidenceIds = new Set(a.evidence_records.map(r => r.evidence_id));

    // GP2.1: Every evidence_id in evidence_map resolves
    for (const [critId, evIds] of Object.entries(a.build_report.evidence_map)) {
      for (const evId of evIds) {
        if (!evidenceIds.has(evId)) {
          errors.push(`GP2.1 [${name}]: evidence_map[${critId}] references unresolved evidence_id: ${evId}`);
        }
      }
    }

    // GP2.2: Every evidence_id in criteria_results resolves
    for (const cr of a.verification_artifact.criteria_results) {
      for (const evId of cr.evidence_ids) {
        if (!evidenceIds.has(evId)) {
          errors.push(`GP2.2 [${name}]: criteria_results[${cr.criteria_id}] references unresolved evidence_id: ${evId}`);
        }
      }
    }

    // GP2.3: Every criteria_id in acceptance_criteria appears in evidence_map
    const evidenceMapKeys = new Set(Object.keys(a.build_report.evidence_map));
    for (const crit of a.execution_plan.acceptance_criteria) {
      if (!evidenceMapKeys.has(crit.criteria_id)) {
        errors.push(`GP2.3 [${name}]: criteria_id ${crit.criteria_id} missing from evidence_map`);
      }
    }

    // GP2.4: Every criteria_id in acceptance_criteria appears in criteria_results
    const criteriaResultIds = new Set(a.verification_artifact.criteria_results.map(cr => cr.criteria_id));
    for (const crit of a.execution_plan.acceptance_criteria) {
      if (!criteriaResultIds.has(crit.criteria_id)) {
        errors.push(`GP2.4 [${name}]: criteria_id ${crit.criteria_id} missing from criteria_results`);
      }
    }

    // GP2.5: Every step_result evidence_id resolves
    for (const sr of a.build_report.step_results) {
      for (const evId of sr.evidence_ids) {
        if (!evidenceIds.has(evId)) {
          errors.push(`GP2.5 [${name}]: step_results[${sr.step_id}] references unresolved evidence_id: ${evId}`);
        }
      }
    }
  }
}

// ─── Gate GP3: Gate Verdict Determinism ───

function gateGP3() {
  for (const { name, data } of goldenPaths) {
    const wfClass = data.workflow_metadata.workflow_class;
    const normalFlow = routing.classes[wfClass]?.normal_flow;

    if (!normalFlow) {
      errors.push(`GP3.1 [${name}]: No routing_policy.classes entry for ${wfClass}`);
      continue;
    }

    // GP3.1: Extract state sequence from transitions and compare to normal_flow
    const stateSeq = [data.state_trace.transitions[0].from];
    for (const t of data.state_trace.transitions) {
      stateSeq.push(t.to);
    }
    const normalFlowStr = JSON.stringify(normalFlow);
    const stateSeqStr = JSON.stringify(stateSeq);
    if (normalFlowStr !== stateSeqStr) {
      errors.push(`GP3.1 [${name}]: State sequence mismatch — expected: ${normalFlowStr}, got: ${stateSeqStr}`);
    }

    // GP3.2: Gates fire at correct states
    for (const t of data.state_trace.transitions) {
      if (t.gate) {
        const gateSpec = gateSequence.gates[t.gate];
        if (!gateSpec) {
          errors.push(`GP3.2 [${name}]: Transition references unknown gate: ${t.gate}`);
          continue;
        }
        if (gateSpec.fires_at_state !== t.to) {
          errors.push(`GP3.2 [${name}]: Gate ${t.gate} should fire at ${gateSpec.fires_at_state} but transition targets ${t.to}`);
        }
      }
    }
  }
}

// ─── Gate GP4: Ladder and Freshness Compliance ───

function gateGP4() {
  for (const { name, data } of goldenPaths) {
    const wfClass = data.workflow_metadata.workflow_class;
    const taxLadder = taxonomy.classes[wfClass]?.verification_ladder;
    const va = data.artifacts.verification_artifact;

    // GP4.1: required_ladder matches taxonomy
    if (taxLadder) {
      const reqLadder = JSON.stringify(va.ladder_compliance.required_ladder);
      const taxStr = JSON.stringify(taxLadder);
      if (reqLadder !== taxStr) {
        errors.push(`GP4.1 [${name}]: required_ladder mismatch — taxonomy: ${taxStr}, artifact: ${reqLadder}`);
      }
    }

    // GP4.2: compliant is true
    if (!va.ladder_compliance.compliant) {
      errors.push(`GP4.2 [${name}]: ladder_compliance.compliant is false`);
    }

    // GP4.3: executed_ladder covers required_ladder
    const reqSet = new Set(va.ladder_compliance.required_ladder);
    const execSet = new Set(va.ladder_compliance.executed_ladder);
    for (const step of reqSet) {
      if (!execSet.has(step)) {
        errors.push(`GP4.3 [${name}]: required ladder step ${step} not in executed_ladder`);
      }
    }

    // GP4.4: Freshness consistency
    const plan = data.artifacts.execution_plan;
    if (plan.verification_requirements.freshness_required !== va.freshness_results.freshness_required) {
      errors.push(`GP4.4 [${name}]: freshness_required mismatch — plan: ${plan.verification_requirements.freshness_required}, artifact: ${va.freshness_results.freshness_required}`);
    }
  }
}

// ─── Gate GP5: Fail-Closed Integrity ───

function gateGP5() {
  for (const { name, data } of goldenPaths) {
    const va = data.artifacts.verification_artifact;

    // GP5.1: fail_closed_enforced is true
    if (va.fail_closed_enforced !== true) {
      errors.push(`GP5.1 [${name}]: fail_closed_enforced is not true`);
    }

    // GP5.2: If overall is pass, all required criteria must be pass
    if (va.overall_status === 'pass') {
      for (const cr of va.criteria_results) {
        if (cr.required && cr.status !== 'pass') {
          errors.push(`GP5.2 [${name}]: overall_status is pass but required criterion ${cr.criteria_id} is ${cr.status}`);
        }
      }
    }

    // GP5.3: If any required criterion is non-pass, overall cannot be pass
    const hasRequiredNonPass = va.criteria_results.some(cr => cr.required && cr.status !== 'pass');
    if (hasRequiredNonPass && va.overall_status === 'pass') {
      errors.push(`GP5.3 [${name}]: overall_status is pass despite required non-pass criteria (FC-003 violation)`);
    }
  }
}

// ─── Additional conformance checks (CC-009 through CC-013) ───

function additionalConformance() {
  for (const { name, data } of goldenPaths) {
    const a = data.artifacts;
    const corrId = data.workflow_metadata.correlation_id;

    // CC-009: Correlation ID consistency
    if (a.research_report.correlation_id !== corrId) {
      errors.push(`CC-009 [${name}]: ResearchReport correlation_id mismatch`);
    }
    if (a.execution_plan.correlation_id !== corrId) {
      errors.push(`CC-009 [${name}]: ExecutionPlan correlation_id mismatch`);
    }
    if (a.build_report.correlation_id !== corrId) {
      errors.push(`CC-009 [${name}]: BuildReport correlation_id mismatch`);
    }
    if (a.verification_artifact.correlation_id !== corrId) {
      errors.push(`CC-009 [${name}]: VerificationArtifact correlation_id mismatch`);
    }
    for (const er of a.evidence_records) {
      if (er.correlation_id !== corrId) {
        errors.push(`CC-009 [${name}]: Evidence record ${er.evidence_id} correlation_id mismatch`);
      }
    }

    // CC-010: Artifact reference chain
    if (a.execution_plan.research_report_id !== a.research_report.research_report_id) {
      errors.push(`CC-010 [${name}]: ExecutionPlan.research_report_id does not match ResearchReport`);
    }
    if (a.build_report.execution_plan_id !== a.execution_plan.execution_plan_id) {
      errors.push(`CC-010 [${name}]: BuildReport.execution_plan_id does not match ExecutionPlan`);
    }
    if (a.verification_artifact.execution_plan_id !== a.execution_plan.execution_plan_id) {
      errors.push(`CC-010 [${name}]: VerificationArtifact.execution_plan_id does not match ExecutionPlan`);
    }
    if (a.verification_artifact.build_report_id !== a.build_report.build_report_id) {
      errors.push(`CC-010 [${name}]: VerificationArtifact.build_report_id does not match BuildReport`);
    }

    // CC-011: Evidence record required fields
    const requiredEvidenceFields = ['evidence_id', 'correlation_id', 'evidence_type', 'path', 'content_hash', 'produced_by', 'produced_at', 'size_bytes'];
    for (const er of a.evidence_records) {
      for (const field of requiredEvidenceFields) {
        if (!(field in er)) {
          errors.push(`CC-011 [${name}]: Evidence record ${er.evidence_id} missing field: ${field}`);
        }
      }
    }

    // CC-012: Evidence path format
    for (const er of a.evidence_records) {
      const expectedPrefix = `evidence/${corrId}/`;
      if (!er.path.startsWith(expectedPrefix)) {
        errors.push(`CC-012 [${name}]: Evidence record ${er.evidence_id} path does not start with ${expectedPrefix}`);
      }
      if (!er.path.includes(er.evidence_id)) {
        errors.push(`CC-012 [${name}]: Evidence record ${er.evidence_id} path does not contain evidence_id`);
      }
    }

    // CC-013: Artifact hash present
    if (!a.verification_artifact.artifact_hash || typeof a.verification_artifact.artifact_hash !== 'string' || a.verification_artifact.artifact_hash.length === 0) {
      errors.push(`CC-013 [${name}]: VerificationArtifact.artifact_hash missing or empty`);
    }
    if (!/^[0-9a-f]+$/.test(a.verification_artifact.artifact_hash)) {
      errors.push(`CC-013 [${name}]: VerificationArtifact.artifact_hash is not valid hex-lowercase`);
    }
  }
}

// ─── Conformance spec self-check ───

function conformanceSpecCheck() {
  // Verify conformance-report-spec has all 13 checks
  const checks = conformanceSpec.conformance_checks?.checks || [];
  if (checks.length < 13) {
    errors.push(`Conformance spec: expected >= 13 checks, found ${checks.length}`);
  }

  // Verify invariants exist
  if (!conformanceSpec.conformance_invariants || conformanceSpec.conformance_invariants.length === 0) {
    errors.push('Conformance spec: missing conformance_invariants');
  }
}

// ─── Run All Gates ───

gateGP1();
gateGP2();
gateGP3();
gateGP4();
gateGP5();
additionalConformance();
conformanceSpecCheck();

// ─── Report ───

if (errors.length > 0) {
  console.log(`Stage 5 golden path gates: FAIL (${errors.length} errors)`);
  for (const e of errors) {
    console.log(`  - ${e}`);
  }
  process.exit(1);
} else {
  console.log('Stage 5 golden path gates: PASS');
  console.log('  - GP1: Schema conformance (4 artifacts x 2 paths)');
  console.log('  - GP2: Evidence trace completeness (5 checks x 2 paths)');
  console.log('  - GP3: Gate verdict determinism (2 checks x 2 paths)');
  console.log('  - GP4: Ladder and freshness compliance (4 checks x 2 paths)');
  console.log('  - GP5: Fail-closed integrity (3 checks x 2 paths)');
  console.log('  - CC-009..CC-013: Conformance checks (5 checks x 2 paths)');
  console.log('  - Conformance spec self-check (2 checks)');
  process.exit(0);
}
