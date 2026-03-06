# Stage 5 Implementation Map (Golden Paths and Conformance)

Maps to Canonical Build Plan Stage 6.

## Objectives

1. Define two executable golden-path specs: `code_change` and `mcp_tool`.
2. Each golden path traces the full lifecycle: classify -> research -> plan -> build -> verify -> complete.
3. Produce concrete artifact instances at every stage that conform to all prior specs.
4. Define conformance report spec: what must be true for a golden path to pass.
5. Validate that golden paths produce deterministic verification artifacts with complete evidence traces.

## Inputs (from Task 1, Stage 2, Stage 3, Stage 4)

1. `specs/task1/v1/runtime-state-machine-v1.json` (state transitions)
2. `specs/task1/v1/schemas/*.json` (artifact schemas)
3. `specs/task1/v1/VerifyMCP-contract.json` (verification rules)
4. `policy/v1/workflow_taxonomy.json` (ladders, checks, evidence types)
5. `policy/v1/routing_policy.json` (normal flows)
6. `specs/task3/v1/gate-sequence.json` (gate bindings)
7. `specs/task4/v1/verify-mcp-engine.json` (scoring algorithm)
8. `specs/task4/v1/evidence-registry.json` (evidence IDs, paths, hashing)
9. `specs/task4/v1/verifier-plugin-abi.json` (plugin interface)

## Stage 5 Deliverables

1. `specs/task5/v1/golden-path-code-change.json`
   - Full trace of a `code_change` workflow: add health-check endpoint.
   - Includes: ResearchReport, ExecutionPlan, BuildReport, evidence records, VerificationArtifact.
   - Every artifact instance conforms to its schema.
   - Every evidence_id resolves in the evidence registry.
   - Every criteria_id traces from plan through build to verification.

2. `specs/task5/v1/golden-path-mcp-tool.json`
   - Full trace of an `mcp_tool` workflow: add a new MCP tool server.
   - Same completeness requirements as code_change.

3. `specs/task5/v1/conformance-report-spec.json`
   - Defines what a conformance report must contain.
   - Checks: artifact schema conformance, evidence trace completeness, gate verdict determinism, ladder compliance, fail-closed integrity.

4. `specs/task5/v1/validate-task5.js`
   - Gate validator for Stage 5 artifacts (GP1-GP5).

## Stage 5 Gates

1. **Gate GP1: Schema Conformance**
   - Every artifact instance in each golden path validates against its schema.

2. **Gate GP2: Evidence Trace Completeness**
   - Every evidence_id in BuildReport.evidence_map has a corresponding evidence record.
   - Every criteria_id in ExecutionPlan.acceptance_criteria appears in BuildReport.evidence_map.
   - Every criteria_id appears in VerificationArtifact.criteria_results.

3. **Gate GP3: Gate Verdict Determinism**
   - Golden path state transitions match routing_policy normal_flow for the workflow class.
   - Each gate (G-001, G-002, G-003) fires at the correct state with the correct routing.

4. **Gate GP4: Ladder and Freshness Compliance**
   - VerificationArtifact ladder_compliance matches workflow_taxonomy ladder for the class.
   - Freshness results are consistent with verification_requirements.

5. **Gate GP5: Fail-Closed Integrity**
   - fail_closed_enforced is true on every VerificationArtifact.
   - overall_status is consistent with criteria_results (no pass if any required non-pass).
   - All FC rules hold.

## Exit Criteria

Stage 5 is complete when both golden paths pass all GP1-GP5 gates and produce deterministic, fully-traced verification artifacts.
