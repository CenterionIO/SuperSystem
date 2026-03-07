# Verify MCP Contract v1

Canonical contract surface for the SuperSystem verification authority.

**Canonical source:** `contracts/v1/` (this directory)
**Legacy reference:** `specs/task1/v1/VerifyMCP-contract.json` (non-canonical, retained for compatibility)

## Status Taxonomy

| Status    | Meaning |
|-----------|---------|
| `pass`    | All required checks satisfied. Workflow may proceed. |
| `warn`    | All required checks pass; one or more optional checks produced warnings. Workflow may proceed. Rationale artifact required. |
| `fail`    | One or more required checks failed with evidence. Workflow cannot proceed. Requires rework. |
| `blocked` | Required evidence or checks are missing entirely. Fail-closed default. Workflow cannot proceed until evidence is supplied. |

**Invariant:** No status outside `{pass, warn, fail, blocked}` is valid. Unknown statuses are treated as `blocked`.

## Fail-Closed Semantics

| Rule   | Description |
|--------|-------------|
| FC-001 | Required criterion without verification result → `blocked` |
| FC-002 | Required criterion with `warn` → `blocked` unless policy exception with rationale artifact exists |
| FC-003 | `overall_status` cannot be `pass` if any required criterion is not `pass` |
| FC-004 | `fail_closed_enforced` must be `true` on every VerificationArtifact |
| FC-005 | Freshness check failure on time-sensitive claim → `fail` (not `warn`) |

## Warn Semantics

- A `warn` on a **required** criterion is promoted to `blocked` (FC-002)
- A `warn` on an **optional** criterion allows the workflow to continue
- `overall_status: warn` means all required criteria passed but optional criteria produced warnings
- `warn` is treated as **non-failure** in proof verdict and final run status

## Evidence Linkage

- Every criterion in the request must have `evidence_refs` linking to evidence registry entries
- Evidence records must include: `evidence_id`, `canonical_path`, `sha256`, `size_bytes`
- `evidence_refs` in verification checks must resolve to registered evidence IDs
- Unresolved evidence references produce `blocked` status

## Resume / Blocked Behavior

| From Status | Resume Condition | Auto-Resume |
|-------------|-----------------|-------------|
| `blocked`   | Missing evidence supplied + new verification pass triggered | No |
| `fail`      | Rework performed + new BuildReport submitted | No |
| `warn` (required) | Policy exception filed with rationale, or rework to pass | No |

All resume paths require a new `VerifyRequest` from the Orchestrator.

## Freshness Checks

- Triggered when `verification_requirements.freshness_required` is `true` in the ExecutionPlan
- Also triggered when ResearchReport contains time-sensitive findings
- Evidence: timestamped lookup result with source reference
- Freshness failure on time-sensitive claim → `fail` (FC-005)

## Request Schema

See `verify_request.schema.json`. Required fields:
- `job_id`: unique verification job identifier
- `domain`: verification domain (`truth`, `plan`, `research`, `ui`, `api`, `custom`)
- `workflow_class`: one of the canonical workflow classes
- `criteria`: array of check objects with `check_id`, `check_type`, `status`

## Response Schema

See `verify_response.schema.json`. Required fields:
- `job_id`, `domain`, `overall_status`, `summary`, `checks_run`, `timestamp`
- Optional embedded `verification_artifact` with full VerificationArtifact structure
