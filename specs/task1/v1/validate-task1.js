#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE = __dirname;

const SCHEMA_EXAMPLE_PAIRS = [
  {
    name: "ResearchReport",
    schema: "schemas/ResearchReport.json",
    example: "examples/ResearchReport-example.json",
    ownership: "ownership/ResearchReport.ownership.json",
  },
  {
    name: "ExecutionPlan",
    schema: "schemas/ExecutionPlan.json",
    example: "examples/ExecutionPlan-example.json",
    ownership: "ownership/ExecutionPlan.ownership.json",
  },
  {
    name: "BuildReport",
    schema: "schemas/BuildReport.json",
    example: "examples/BuildReport-example.json",
    ownership: "ownership/BuildReport.ownership.json",
  },
  {
    name: "VerificationArtifact",
    schema: "schemas/VerificationArtifact.json",
    example: "examples/VerificationArtifact-example.json",
    ownership: "ownership/VerificationArtifact.ownership.json",
  },
];

const STATE_MACHINE_PATH = "runtime-state-machine-v1.json";
const ROLE_MATRIX_PATH = "role-authority-matrix.json";
const INTERFACE_PATH = "orchestrator-planner-interface.json";

// Detect old-style paths like /field[] (no slash before bracket)
const OLD_STYLE_PATH_REGEX = /[a-zA-Z0-9_]\[/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadJSON(relPath) {
  const full = path.join(BASE, relPath);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

/** Strip non-standard keys from a schema so AJV can consume it. */
function purifySchema(raw) {
  const clone = JSON.parse(JSON.stringify(raw));
  delete clone.title;
  delete clone.version;
  delete clone.$schema;
  stripKeysDeep(clone, ["fieldOwnership"]);
  return clone;
}

function stripKeysDeep(obj, keys) {
  if (typeof obj !== "object" || obj === null) return;
  for (const k of keys) delete obj[k];
  for (const v of Object.values(obj)) stripKeysDeep(v, keys);
}

/**
 * Collect all field paths from a JSON Schema using canonical /field/[] notation.
 */
function collectSchemaLeafPaths(schema, prefix = "") {
  const paths = [];

  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      const currentPath = `${prefix}/${key}`;
      const resolvedType = Array.isArray(prop.type) ? prop.type[0] : prop.type;

      if (resolvedType === "object" && prop.properties) {
        paths.push(currentPath);
        paths.push(...collectSchemaLeafPaths(prop, currentPath));
      } else if (resolvedType === "array" && prop.items) {
        paths.push(currentPath);
        if (prop.items.type === "object" && prop.items.properties) {
          const arrayPath = `${currentPath}/[]`;
          paths.push(arrayPath);
          paths.push(...collectSchemaLeafPaths(prop.items, arrayPath));
        } else if (["string", "number", "integer", "boolean"].includes(prop.items.type)) {
          paths.push(`${currentPath}/[]`);
        }
      } else {
        paths.push(currentPath);
      }
    }
  }

  return paths;
}

// Results tracking
const results = { pass: 0, fail: 0, details: [] };

function record(gate, check, passed, detail) {
  const status = passed ? "PASS" : "FAIL";
  results.details.push({ gate, check, status, detail });
  if (passed) results.pass++;
  else results.fail++;
}

// ---------------------------------------------------------------------------
// Gate A: Schema Validation (AJV)
// ---------------------------------------------------------------------------

function runGateA() {
  console.log("\n========== GATE A: Schema Validation ==========\n");

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  for (const pair of SCHEMA_EXAMPLE_PAIRS) {
    const rawSchema = loadJSON(pair.schema);
    const example = loadJSON(pair.example);
    const pureSchema = purifySchema(rawSchema);

    let valid = false;
    let errMsg = "";

    try {
      const validate = ajv.compile(pureSchema);
      valid = validate(example);
      if (!valid) {
        errMsg = validate.errors
          .map((e) => `  ${e.instancePath || "/"}: ${e.message}`)
          .join("\n");
      }
    } catch (compileErr) {
      errMsg = `Schema compilation error: ${compileErr.message}`;
    }

    record("A", `${pair.name} example validates against schema`, valid, errMsg);
    console.log(`  ${valid ? "PASS" : "FAIL"}  ${pair.name}`);
    if (!valid && errMsg) console.log(errMsg);
  }
}

