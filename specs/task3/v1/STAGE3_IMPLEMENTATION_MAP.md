# Stage 3 Implementation Map (Runtime Skeleton + Control Loops)

Maps to Canonical Build Plan Stage 4. Also completes the enforcement adapter spec from Stage 3.

## Objectives

1. Define how the runtime engine consumes the state machine spec and policies.
2. Specify mode switching (Chat, Build, Research+Build) with workflow class mapping.
3. Formalize the gate sequence binding verify gates to state transitions.
4. Specify the enforcement adapter that binds policy rules to runtime enforcement points.
5. Produce a standalone error-lane runbook for PlatformRecovery.
6. Extract loop controls into a standalone consumable config.

## Inputs (from Task 1 + Stage 2)

1. `specs/task1/v1/runtime-state-machine-v1.json`
2. `specs/task1/v1/role-authority-matrix.json`
3. `specs/task1/v1/VerifyMCP-contract.json`
4. `policy/v1/permissions_policy.json`
5. `policy/v1/routing_policy.json`
6. `policy/v1/workflow_taxonomy.json`

## Stage 3 Deliverables

1. `specs/task3/v1/runtime-modes.json`
   - Maps intent modes (chat, build, research_build) to workflow classes.
   - Defines mode selection triggers and transitions.
   - Binds autonomy mode defaults per mode.

2. `specs/task3/v1/gate-sequence.json`
   - Formal gate sequence binding: which verify gate fires at which state transition.
   - Required artifacts per gate.
   - Pass/fail/blocked routing per gate.

3. `specs/task3/v1/enforcement-adapter.json`
   - Maps each enforcement point (tool_allowlist, path_scope_guard, network_scope_guard, runtime_guard, verifier_gate) to runtime behavior.
   - Binds permissions_policy roles to concrete enforcement checks.
   - Defines enforcement failure behavior (deny + log + evidence).

4. `specs/task3/v1/error-lane-runbook.json`
   - PlatformRecovery runbook: actions, caps, exit conditions, health verification.
   - Error classification rules (workflow_error vs platform_error).
   - Recovery action catalog with bounds.

5. `specs/task3/v1/loop-control-config.json`
   - Standalone loop control configuration consumable by runtime.
   - Max iterations, max tool calls, retry caps, heartbeat policy.
   - Exceeded action routing.

6. `specs/task3/v1/validate-task3.js`
   - Gate validator for Stage 3 artifacts (R1-R5).

## Stage 3 Gates

1. **Gate R1: Enforcement Adapter Coverage**
   - Every role in permissions_policy has enforcement adapter entries.
   - Every enforcement point type has defined behavior.
   - Enforcement failure always produces deny + evidence.

2. **Gate R2: Mode-Workflow Mapping**
   - Every workflow class has at least one mode mapping.
   - Every mode maps to valid workflow classes from taxonomy.
   - Autonomy defaults per mode are valid enum values.

3. **Gate R3: Error Runbook Coverage**
   - Runbook covers all error types from state machine retry_caps.
   - Every runbook action has bounds (max_attempts, timeout).
   - Health verification is required before resume signal.

4. **Gate R4: Gate Sequence Alignment**
   - Every verify gate in state machine has a gate-sequence entry.
   - Required artifacts per gate reference valid schema types.
   - Gate routing matches state machine pass/fail/blocked transitions.

5. **Gate R5: Loop Control Completeness**
   - Every active state in state machine has loop limits.
   - Heartbeat policy covers all non-terminal states.
   - Exceeded action routes to valid state.

## Exit Criteria

Stage 3 is complete when all R1-R5 gates pass and runtime skeleton specs are consumable by a future runtime engine without ambiguity.
