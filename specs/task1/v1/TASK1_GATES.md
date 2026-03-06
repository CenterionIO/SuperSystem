# Task 1 Completion Gates v1

## Gate A: Schema Validation
- All example files validate against their paired JSON Schema (Draft 2020-12).
- AJV with strict: false and ajv-formats for uuid/date-time.

## Gate B: Ownership Conformance
- Every schema field path must exist in the paired standalone ownership file.
- Ownership files must not reference unknown schema field paths (no orphans).
- Every field must include non-empty `writtenBy`, `readableBy`, and `verifiedBy`.
- Ownership paths must use canonical JSON Pointer with standalone `[]` segments (`/steps/[]/field`).
- Non-canonical wildcard formats (e.g. `/steps[]/field`) fail.
- `echoedBy` and `writtenBy` must be mutually exclusive per role per field.
- `deny_by_default: true` must be set in each ownership file.

## Gate C: Orchestrator Boundary
- Orchestrator-written fields must not include plan content fields.
- Planner-written fields must not include routing/state mutation fields.
- PlanningRequest fields must all be `writtenBy: Orchestrator`.
- PlanningResponse plan content fields must be `writtenBy: Planner`.
- `correlation_id` provenance: `writtenBy: Orchestrator`, `echoedBy: Planner`, not `writtenBy: Planner`.
- OP-001 (Planner routing prohibition), OP-002 (Orchestrator plan prohibition), OP-003 (`value_equality` check on correlation_id) must exist.

## Gate D: Transition Mapping
- `validStates` enum must be defined.
- All verdicts (pass, warn, fail, blocked) have transition definitions.
- No wildcard (`*`) transitions (TC-003).
- All transition `from`/`to` values must be members of `validStates` (TC-001, TC-002).
- Every verify gate (G-001 through G-004) must have deterministic `pass_transition`, `fail_transition`, `blocked_transition`.
- Resume policies must reference valid states in `allowed_resume_targets` (TC-004).
- Transition constraints (TC-001 through TC-005) must be defined.
- Loop controls: max iterations per phase, max tool calls per phase, retry caps by error type, heartbeat/stall detection.

## Validator
- `validate-task1.js` runs all gates A-D (65 checks total).
- Requires `ajv` and `ajv-formats` (see `package.json`).
- Run: `node specs/task1/v1/validate-task1.js`
