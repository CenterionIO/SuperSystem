# Stage 2 Implementation Map (Policy + Enforcement)

Scope: Convert Task 1 contracts into enforceable policy/routing behavior without expanding runtime complexity.

## Objectives

1. Implement policy-as-data for routing, permissions, autonomy, and verification requirements.
2. Bind policy decisions to runtime enforcement points (not prompt-only behavior).
3. Produce machine-checkable outputs that integrate with Task 1 gates/contracts.

## Inputs (from Task 1)

1. `specs/task1/v1/role-authority-matrix.json`
2. `specs/task1/v1/orchestrator-planner-interface.json`
3. `specs/task1/v1/schemas/*`
4. `specs/task1/v1/ownership/*`
5. `specs/task1/v1/VerifyMCP-contract.json`
6. `specs/task1/v1/runtime-state-machine-v1.json`

## Stage 2 Deliverables

1. `policy/v1/workflow_taxonomy.json`
   - Maps each `workflow_class` to: required verification ladder, required checks, required evidence types, default autonomy mode, risk-tier defaults.

2. `policy/v1/permissions_policy.json`
   - Role-based allow/deny for tools, path scope, network scope, explicit deny defaults.

3. `policy/v1/routing_policy.json`
   - Deterministic route selection rules, rework routing rules, blocked evidence resume rules, fail-closed block.

4. `policy/v1/override_policy.json`
   - Conflict precedence order, council override conditions, required override evidence and audit metadata.

5. `policy/v1/policy_schema.json`
   - JSON Schema (Draft 2020-12) for all policy files with conditional validation per policy type.

6. `policy/v1/examples/*`
   - One valid example policy bundle per workflow class (6 total).

7. `tools/validate-stage2.js`
   - Validates policy bundle against `policy_schema.json`, verifies cross-file consistency, emits deterministic pass/fail report.

## Execution Order

1. Author `policy_schema.json` first.
2. Author `workflow_taxonomy.json` and `routing_policy.json`.
3. Author `permissions_policy.json` and `override_policy.json`.
4. Add policy examples.
5. Implement `validate-stage2.js`.
6. Run validator and fix until clean pass.

## Stage 2 Gates

1. **Gate P1: Policy Schema Validation**
   - All policy files validate against `policy_schema.json`.

2. **Gate P2: Cross-Policy Consistency**
   - Every workflow class in taxonomy has routing and permission entries.
   - Taxonomy ladders match VerifyMCP contract ladders.
   - Every required check type is a valid schema enum value.
   - All 7 roles exist in permissions and role-authority-matrix.
   - Every taxonomy class has a matching example with correct values.

3. **Gate P3: Enforcement Completeness**
   - Every role has non-empty `enforced_by`.
   - No tool in both `allowed_tools` and `denied_tools`.
   - Every role has read path scope and write path scope key.
   - Override policy has precedence and audit required_fields.

4. **Gate P4: Fail-Closed Preservation**
   - `required_warn_behavior` must be `blocked`.
   - `required_missing_check_behavior` must be `blocked`.
   - `required_warn_exception_requires_artifact` must be `true`.
   - Contract FC-001 and FC-002 rules must exist.
   - Council override conditions must reference fail-closed preservation.

5. **Gate P5: Boundary Preservation**
   - Planner must not have routing authority tools.
   - Orchestrator must not have plan authoring tools.
   - Builder, Research, VerifyMCP, PlatformRecovery boundary checks.
   - Denied tools must include forbidden tools explicitly.
   - `default_deny` must be `true`.

## Out of Scope (Stage 3)

1. Runtime engine changes beyond policy loading.
2. New MCP server behavior changes.
3. UI mode-toggle behavior changes.

## Exit Criteria

Stage 2 is complete when all P1-P5 gates pass and policy bundle can be consumed by runtime without schema or ownership conflicts.
