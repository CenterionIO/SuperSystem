#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const ROOT = path.join(__dirname, '..', '..', '..');
const TASK6_DIR = path.join(ROOT, 'specs', 'task6', 'v1');
const errors = [];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function createValidator(schema) {
  const schemaCopy = JSON.parse(JSON.stringify(schema));
  delete schemaCopy.$schema;
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schemaCopy);
}

function gateS61Presence() {
  const required = [
    'STAGE6_IMPLEMENTATION_MAP.md',
    'escalation-ui-contract.json',
    'autonomy-modes-policy.json',
    'escalation-ui-contract.schema.json',
    'autonomy-modes-policy.schema.json',
    'status-view-contract.schema.json',
    'validate-task6.js'
  ];
  for (const name of required) {
    const p = path.join(TASK6_DIR, name);
    if (!fs.existsSync(p)) {
      errors.push(`S6-1 missing file: ${name}`);
    }
  }
}

function gateS62EscalationSchema() {
  const schema = loadJson(path.join(TASK6_DIR, 'escalation-ui-contract.schema.json'));
  const doc = loadJson(path.join(TASK6_DIR, 'escalation-ui-contract.json'));
  const validate = createValidator(schema);
  if (!validate(doc)) {
    for (const err of validate.errors || []) {
      errors.push(`S6-2 escalation-ui-contract invalid at ${err.instancePath || '/'}: ${err.message}`);
    }
  }
}

function gateS63AutonomySchema() {
  const schema = loadJson(path.join(TASK6_DIR, 'autonomy-modes-policy.schema.json'));
  const doc = loadJson(path.join(TASK6_DIR, 'autonomy-modes-policy.json'));
  const validate = createValidator(schema);
  if (!validate(doc)) {
    for (const err of validate.errors || []) {
      errors.push(`S6-3 autonomy-modes-policy invalid at ${err.instancePath || '/'}: ${err.message}`);
    }
  }
}

function gateS64CrossConsistency() {
  const escalation = loadJson(path.join(TASK6_DIR, 'escalation-ui-contract.json'));
  const autonomy = loadJson(path.join(TASK6_DIR, 'autonomy-modes-policy.json'));

  const requiredModes = ['approve_each', 'approve_final', 'full_auto'];
  for (const mode of requiredModes) {
    if (!autonomy.modes || !autonomy.modes[mode]) {
      errors.push(`S6-5 missing autonomy mode: ${mode}`);
      continue;
    }
    const gate = autonomy.modes[mode].gate_application || {};
    for (const reviewGate of ['research_review', 'plan_review', 'build_review']) {
      if (!['auto', 'manual'].includes(gate[reviewGate])) {
        errors.push(`S6-5 ${mode}.${reviewGate} must be auto|manual`);
      }
    }
  }

  const uiActions = new Set(escalation.response.actions || []);
  for (const mode of requiredModes) {
    const modeActions = (autonomy.modes?.[mode]?.escalation_actions) || [];
    for (const action of modeActions) {
      if (!uiActions.has(action)) {
        errors.push(`S6-5 action mismatch: ${mode} references unknown escalation action ${action}`);
      }
    }
  }
}

function gateS64StatusViewSchema() {
  const schema = loadJson(path.join(TASK6_DIR, 'status-view-contract.schema.json'));

  // Required fields must be declared
  const reqFields = ['correlation_id', 'workflow_class', 'autonomy_mode', 'current_state', 'last_transition_at', 'blocked_reason', 'next_action'];
  for (const f of reqFields) {
    if (!schema.required || !schema.required.includes(f)) {
      errors.push(`S6-4 status-view-contract.schema.json missing required field: ${f}`);
    }
    if (!schema.properties || !schema.properties[f]) {
      errors.push(`S6-4 status-view-contract.schema.json missing property definition: ${f}`);
    }
  }

  // blocked_reason must accept null
  if (schema.properties && schema.properties.blocked_reason) {
    const br = schema.properties.blocked_reason;
    const types = Array.isArray(br.type) ? br.type : [br.type];
    if (!types.includes('null')) {
      errors.push('S6-4 blocked_reason must accept null');
    }
  }

  // Validate a sample payload compiles and passes
  const validate = createValidator(schema);
  const sample = {
    correlation_id: '00000000-0000-0000-0000-000000000000',
    workflow_class: 'code_change',
    autonomy_mode: 'approve_final',
    current_state: 'building',
    last_transition_at: '2026-01-01T00:00:00.000Z',
    blocked_reason: null,
    next_action: 'await build completion'
  };
  if (!validate(sample)) {
    for (const err of validate.errors || []) {
      errors.push(`S6-4 sample payload failed: ${err.instancePath || '/'}: ${err.message}`);
    }
  }

  // Validate blocked payload
  const blockedSample = {
    correlation_id: '00000000-0000-0000-0000-000000000001',
    workflow_class: 'ops_fix',
    autonomy_mode: 'approve_each',
    current_state: 'escalation',
    last_transition_at: '2026-01-01T00:00:00.000Z',
    blocked_reason: 'Retry cap exceeded',
    next_action: 'reviewer must approve or reject'
  };
  if (!validate(blockedSample)) {
    for (const err of validate.errors || []) {
      errors.push(`S6-4 blocked sample failed: ${err.instancePath || '/'}: ${err.message}`);
    }
  }
}

function gateS65CiFailClosed() {
  // This validator itself is the CI contract: any error must return non-zero.
  if (errors.length > 0) {
    return;
  }
  // Deterministic assertion that both contracts are versioned.
  const escalation = loadJson(path.join(TASK6_DIR, 'escalation-ui-contract.json'));
  const autonomy = loadJson(path.join(TASK6_DIR, 'autonomy-modes-policy.json'));
  if (escalation.version !== 'v1' || autonomy.version !== 'v1') {
    errors.push('S6-6 fail-closed: contract version must be v1');
  }
}

function main() {
  gateS61Presence();
  if (errors.length === 0) {
    gateS62EscalationSchema();
    gateS63AutonomySchema();
    gateS64CrossConsistency();
    gateS64StatusViewSchema();
    gateS65CiFailClosed();
  }

  if (errors.length > 0) {
    console.log('Stage 6 gates: FAIL');
    for (const err of errors) console.log(`- ${err}`);
    process.exit(1);
  }

  console.log('Stage 6 gates: PASS');
  console.log('- S6-1: presence gate');
  console.log('- S6-2: escalation contract schema gate');
  console.log('- S6-3: autonomy policy schema gate');
  console.log('- S6-4: status-view-contract schema gate');
  console.log('- S6-5: cross-contract consistency gate');
  console.log('- S6-6: CI fail-closed gate');
}

main();
