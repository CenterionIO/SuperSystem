# Stage 8 Implementation Map (Production Hardening)

Scope: harden contracts, policies, and CI for production-grade operation on top of Stages 1–7.

## Stage 8 Deliverables

1. `versioning-migration-policy.json`
   - Semver policy, backward-compatibility window, and migration strategy for all contracts.

2. `replayability-spec.json`
   - Required artifacts for replay, replay inputs, and determinism requirements.

3. `risk-tiers-policy.json`
   - Risk tiers (low/med/high) mapped to workflow classes, autonomy ceilings, and required gates.

4. `policy-as-code-ci-requirements.json`
   - Required CI workflows, commands, and fail conditions for policy enforcement.

## Gates

- `S8-1` Presence Gate
  - All required Stage 8 files exist.
- `S8-2` Versioning/Migration Policy Gate
  - `versioning-migration-policy.json` has required fields and valid structure.
- `S8-3` Replayability Spec Gate
  - `replayability-spec.json` has required fields and valid structure.
- `S8-4` Risk Tiers Policy Gate
  - `risk-tiers-policy.json` declares low/med/high tiers with autonomy and required_gates.
- `S8-5` Policy-as-Code CI Requirements Gate
  - `policy-as-code-ci-requirements.json` declares workflows, commands, and fail conditions.
- `S8-6` CI Fail-Closed Gate
  - Validator exits non-zero on any Stage 8 error.
  - All policy files must have version "v1".

## Exit Criteria

Stage 8 is complete when `validate-task7.js` passes all S8 gates and emits deterministic PASS output.
