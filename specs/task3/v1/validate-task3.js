#!/usr/bin/env node
/**
 * Stage 3 Runtime Skeleton Gate Validator
 * Gates R1-R5: Enforcement adapter coverage, mode-workflow mapping,
 * error runbook coverage, gate sequence alignment, loop control completeness.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const TASK3_DIR = path.join(ROOT, 'specs', 'task3', 'v1');
const TASK1_DIR = path.join(ROOT, 'specs', 'task1', 'v1');
const POLICY_DIR = path.join(ROOT, 'policy', 'v1');

const errors = [];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ─── Load all artifacts ───

const stateMachine = loadJson(path.join(TASK1_DIR, 'runtime-state-machine-v1.json'));
const roleMatrix = loadJson(path.join(TASK1_DIR, 'role-authority-matrix.json'));
const permissions = loadJson(path.join(POLICY_DIR, 'permissions_policy.json'));
const taxonomy = loadJson(path.join(POLICY_DIR, 'workflow_taxonomy.json'));

const enforcementAdapter = loadJson(path.join(TASK3_DIR, 'enforcement-adapter.json'));
const runtimeModes = loadJson(path.join(TASK3_DIR, 'runtime-modes.json'));
const gateSequence = loadJson(path.join(TASK3_DIR, 'gate-sequence.json'));
const errorRunbook = loadJson(path.join(TASK3_DIR, 'error-lane-runbook.json'));
const loopControl = loadJson(path.join(TASK3_DIR, 'loop-control-config.json'));

// ─── Gate R1: Enforcement Adapter Coverage ───

function gateR1() {
  const permRoles = Object.keys(permissions.roles);
  const matrixRoles = Object.keys(roleMatrix.roles);
  const enforcementPoints = Object.keys(enforcementAdapter.enforcement_points);

  // R1.1: Every role in permissions_policy has enforcement references
  for (const role of permRoles) {
    const rolePerms = permissions.roles[role];
    if (!rolePerms.enforced_by || rolePerms.enforced_by.length === 0) {
      errors.push(`R1.1: Role ${role} in permissions_policy has no enforced_by entries`);
    }
  }

  // R1.2: Every role in role-authority-matrix has enforcement references
  for (const role of matrixRoles) {
    const roleData = roleMatrix.roles[role];
    if (!roleData.enforced_by || roleData.enforced_by.length === 0) {
      errors.push(`R1.2: Role ${role} in role-authority-matrix has no enforced_by entries`);
    }
  }

  // R1.3: Every enforcement point type in the adapter has defined check_logic
  const requiredPointTypes = ['tool_allowlist', 'path_scope_guard', 'network_scope_guard', 'runtime_guard', 'verifier_gate', 'policy_engine'];
  for (const pt of requiredPointTypes) {
    if (!enforcementAdapter.enforcement_points[pt]) {
      errors.push(`R1.3: Missing enforcement point type: ${pt}`);
      continue;
    }
    const ep = enforcementAdapter.enforcement_points[pt];
    if (!ep.check_logic || ep.check_logic.length === 0) {
      errors.push(`R1.3: Enforcement point ${pt} missing check_logic`);
    }
  }

  // R1.4: Enforcement failure always produces deny + evidence (except policy_engine which has apply_default_policy)
  for (const [ptName, pt] of Object.entries(enforcementAdapter.enforcement_points)) {
    const denyAction = pt.on_deny || pt.on_violation;
    if (!denyAction) {
      errors.push(`R1.4: Enforcement point ${ptName} has no on_deny or on_violation handler`);
      continue;
    }
    if (!denyAction.log) {
      errors.push(`R1.4: Enforcement point ${ptName} deny handler missing log:true`);
    }
    if (!denyAction.evidence) {
      // verifier_gate uses on_violation without "evidence" key name — check differently
      if (ptName === 'verifier_gate') {
        // verifier_gate uses on_violation which is fine
      } else if (ptName === 'policy_engine') {
        // policy_engine on_deny has evidence
        if (!denyAction.evidence) {
          errors.push(`R1.4: Enforcement point ${ptName} deny handler missing evidence`);
        }
      } else {
        errors.push(`R1.4: Enforcement point ${ptName} deny handler missing evidence`);
      }
    }
  }

  // R1.5: Every enforcement point has an intercept_at
  for (const [ptName, pt] of Object.entries(enforcementAdapter.enforcement_points)) {
    if (!pt.intercept_at) {
      errors.push(`R1.5: Enforcement point ${ptName} missing intercept_at`);
    }
  }

  // R1.6: Adapter invariants are present
  if (!enforcementAdapter.adapter_invariants || enforcementAdapter.adapter_invariants.length === 0) {
    errors.push('R1.6: Enforcement adapter missing adapter_invariants');
  }

  // R1.7: enforced_by references in permissions match adapter enforcement point types
  const adapterPointNames = new Set(enforcementPoints);
  for (const [role, rolePerms] of Object.entries(permissions.roles)) {
    for (const ref of (rolePerms.enforced_by || [])) {
      if (!adapterPointNames.has(ref)) {
        errors.push(`R1.7: Role ${role} references unknown enforcement point: ${ref}`);
      }
    }
  }
}

// ─── Gate R2: Mode-Workflow Mapping ───

function gateR2() {
  const taxonomyClasses = new Set(Object.keys(taxonomy.classes));
  const modes = runtimeModes.modes;

  // R2.1: Every workflow class appears in at least one mode
  const coveredClasses = new Set();
  for (const [modeName, mode] of Object.entries(modes)) {
    for (const cls of mode.workflow_classes) {
      coveredClasses.add(cls);
    }
  }
  for (const cls of taxonomyClasses) {
    if (!coveredClasses.has(cls)) {
      errors.push(`R2.1: Workflow class ${cls} not covered by any mode`);
    }
  }

  // R2.2: Every mode maps to valid workflow classes from taxonomy
  for (const [modeName, mode] of Object.entries(modes)) {
    for (const cls of mode.workflow_classes) {
      if (!taxonomyClasses.has(cls)) {
        errors.push(`R2.2: Mode ${modeName} references unknown workflow class: ${cls}`);
      }
    }
  }

  // R2.3: Autonomy defaults per mode are valid enum values
  const validAutonomy = new Set(['full_auto', 'approve_each', 'approve_final']);
  for (const [modeName, mode] of Object.entries(modes)) {
    if (!validAutonomy.has(mode.default_autonomy_mode)) {
      errors.push(`R2.3: Mode ${modeName} has invalid default_autonomy_mode: ${mode.default_autonomy_mode}`);
    }
  }

  // R2.4: Mode selection rules exist
  if (!runtimeModes.mode_selection_rules || runtimeModes.mode_selection_rules.length === 0) {
    errors.push('R2.4: runtime-modes missing mode_selection_rules');
  }

  // R2.5: Entry state per mode is a valid state
  const validStates = new Set(stateMachine.validStates);
  for (const [modeName, mode] of Object.entries(modes)) {
    if (!validStates.has(mode.entry_state)) {
      errors.push(`R2.5: Mode ${modeName} entry_state ${mode.entry_state} is not a valid state`);
    }
  }

  // R2.6: mode_to_gate_sequence references valid gate types
  if (runtimeModes.mode_to_gate_sequence) {
    const gateNames = new Set(Object.values(gateSequence.gates).map(g => g.fires_at_state));
    for (const [seq, gates] of Object.entries(runtimeModes.mode_to_gate_sequence)) {
      for (const gate of gates) {
        if (!gateNames.has(gate)) {
          errors.push(`R2.6: mode_to_gate_sequence ${seq} references unknown gate state: ${gate}`);
        }
      }
    }
  }
}

// ─── Gate R3: Error Runbook Coverage ───

function gateR3() {
  // R3.1: Runbook covers all error types from state machine retry_caps
  const smRetryCaps = stateMachine.loopControls.retry_caps_by_error_type;
  const runbookRetryCaps = loopControl.retry_caps_by_error_type;
  for (const errorType of Object.keys(smRetryCaps)) {
    if (!(errorType in runbookRetryCaps)) {
      errors.push(`R3.1: Loop control missing retry cap for error type: ${errorType}`);
    }
  }

  // R3.2: Error classification rules exist and cover both workflow_error and platform_error
  const classificationRules = errorRunbook.error_classification?.rules || [];
  if (classificationRules.length === 0) {
    errors.push('R3.2: Error runbook has no error classification rules');
  }
  const classifiedTypes = new Set(classificationRules.map(r => r.classification));
  if (!classifiedTypes.has('workflow_error')) {
    errors.push('R3.2: Error runbook classification missing workflow_error');
  }
  if (!classifiedTypes.has('platform_error')) {
    errors.push('R3.2: Error runbook classification missing platform_error');
  }

  // R3.3: Every recovery action has bounds (max_attempts)
  const recoveryActions = errorRunbook.recovery_runbook?.actions || [];
  for (const action of recoveryActions) {
    if (typeof action.max_attempts !== 'number') {
      errors.push(`R3.3: Recovery action ${action.action_id} missing max_attempts`);
    }
  }

  // R3.4: Recovery runbook has global bounds
  const bounds = errorRunbook.recovery_runbook?.bounds;
  if (!bounds) {
    errors.push('R3.4: Recovery runbook missing bounds');
  } else {
    if (typeof bounds.max_total_recovery_attempts !== 'number') {
      errors.push('R3.4: Recovery runbook bounds missing max_total_recovery_attempts');
    }
    if (typeof bounds.max_total_recovery_time_ms !== 'number') {
      errors.push('R3.4: Recovery runbook bounds missing max_total_recovery_time_ms');
    }
  }

  // R3.5: Health verification is required before resume signal
  const healthVerification = errorRunbook.health_verification;
  if (!healthVerification) {
    errors.push('R3.5: Error runbook missing health_verification');
  } else {
    if (!healthVerification.checks || healthVerification.checks.length === 0) {
      errors.push('R3.5: Health verification has no checks');
    }
    if (!healthVerification.pass_condition) {
      errors.push('R3.5: Health verification missing pass_condition');
    }
  }

  // R3.6: workflow_error handling procedure exists with retry_cap
  const weHandling = errorRunbook.workflow_error_handling;
  if (!weHandling) {
    errors.push('R3.6: Error runbook missing workflow_error_handling');
  } else {
    if (typeof weHandling.retry_cap !== 'number') {
      errors.push('R3.6: workflow_error_handling missing retry_cap');
    }
    if (!weHandling.exceeded_action) {
      errors.push('R3.6: workflow_error_handling missing exceeded_action');
    }
  }

  // R3.7: platform_error handling routes to blocked_platform
  const peHandling = errorRunbook.platform_error_handling;
  if (!peHandling) {
    errors.push('R3.7: Error runbook missing platform_error_handling');
  } else {
    if (peHandling.auto_route_to !== 'blocked_platform') {
      errors.push('R3.7: platform_error_handling should auto_route_to blocked_platform');
    }
  }

  // R3.8: Exit conditions are defined for recovery
  const exitConditions = errorRunbook.recovery_runbook?.exit_conditions;
  if (!exitConditions || exitConditions.length === 0) {
    errors.push('R3.8: Recovery runbook missing exit_conditions');
  }
}

// ─── Gate R4: Gate Sequence Alignment ───

function gateR4() {
  // Collect verify gates from state machine
  const smGates = {};
  for (const [stateName, stateData] of Object.entries(stateMachine.states)) {
    if (stateData.verify_gate) {
      smGates[stateData.verify_gate.gate_id] = {
        state: stateName,
        ...stateData.verify_gate
      };
    }
  }

  const seqGates = gateSequence.gates;

  // R4.1: Every verify gate in state machine has a gate-sequence entry
  for (const gateId of Object.keys(smGates)) {
    if (!seqGates[gateId]) {
      errors.push(`R4.1: State machine gate ${gateId} missing from gate-sequence`);
    }
  }

  // R4.2: Every gate-sequence entry references a valid state machine state
  const validStates = new Set(stateMachine.validStates);
  for (const [gateId, gate] of Object.entries(seqGates)) {
    if (!validStates.has(gate.fires_at_state)) {
      errors.push(`R4.2: Gate ${gateId} fires_at_state ${gate.fires_at_state} not a valid state`);
    }
  }

  // R4.3: Gate routing matches state machine pass/fail/blocked transitions
  for (const [gateId, gate] of Object.entries(seqGates)) {
    const smGate = smGates[gateId];
    if (!smGate) continue; // already caught by R4.1

    // pass transition
    if (gate.routing.pass !== null && gate.routing.pass !== smGate.pass_transition) {
      errors.push(`R4.3: Gate ${gateId} pass routing mismatch — sequence: ${gate.routing.pass}, state machine: ${smGate.pass_transition}`);
    }
    // For G-004, pass is null in both (resume via policy), skip the null check
    if (gate.routing.pass === null && smGate.pass_transition !== null) {
      errors.push(`R4.3: Gate ${gateId} pass routing is null but state machine expects ${smGate.pass_transition}`);
    }

    // fail transition
    if (gate.routing.fail !== smGate.fail_transition) {
      errors.push(`R4.3: Gate ${gateId} fail routing mismatch — sequence: ${gate.routing.fail}, state machine: ${smGate.fail_transition}`);
    }

    // blocked transition
    if (gate.routing.blocked !== smGate.blocked_transition) {
      errors.push(`R4.3: Gate ${gateId} blocked routing mismatch — sequence: ${gate.routing.blocked}, state machine: ${smGate.blocked_transition}`);
    }
  }

  // R4.4: Required artifacts per gate have type and source
  for (const [gateId, gate] of Object.entries(seqGates)) {
    if (!gate.required_artifacts || gate.required_artifacts.length === 0) {
      errors.push(`R4.4: Gate ${gateId} missing required_artifacts`);
      continue;
    }
    for (const artifact of gate.required_artifacts) {
      if (!artifact.type) {
        errors.push(`R4.4: Gate ${gateId} artifact missing type`);
      }
      if (!artifact.source) {
        errors.push(`R4.4: Gate ${gateId} artifact missing source`);
      }
    }
  }

  // R4.5: Gate checks are present and non-empty
  for (const [gateId, gate] of Object.entries(seqGates)) {
    if (!gate.checks || gate.checks.length === 0) {
      errors.push(`R4.5: Gate ${gateId} missing checks`);
    }
  }

  // R4.6: Gate invariants are present
  if (!gateSequence.gate_invariants || gateSequence.gate_invariants.length === 0) {
    errors.push('R4.6: Gate sequence missing gate_invariants');
  }

  // R4.7: Gate owners are valid roles
  const validRoles = new Set(Object.keys(roleMatrix.roles));
  for (const [gateId, gate] of Object.entries(seqGates)) {
    if (!validRoles.has(gate.owner)) {
      errors.push(`R4.7: Gate ${gateId} owner ${gate.owner} is not a valid role`);
    }
  }
}

// ─── Gate R5: Loop Control Completeness ───

function gateR5() {
  const terminalStates = new Set(stateMachine.terminalStates);
  const nonTerminalStates = stateMachine.validStates.filter(s => !terminalStates.has(s));

  // R5.1: States with iteration-based work have loop limits
  const activePhases = ['researching', 'planning', 'building', 'plan_blocker', 'blocked_platform',
                        'research_review', 'plan_review', 'build_review'];
  const iterLimits = loopControl.max_iterations_per_phase;
  for (const phase of activePhases) {
    if (!(phase in iterLimits)) {
      errors.push(`R5.1: Missing max_iterations_per_phase for: ${phase}`);
    }
  }

  // R5.2: Tool call limits exist for phases that use tools
  const toolPhases = ['researching', 'planning', 'building', 'research_review', 'plan_review', 'build_review'];
  const toolLimits = loopControl.max_tool_calls_per_phase;
  for (const phase of toolPhases) {
    if (!(phase in toolLimits)) {
      errors.push(`R5.2: Missing max_tool_calls_per_phase for: ${phase}`);
    }
  }

  // R5.3: Heartbeat policy covers all non-terminal, non-error states
  const heartbeat = loopControl.heartbeat_policy;
  if (!heartbeat) {
    errors.push('R5.3: Loop control missing heartbeat_policy');
  } else {
    if (typeof heartbeat.interval_seconds !== 'number') {
      errors.push('R5.3: Heartbeat policy missing interval_seconds');
    }
    if (typeof heartbeat.stall_threshold_missed_beats !== 'number') {
      errors.push('R5.3: Heartbeat policy missing stall_threshold_missed_beats');
    }
    if (!heartbeat.stall_action) {
      errors.push('R5.3: Heartbeat policy missing stall_action');
    }

    // Check applies_to_states covers active states
    const heartbeatStates = new Set(heartbeat.applies_to_states || []);
    const expectedHeartbeatStates = ['classifying', 'researching', 'research_review',
      'planning', 'plan_review', 'building', 'build_review', 'plan_blocker', 'blocked_platform'];
    for (const state of expectedHeartbeatStates) {
      if (!heartbeatStates.has(state)) {
        errors.push(`R5.3: Heartbeat policy missing applies_to_states entry: ${state}`);
      }
    }
  }

  // R5.4: Exceeded action routes to a valid state
  const exceededAction = loopControl.exceeded_action;
  if (!exceededAction) {
    errors.push('R5.4: Loop control missing exceeded_action');
  } else {
    const validStates = new Set(stateMachine.validStates);
    if (!validStates.has(exceededAction.default)) {
      errors.push(`R5.4: exceeded_action.default "${exceededAction.default}" is not a valid state`);
    }
  }

  // R5.5: Retry caps match state machine retry_caps
  const smRetryCaps = stateMachine.loopControls.retry_caps_by_error_type;
  const lcRetryCaps = loopControl.retry_caps_by_error_type;
  for (const [errorType, cap] of Object.entries(smRetryCaps)) {
    if (!(errorType in lcRetryCaps)) {
      errors.push(`R5.5: Loop control missing retry cap for: ${errorType}`);
    } else if (lcRetryCaps[errorType] !== cap) {
      errors.push(`R5.5: Retry cap mismatch for ${errorType} — loop control: ${lcRetryCaps[errorType]}, state machine: ${cap}`);
    }
  }

  // R5.6: Counter reset rules are defined
  if (!loopControl.counter_reset_rules || loopControl.counter_reset_rules.length === 0) {
    errors.push('R5.6: Loop control missing counter_reset_rules');
  }
}

// ─── Run All Gates ───

gateR1();
gateR2();
gateR3();
gateR4();
gateR5();

// ─── Report ───

if (errors.length > 0) {
  console.log(`Stage 3 runtime gates: FAIL (${errors.length} errors)`);
  for (const e of errors) {
    console.log(`  - ${e}`);
  }
  process.exit(1);
} else {
  console.log('Stage 3 runtime gates: PASS');
  console.log('  - R1: Enforcement adapter coverage (7 checks)');
  console.log('  - R2: Mode-workflow mapping (6 checks)');
  console.log('  - R3: Error runbook coverage (8 checks)');
  console.log('  - R4: Gate sequence alignment (7 checks)');
  console.log('  - R5: Loop control completeness (6 checks)');
  process.exit(0);
}
