# Stage 4 Implementation Map (Verification Backbone)

Maps to Canonical Build Plan Stage 5.

## Objectives

1. Specify the Verify MCP scoring engine: how it consumes criteria, evidence, and produces verdicts.
2. Define the verifier plugin ABI: input/output schema, timeout/resource policy, capability flags, sandbox requirements.
3. Specify the evidence registry: canonical paths, deterministic naming, hash points, evidence ID resolution.
4. Bind all three to the existing VerifyMCP contract, gate sequence, and enforcement adapter.

## Inputs (from Task 1, Stage 2, Stage 3)

1. `specs/task1/v1/VerifyMCP-contract.json`
2. `specs/task1/v1/schemas/VerificationArtifact.json`
3. `specs/task1/v1/schemas/BuildReport.json`
4. `specs/task1/v1/schemas/ExecutionPlan.json`
5. `specs/task3/v1/gate-sequence.json`
6. `policy/v1/workflow_taxonomy.json`

## Stage 4 Deliverables

1. `specs/task4/v1/verify-mcp-engine.json`
   - Scoring algorithm: criteria iteration, evidence resolution, status aggregation.
   - Fail-closed enforcement logic.
   - Ladder compliance verification.
   - Freshness check integration.
   - Overall status computation rules.

2. `specs/task4/v1/verifier-plugin-abi.json`
   - Plugin input/output schema.
   - Timeout and resource policy.
   - Capability flags (requires_web, requires_fs, requires_network, etc.).
   - Sandbox/permissions requirements.
   - Plugin lifecycle (load, execute, teardown).
   - Error handling and fallback behavior.

3. `specs/task4/v1/evidence-registry.json`
   - Canonical evidence path format.
   - Deterministic naming convention.
   - Hash points (when and how to hash evidence).
   - Evidence ID generation rules.
   - Evidence types and their storage requirements.
   - Evidence lookup and resolution protocol.
   - Retention and immutability rules.

4. `specs/task4/v1/validate-task4.js`
   - Gate validator for Stage 4 artifacts (V1-V5).

## Stage 4 Gates

1. **Gate V1: Engine-Contract Alignment**
   - Scoring engine references all check types from VerifyMCP contract.
   - Fail-closed rules (FC-001 through FC-005) are implemented in engine logic.
   - Overall status computation matches contract semantics.

2. **Gate V2: Ladder Coverage**
   - Engine ladder compliance covers all workflow classes from taxonomy.
   - Every ladder step maps to a valid check type.
   - Empty ladder (transcription) handling is defined.

3. **Gate V3: Plugin ABI Completeness**
   - Plugin ABI has input/output schema definitions.
   - Timeout and resource policies are bounded.
   - Capability flags cover all check types that need external access.
   - Error handling produces valid verification statuses.

4. **Gate V4: Evidence Registry Integrity**
   - Evidence types cover all required_evidence_types from taxonomy.
   - Path format is deterministic and collision-free.
   - Hash algorithm is specified.
   - Evidence ID generation is defined.
   - Retention policy exists.

5. **Gate V5: Cross-Artifact Binding**
   - Evidence IDs in engine flow match evidence registry ID format.
   - Plugin ABI output maps to criteria_results in VerificationArtifact.
   - Gate sequence required_artifacts align with engine inputs.

## Exit Criteria

Stage 4 is complete when all V1-V5 gates pass and the verification backbone is fully specified from evidence production through scoring to verdict output.