// ---------------------------------------------------------------------------
// Gate B: Ownership Conformance (deny-by-default, no orphans, canonical paths)
// ---------------------------------------------------------------------------

function runGateB() {
  console.log("\n========== GATE B: Ownership Conformance ==========\n");

  for (const pair of SCHEMA_EXAMPLE_PAIRS) {
    const rawSchema = loadJSON(pair.schema);
    const ownershipFile = loadJSON(pair.ownership);
    const ownership = ownershipFile.fieldOwnership || {};
    const ownershipPaths = new Set(Object.keys(ownership));

    const schemaPaths = collectSchemaLeafPaths(rawSchema);
    const schemaPathSet = new Set(schemaPaths);

    // B.1: Deny-by-default — every schema field has ownership
    const missingOwnership = schemaPaths.filter((p) => !ownershipPaths.has(p));
    const b1Pass = missingOwnership.length === 0;
    record("B", `${pair.name}: deny-by-default (all fields have ownership)`, b1Pass,
      b1Pass ? "" : `Missing: ${missingOwnership.join(", ")}`);
    console.log(`  ${b1Pass ? "PASS" : "FAIL"}  ${pair.name}: deny-by-default`);
    if (!b1Pass) missingOwnership.forEach((m) => console.log(`         ${m}`));

    // B.2: No orphaned ownership paths
    const orphanPaths = [...ownershipPaths].filter((p) => !schemaPathSet.has(p));
    const b2Pass = orphanPaths.length === 0;
    record("B", `${pair.name}: no orphaned ownership paths`, b2Pass,
      b2Pass ? "" : `Orphaned: ${orphanPaths.join(", ")}`);
    console.log(`  ${b2Pass ? "PASS" : "FAIL"}  ${pair.name}: no orphans`);
    if (!b2Pass) orphanPaths.forEach((o) => console.log(`         ${o}`));

    // B.3: All entries have required annotations
    let b3Failures = [];
    for (const [fpath, meta] of Object.entries(ownership)) {
      const missing = [];
      if (!meta.writtenBy || !Array.isArray(meta.writtenBy) || meta.writtenBy.length === 0)
        missing.push("writtenBy");
      if (!meta.readableBy || !Array.isArray(meta.readableBy) || meta.readableBy.length === 0)
        missing.push("readableBy");
      if (!meta.verifiedBy || !Array.isArray(meta.verifiedBy) || meta.verifiedBy.length === 0)
        missing.push("verifiedBy");
      if (missing.length > 0) b3Failures.push(`${fpath}: missing ${missing.join(", ")}`);
    }
    const b3Pass = b3Failures.length === 0;
    record("B", `${pair.name}: all entries have writtenBy/readableBy/verifiedBy`, b3Pass,
      b3Pass ? "" : b3Failures.join("; "));
    console.log(`  ${b3Pass ? "PASS" : "FAIL"}  ${pair.name}: annotation completeness`);

    // B.4: Canonical path format — reject old-style /field[] paths (must be /field/[])
    let b4Failures = [];
    for (const fpath of ownershipPaths) {
      if (OLD_STYLE_PATH_REGEX.test(fpath)) {
        b4Failures.push(fpath);
      }
    }
    const b4Pass = b4Failures.length === 0;
    record("B", `${pair.name}: canonical path format (no /field[] — must be /field/[])`, b4Pass,
      b4Pass ? "" : `Old-style paths: ${b4Failures.join(", ")}`);
    console.log(`  ${b4Pass ? "PASS" : "FAIL"}  ${pair.name}: canonical path format`);
    if (!b4Pass) b4Failures.forEach((f) => console.log(`         ${f}`));

    // B.5: echoedBy validation — a field cannot have both writtenBy and echoedBy for same role
    let b5Failures = [];
    for (const [fpath, meta] of Object.entries(ownership)) {
      if (meta.echoedBy && Array.isArray(meta.echoedBy)) {
        const writers = new Set(meta.writtenBy || []);
        for (const echoer of meta.echoedBy) {
          if (writers.has(echoer)) {
            b5Failures.push(`${fpath}: "${echoer}" in both writtenBy and echoedBy`);
          }
        }
      }
    }
    const b5Pass = b5Failures.length === 0;
    record("B", `${pair.name}: no role in both writtenBy and echoedBy`, b5Pass,
      b5Pass ? "" : b5Failures.join("; "));
    console.log(`  ${b5Pass ? "PASS" : "FAIL"}  ${pair.name}: echoedBy/writtenBy exclusivity`);
  }

  // Also check the Orchestrator-Planner interface ownership (now in standalone files)
  const INTERFACE_OWNERSHIP = {
    PlanningRequest: "ownership/PlanningRequest.ownership.json",
    PlanningResponse: "ownership/PlanningResponse.ownership.json",
  };
  for (const section of ["PlanningRequest", "PlanningResponse"]) {
    const ownershipFile = loadJSON(INTERFACE_OWNERSHIP[section]);
    const ownership = ownershipFile.fieldOwnership || {};
    const hasOwnership = Object.keys(ownership).length > 0;
    record("B", `${section}: has fieldOwnership`, hasOwnership, "");
    console.log(`  ${hasOwnership ? "PASS" : "FAIL"}  ${section}: has fieldOwnership (${Object.keys(ownership).length} entries)`);

    // Check canonical paths in interface too
    let ifacePathFailures = [];
    for (const fpath of Object.keys(ownership)) {
      if (OLD_STYLE_PATH_REGEX.test(fpath)) {
        ifacePathFailures.push(fpath);
      }
    }
    const ifacePathPass = ifacePathFailures.length === 0;
    record("B", `${section}: canonical path format`, ifacePathPass,
      ifacePathPass ? "" : `Old-style: ${ifacePathFailures.join(", ")}`);
    console.log(`  ${ifacePathPass ? "PASS" : "FAIL"}  ${section}: canonical path format`);
  }
}

