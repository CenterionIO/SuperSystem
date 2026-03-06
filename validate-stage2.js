#!/usr/bin/env node
/**
 * Stage 2 Policy Gate Validator
 * Gates P1-P5: Schema validation, cross-consistency, enforcement completeness,
 * fail-closed preservation, boundary preservation.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ROOT = path.join(__dirname);
const POLICY_DIR = path.join(ROOT, 'policy', 'v1');
const EXAMPLES_DIR = path.join(POLICY_DIR, 'examples');
const CONTRACT_PATH = path.join(ROOT, 'contracts', 'v1', 'VerifyMCP-contract.json');
const ROLE_MATRIX_PATH = path.join(ROOT, 'task1', 'role-authority-matrix.json');

const errors = [];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ─── Load all artifacts ───

const policySchema = loadJson(path.join(POLICY_DIR, 'policy_schema.json'));
const taxonomy = loadJson(path.join(POLICY_DIR, 'workflow_taxonomy.json'));
const routing = loadJson(path.join(POLICY_DIR, 'routing_policy.json'));
const permissions = loadJson(path.join(POLICY_DIR, 'permissions_policy.json'));
const override = loadJson(path.join(POLICY_DIR, 'override_policy.json'));
const contract = loadJson(CONTRACT_PATH);
const roleMatrix = loadJson(ROLE_MATRIX_PATH);

const policyFiles = [
  { name: 'workflow_taxonomy.json', data: taxonomy },
  { name: 'routing_policy.json', data: routing },
  { name: 'permissions_policy.json', data: permissions },
  { name: 'override_policy.json', data: override },
];

// ─── Gate P1: Schema Validation ───

function gateP1() {
  const schemaCopy = JSON.parse(JSON.stringify(policySchema));
  delete schemaCopy.$schema; // AJV handles meta-schema internally

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schemaCopy);

  for (const { name, data } of policyFiles) {
    const valid = validate(data);
    if (!valid) {
      for (const err of validate.errors) {
        const loc = err.instancePath || '/';
        errors.push(`P1 schema: ${name} invalid at ${loc}: ${err.message}`);
      }
    }
  }
}

// ─── Gate P2: Cross-Policy Consistency ───

function gateP2() {
  const taxonomyClasses = new Set(Object.keys(taxonomy.classes));
  const routingClasses = new Set(Object.keys(routing.classes));

  // Taxonomy ↔ Routing class alignment
  for (const cls of taxonomyClasses) {
    if (!routingClasses.has(cls)) {
      errors.push(`P2 consistency: missing routing class: ${cls}`);
    }
  }
  for (const cls of routingClasses) {
    if (!taxonomyClasses.has(cls)) {
      errors.push(`P2 consistency: routing has unknown class: ${cls}`);
    }
  }

  // Taxonomy ladder must match contract ladders
  const contractLadders = contract.verificationLadder?.ladders || {};
  for (const [cls, cfg] of Object.entries(taxonomy.classes)) {
    const contractLadder = contractLadders[cls];
    if (contractLadder) {
      const taxLadder = JSON.stringify(cfg.verification_ladder);
      const conLadder = JSON.stringify(contractLadder);
      if (taxLadder !== conLadder) {
        errors.push(`P2 consistency: ${cls} ladder mismatch — taxonomy: ${taxLadder}, contract: ${conLadder}`);
      }
    }
  }

  // Check types must be valid schema enum values
  const validCheckTypes = new Set(policySchema.$defs.check_type.enum);
  for (const [cls, cfg] of Object.entries(taxonomy.classes)) {
    for (const check of cfg.required_checks) {
      if (!validCheckTypes.has(check)) {
        errors.push(`P2 consistency: class ${cls} uses unknown check type: ${check}`);
      }
    }
  }

  // All 7 roles must exist in permissions
  const requiredRoles = new Set(policySchema.$defs.role.enum);
  const presentRoles = new Set(Object.keys(permissions.roles));
  for (const role of requiredRoles) {
    if (!presentRoles.has(role)) {
      errors.push(`P2 consistency: missing role permissions for: ${role}`);
    }
  }

  // All 7 roles must exist in role-authority-matrix
  const matrixRoles = new Set(Object.keys(roleMatrix.roles));
  for (const role of requiredRoles) {
    if (!matrixRoles.has(role)) {
      errors.push(`P2 consistency: missing role in authority matrix: ${role}`);
    }
  }

  // Validate examples
  const exampleFiles = fs.readdirSync(EXAMPLES_DIR).filter(f => f.endsWith('.json')).sort();
  for (const exFile of exampleFiles) {
    const ex = loadJson(path.join(EXAMPLES_DIR, exFile));
    const cls = ex.workflow_class;

    if (!taxonomy.classes[cls]) {
      errors.push(`P2 examples: ${exFile} unknown workflow_class ${cls}`);
      continue;
    }

    const t = taxonomy.classes[cls];
    const r = routing.classes[cls];

    if (JSON.stringify(ex.selected_ladder) !== JSON.stringify(t.verification_ladder)) {
      errors.push(`P2 examples: ${exFile} ladder mismatch`);
    }
    if (ex.selected_autonomy_mode !== t.default_autonomy_mode) {
      errors.push(`P2 examples: ${exFile} autonomy mismatch`);
    }
    if (ex.selected_risk_tier !== t.default_risk_tier) {
      errors.push(`P2 examples: ${exFile} risk tier mismatch`);
    }
    if (ex.selected_route.blocked_evidence_route !== r.blocked_evidence_route) {
      errors.push(`P2 examples: ${exFile} blocked route mismatch`);
    }
    if (ex.selected_route.escalation_route !== r.escalation_route) {
      errors.push(`P2 examples: ${exFile} escalation route mismatch`);
    }
    if (JSON.stringify(ex.selected_route.normal_flow) !== JSON.stringify(r.normal_flow)) {
      errors.push(`P2 examples: ${exFile} normal_flow mismatch`);
    }
  }

  // Every taxonomy class should have a corresponding example
  for (const cls of taxonomyClasses) {
    const expectedFile = `${cls}.policy_example.json`;
    if (!exampleFiles.includes(expectedFile)) {
      errors.push(`P2 examples: missing example for class ${cls}`);
    }
  }
}

// ─── Gate P3: Enforcement Completeness ───

function gateP3() {
  for (const [role, cfg] of Object.entries(permissions.roles)) {
    if (!cfg.enforced_by || cfg.enforced_by.length === 0) {
      errors.push(`P3 enforcement: role ${role} missing enforced_by`);
    }

    // No tool in both allowed and denied
    const allowedSet = new Set(cfg.allowed_tools);
    for (const tool of cfg.denied_tools) {
      if (allowedSet.has(tool)) {
        errors.push(`P3 enforcement: role ${role} tool both allowed and denied: ${tool}`);
      }
    }

    // Must have read path scope
    if (!cfg.path_scope || !cfg.path_scope.read || cfg.path_scope.read.length === 0) {
      errors.push(`P3 enforcement: role ${role} missing read path scope`);
    }

    // Must have write key (can be empty array for read-only roles)
    if (!cfg.path_scope || !('write' in cfg.path_scope)) {
      errors.push(`P3 enforcement: role ${role} missing write path scope`);
    }

    // Must have network_scope
    if (!cfg.network_scope) {
      errors.push(`P3 enforcement: role ${role} missing network_scope`);
    }
  }

  // Override policy must have precedence
  if (!override.precedence || override.precedence.length === 0) {
    errors.push('P3 enforcement: override precedence missing');
  }

  // Override audit must have required_fields
  if (!override.audit_requirements || !override.audit_requirements.required_fields || override.audit_requirements.required_fields.length === 0) {
    errors.push('P3 enforcement: override audit_requirements.required_fields missing');
  }
}

// ─── Gate P4: Fail-Closed Preservation ───

function gateP4() {
  const fc = routing.fail_closed;
  if (!fc) {
    errors.push('P4 fail-closed: routing_policy missing fail_closed block');
    return;
  }

  if (fc.required_warn_behavior !== 'blocked') {
    errors.push('P4 fail-closed: required_warn_behavior must be "blocked"');
  }
  if (fc.required_missing_check_behavior !== 'blocked') {
    errors.push('P4 fail-closed: required_missing_check_behavior must be "blocked"');
  }
  if (fc.required_warn_exception_requires_artifact !== true) {
    errors.push('P4 fail-closed: required_warn_exception_requires_artifact must be true');
  }

  // Cross-check with VerifyMCP contract FC rules
  const fcRules = contract.failClosedRules || [];
  const fc001 = fcRules.find(r => r.id === 'FC-001');
  const fc002 = fcRules.find(r => r.id === 'FC-002');
  if (!fc001) {
    errors.push('P4 fail-closed: contract missing FC-001 rule');
  }
  if (!fc002) {
    errors.push('P4 fail-closed: contract missing FC-002 rule');
  }

  // Council override must not violate fail-closed
  if (override.council_override?.enabled) {
    const conditions = override.council_override.allowed_when || [];
    const hasNoFcViolation = conditions.some(c => c.toLowerCase().includes('fail_closed'));
    if (!hasNoFcViolation) {
      errors.push('P4 fail-closed: council_override.allowed_when should reference fail_closed_rule preservation');
    }
  }
}

// ─── Gate P5: Boundary Preservation ───

function gateP5() {
  const plannerAllowed = new Set(permissions.roles.Planner?.allowed_tools || []);
  const orchestratorAllowed = new Set(permissions.roles.Orchestrator?.allowed_tools || []);
  const builderAllowed = new Set(permissions.roles.Builder?.allowed_tools || []);
  const researchAllowed = new Set(permissions.roles.Research?.allowed_tools || []);
  const verifyAllowed = new Set(permissions.roles.VerifyMCP?.allowed_tools || []);
  const platformAllowed = new Set(permissions.roles.PlatformRecovery?.allowed_tools || []);

  // Planner must NOT have routing authority
  const forbiddenPlannerRouting = ['orchestrator.route', 'orchestrator.submit_request', 'orchestrator.classify', 'orchestrator.transition'];
  for (const tool of forbiddenPlannerRouting) {
    if (plannerAllowed.has(tool)) {
      errors.push(`P5 boundary: Planner has routing authority tool: ${tool}`);
    }
  }

  // Orchestrator must NOT have plan authoring
  const forbiddenOrchestratorAuthoring = ['planner.author_plan', 'planner.patch_plan'];
  for (const tool of forbiddenOrchestratorAuthoring) {
    if (orchestratorAllowed.has(tool)) {
      errors.push(`P5 boundary: Orchestrator has plan authoring tool: ${tool}`);
    }
  }

  // Builder must NOT have plan authoring or routing
  for (const tool of ['planner.author_plan', 'orchestrator.route', 'orchestrator.classify']) {
    if (builderAllowed.has(tool)) {
      errors.push(`P5 boundary: Builder has forbidden tool: ${tool}`);
    }
  }

  // Research must NOT have build or routing tools
  for (const tool of ['builder.execute', 'orchestrator.route', 'planner.author_plan']) {
    if (researchAllowed.has(tool)) {
      errors.push(`P5 boundary: Research has forbidden tool: ${tool}`);
    }
  }

  // VerifyMCP must NOT have build or plan authoring tools
  for (const tool of ['builder.execute', 'planner.author_plan', 'orchestrator.route']) {
    if (verifyAllowed.has(tool)) {
      errors.push(`P5 boundary: VerifyMCP has forbidden tool: ${tool}`);
    }
  }

  // PlatformRecovery must NOT have plan, build, verify, or routing tools
  for (const tool of ['planner.author_plan', 'builder.execute', 'verify.run', 'orchestrator.route']) {
    if (platformAllowed.has(tool)) {
      errors.push(`P5 boundary: PlatformRecovery has forbidden tool: ${tool}`);
    }
  }

  // Cross-check: Planner denied_tools should include routing tools
  const plannerDenied = new Set(permissions.roles.Planner?.denied_tools || []);
  if (!plannerDenied.has('orchestrator.route')) {
    errors.push('P5 boundary: Planner denied_tools should include orchestrator.route');
  }
  if (!plannerDenied.has('orchestrator.submit_request')) {
    errors.push('P5 boundary: Planner denied_tools should include orchestrator.submit_request');
  }

  // Cross-check: Orchestrator denied_tools should include planner.author_plan
  const orchestratorDenied = new Set(permissions.roles.Orchestrator?.denied_tools || []);
  if (!orchestratorDenied.has('planner.author_plan')) {
    errors.push('P5 boundary: Orchestrator denied_tools should include planner.author_plan');
  }

  // Permissions default_deny must be true
  if (permissions.default_deny !== true) {
    errors.push('P5 boundary: permissions_policy.default_deny must be true');
  }
}

// ─── Run All Gates ───

gateP1();
gateP2();
gateP3();
gateP4();
gateP5();

// ─── Report ───

if (errors.length > 0) {
  console.log('Stage 2 policy gates: FAIL');
  for (const e of errors) {
    console.log(`  - ${e}`);
  }
  process.exit(1);
} else {
  const checkCount = 5; // gates
  console.log('Stage 2 policy gates: PASS');
  console.log('  - P1: Policy schema validation');
  console.log('  - P2: Cross-policy consistency + examples');
  console.log('  - P3: Enforcement completeness');
  console.log('  - P4: Fail-closed preservation');
  console.log('  - P5: Boundary preservation');
  process.exit(0);
}