// ---------------------------------------------------------------------------
// Gate C: Orchestrator Boundary + correlation_id provenance
// ---------------------------------------------------------------------------

function runGateC() {
  console.log("\n========== GATE C: Orchestrator Boundary ==========\n");

  const PLAN_CONTENT_FIELDS = new Set([
    "steps", "step_id", "order", "action", "criteria_ids",
    "acceptance_criteria", "criteria_id", "verification_requirements",
    "verification_type", "tools_required", "paths_affected",
    "minimum_ladder", "freshness_required",
  ]);

  let cPassed = true;

  for (const pair of SCHEMA_EXAMPLE_PAIRS) {
    const ownershipFile = loadJSON(pair.ownership);
    const ownership = ownershipFile.fieldOwnership || {};

    for (const [fpath, meta] of Object.entries(ownership)) {
      const fieldName = fpath.split("/").filter(Boolean).pop().replace("[]", "");

      // C.1: Orchestrator-written fields must not be plan content
      if (meta.writtenBy.includes("Orchestrator")) {
        if (PLAN_CONTENT_FIELDS.has(fieldName)) {
          record("C", `${pair.name}${fpath}: Orchestrator writes plan content`, false,
            `Field: ${fieldName}`);
          console.log(`  FAIL  ${pair.name}${fpath}: Orchestrator writes plan content "${fieldName}"`);
          cPassed = false;
        }
      }

      // C.2: Planner must not write routing fields
      if (meta.writtenBy.includes("Planner")) {
        const PLANNER_FORBIDDEN = new Set(["workflow_class", "autonomy_mode"]);
        if (PLANNER_FORBIDDEN.has(fieldName)) {
          record("C", `${pair.name}${fpath}: Planner writes routing field`, false,
            `Field: ${fieldName}`);
          console.log(`  FAIL  ${pair.name}${fpath}: Planner writes routing field "${fieldName}"`);
          cPassed = false;
        }
      }
    }
  }

  // C.3: PlanningRequest fields all written by Orchestrator
  const iface = loadJSON(INTERFACE_PATH);
  const reqOwnershipFile = loadJSON("ownership/PlanningRequest.ownership.json");
  const reqOwnership = reqOwnershipFile.fieldOwnership || {};
  for (const [fpath, meta] of Object.entries(reqOwnership)) {
    if (!meta.writtenBy.includes("Orchestrator")) {
      record("C", `PlanningRequest${fpath}: not written by Orchestrator`, false,
        `writtenBy: ${meta.writtenBy}`);
      console.log(`  FAIL  PlanningRequest${fpath}: writtenBy is ${meta.writtenBy}`);
      cPassed = false;
    }
  }

  // C.4: PlanningResponse plan content fields written by Planner
  const respOwnershipFile = loadJSON("ownership/PlanningResponse.ownership.json");
  const respOwnership = respOwnershipFile.fieldOwnership || {};
  for (const [fpath, meta] of Object.entries(respOwnership)) {
    const fieldName = fpath.split("/").filter(Boolean).pop();
    if (["execution_plan", "execution_plan_id", "status", "plan_blocker_detail"].includes(fieldName)) {
      if (!meta.writtenBy.includes("Planner") && !(meta.echoedBy && meta.echoedBy.includes("Planner"))) {
        record("C", `PlanningResponse${fpath}: plan field not written/echoed by Planner`, false,
          `writtenBy: ${meta.writtenBy}`);
        console.log(`  FAIL  PlanningResponse${fpath}: not written by Planner`);
        cPassed = false;
      }
    }
  }

  // C.5: correlation_id provenance — writtenBy Orchestrator, echoedBy downstream
  const respCorr = respOwnership["/correlation_id"];
  if (respCorr) {
    const corrWrittenByOrch = respCorr.writtenBy.includes("Orchestrator");
    const corrEchoedByPlanner = respCorr.echoedBy && respCorr.echoedBy.includes("Planner");
    const corrNotWrittenByPlanner = !respCorr.writtenBy.includes("Planner");

    record("C", "PlanningResponse correlation_id: writtenBy Orchestrator", corrWrittenByOrch, "");
    record("C", "PlanningResponse correlation_id: echoedBy Planner", !!corrEchoedByPlanner, "");
    record("C", "PlanningResponse correlation_id: NOT writtenBy Planner", corrNotWrittenByPlanner, "");

    console.log(`  ${corrWrittenByOrch ? "PASS" : "FAIL"}  correlation_id: writtenBy Orchestrator`);
    console.log(`  ${corrEchoedByPlanner ? "PASS" : "FAIL"}  correlation_id: echoedBy Planner`);
    console.log(`  ${corrNotWrittenByPlanner ? "PASS" : "FAIL"}  correlation_id: NOT writtenBy Planner`);

    if (!corrWrittenByOrch || !corrEchoedByPlanner || !corrNotWrittenByPlanner) cPassed = false;
  }

  // C.6: OP-003 hard check exists with value_equality check_type
  const rules = iface.boundaryRules?.rules || [];
  const op003 = rules.find((r) => r.id === "OP-003");
  const hasOP001 = rules.some((r) => r.id === "OP-001");
  const hasOP002 = rules.some((r) => r.id === "OP-002");
  const op003HasValueEquality = op003 && op003.check_type === "value_equality";

  record("C", "OP-001 exists", hasOP001, "");
  record("C", "OP-002 exists", hasOP002, "");
  record("C", "OP-003 exists with value_equality check_type", !!op003HasValueEquality, "");

  console.log(`  ${hasOP001 ? "PASS" : "FAIL"}  OP-001: Planner routing mutation prohibition`);
  console.log(`  ${hasOP002 ? "PASS" : "FAIL"}  OP-002: Orchestrator plan content mutation prohibition`);
  console.log(`  ${op003HasValueEquality ? "PASS" : "FAIL"}  OP-003: correlation_id value_equality check`);

  if (cPassed && hasOP001 && hasOP002 && op003HasValueEquality) {
    console.log(`  PASS  No cross-role field mutations detected`);
  }
}

// ---------------------------------------------------------------------------
// Gate D: Transition Mapping (deterministic, no wildcards, enum-validated)
// ---------------------------------------------------------------------------

function runGateD() {
  console.log("\n========== GATE D: Transition Mapping ==========\n");

  const sm = loadJSON(STATE_MACHINE_PATH);
  const validStates = new Set(sm.validStates || []);
  const transitions = sm.transitions || [];
  const states = sm.states || {};
  const verdicts = ["pass", "warn", "fail", "blocked"];
  const verdictSummary = sm.verdictTransitionSummary || {};

  // D.1: validStates enum exists
  const hasValidStates = validStates.size > 0;
  record("D", "validStates enum defined", hasValidStates, `${validStates.size} states`);
  console.log(`  ${hasValidStates ? "PASS" : "FAIL"}  validStates enum: ${validStates.size} states`);

  // D.2: Every verdict has a defined transition behavior
  for (const v of verdicts) {
    const hasDef = v in verdictSummary;
    record("D", `Verdict "${v}" has transition definition`, hasDef, "");
    console.log(`  ${hasDef ? "PASS" : "FAIL"}  Verdict "${v}"`);
  }

  // D.3: No wildcard transitions
  let hasWildcard = false;
  for (const t of transitions) {
    if (t.from === "*" || t.to === "*") {
      record("D", `No wildcard in transition ${t.from} -> ${t.to}`, false, "Wildcard detected");
      console.log(`  FAIL  Wildcard transition: ${t.from} -> ${t.to}`);
      hasWildcard = true;
    }
  }
  if (!hasWildcard) {
    record("D", "No wildcard transitions (TC-003)", true, `${transitions.length} transitions, all explicit`);
    console.log(`  PASS  No wildcard transitions (${transitions.length} total)`);
  }

  // D.4: All transition from/to values are members of validStates
  let invalidTargets = [];
  for (const t of transitions) {
    if (!validStates.has(t.from)) invalidTargets.push(`from: ${t.from}`);
    if (!validStates.has(t.to)) invalidTargets.push(`to: ${t.to}`);
  }
  const d4Pass = invalidTargets.length === 0;
  record("D", "All transition targets are valid states (TC-001, TC-002)", d4Pass,
    d4Pass ? "" : `Invalid: ${invalidTargets.join(", ")}`);
  console.log(`  ${d4Pass ? "PASS" : "FAIL"}  All targets are valid states`);
  if (!d4Pass) invalidTargets.forEach((t) => console.log(`         ${t}`));

  // D.5: Every verify gate has deterministic transitions
  const gateOutcomes = ["pass_transition", "fail_transition", "blocked_transition"];
  for (const [stateName, stateDef] of Object.entries(states)) {
    if (!stateDef.verify_gate) continue;
    const gate = stateDef.verify_gate;

    for (const outcome of gateOutcomes) {
      const target = gate[outcome];
      // null is valid for pass_transition when resume_policy handles it
      const hasResumePolicy = stateDef.resume_policy && stateDef.resume_policy.type === "return_to_previous_state";
      const isValid = (typeof target === "string" && target.length > 0) || (target === null && hasResumePolicy && outcome === "pass_transition");

      if (typeof target === "string" && target.length > 0 && !validStates.has(target)) {
        record("D", `${gate.gate_id} @ ${stateName}: ${outcome} target is valid state`, false, `"${target}" not in validStates`);
        console.log(`  FAIL  ${gate.gate_id}: ${outcome} -> "${target}" (not a valid state)`);
      } else {
        record("D", `${gate.gate_id} @ ${stateName}: ${outcome} is deterministic`, isValid,
          isValid ? (target ? `-> ${target}` : "-> resume_policy") : "missing");
        console.log(`  ${isValid ? "PASS" : "FAIL"}  ${gate.gate_id}: ${outcome} ${target ? `-> ${target}` : "-> resume_policy"}`);
      }
    }

    // Gate has checks
    const hasChecks = Array.isArray(gate.checks) && gate.checks.length > 0;
    record("D", `${gate.gate_id}: has checks defined`, hasChecks, `${gate.checks?.length || 0} checks`);
    console.log(`  ${hasChecks ? "PASS" : "FAIL"}  ${gate.gate_id}: ${gate.checks?.length || 0} checks`);
  }

  // D.6: Resume policies reference valid states in allowed_resume_targets
  for (const [stateName, stateDef] of Object.entries(states)) {
    if (!stateDef.resume_policy) continue;
    const rp = stateDef.resume_policy;
    if (rp.allowed_resume_targets) {
      let invalidResume = rp.allowed_resume_targets.filter((s) => !validStates.has(s));
      const rpPass = invalidResume.length === 0;
      record("D", `${stateName}: resume_policy targets are valid states (TC-004)`, rpPass,
        rpPass ? "" : `Invalid: ${invalidResume.join(", ")}`);
      console.log(`  ${rpPass ? "PASS" : "FAIL"}  ${stateName}: resume targets valid`);
    }
  }

  // D.7: Transition constraints exist
  const tc = sm.transitionConstraints;
  const hasTCRules = tc && Array.isArray(tc.rules) && tc.rules.length > 0;
  record("D", "Transition constraints defined", !!hasTCRules, `${tc?.rules?.length || 0} rules`);
  console.log(`  ${hasTCRules ? "PASS" : "FAIL"}  Transition constraints: ${tc?.rules?.length || 0} rules`);

  // D.8: Loop controls exist
  const loops = sm.loopControls || {};
  const hasMaxIter = loops.max_iterations_per_phase && Object.keys(loops.max_iterations_per_phase).length > 0;
  const hasMaxTools = loops.max_tool_calls_per_phase && Object.keys(loops.max_tool_calls_per_phase).length > 0;
  const hasRetryCaps = loops.retry_caps_by_error_type && Object.keys(loops.retry_caps_by_error_type).length > 0;
  const hasHeartbeat = loops.heartbeat_policy && loops.heartbeat_policy.interval_seconds > 0;

  record("D", "Loop control: max iterations", hasMaxIter, "");
  record("D", "Loop control: max tool calls", hasMaxTools, "");
  record("D", "Loop control: retry caps", hasRetryCaps, "");
  record("D", "Loop control: heartbeat", hasHeartbeat, "");

  console.log(`  ${hasMaxIter ? "PASS" : "FAIL"}  Max iterations per phase`);
  console.log(`  ${hasMaxTools ? "PASS" : "FAIL"}  Max tool calls per phase`);
  console.log(`  ${hasRetryCaps ? "PASS" : "FAIL"}  Retry caps by error type`);
  console.log(`  ${hasHeartbeat ? "PASS" : "FAIL"}  Heartbeat/stall detection`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("=".repeat(60));
console.log("  SuperSystem Task 1 — Gate Validation v1.1");
console.log("=".repeat(60));

runGateA();
runGateB();
runGateC();
runGateD();

// Summary
console.log("\n" + "=".repeat(60));
console.log("  SUMMARY");
console.log("=".repeat(60));
console.log(`\n  Total checks: ${results.pass + results.fail}`);
console.log(`  Passed:       ${results.pass}`);
console.log(`  Failed:       ${results.fail}`);

if (results.fail > 0) {
  console.log("\n  FAILED CHECKS:");
  for (const d of results.details.filter((d) => d.status === "FAIL")) {
    console.log(`    [Gate ${d.gate}] ${d.check}`);
    if (d.detail) console.log(`             ${d.detail}`);
  }
}

console.log(`\n  RESULT: ${results.fail === 0 ? "ALL GATES PASS" : "GATES FAILED"}\n`);
process.exit(results.fail === 0 ? 0 : 1);
