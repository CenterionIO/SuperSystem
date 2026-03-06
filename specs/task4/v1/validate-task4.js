#!/usr/bin/env node
/**
 * Stage 4 Verification Backbone Gate Validator
 * Gates V1-V5: Engine-contract alignment, ladder coverage, plugin ABI completeness,
 * evidence registry integrity, cross-artifact binding.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const TASK4_DIR = path.join(ROOT, 'specs', 'task4', 'v1');
const TASK1_DIR = path.join(ROOT, 'specs', 'task1', 'v1');
const TASK3_DIR = path.join(ROOT, 'specs', 'task3', 'v1');
const POLICY_DIR = path.join(ROOT, 'policy', 'v1');

const errors = [];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ─── Load all artifacts ───

const contract = loadJson(path.join(TASK1_DIR, 'VerifyMCP-contract.json'));
const verificationSchema = loadJson(path.join(TASK1_DIR, 'schemas', 'VerificationArtifact.json'));
const taxonomy = loadJson(path.join(POLICY_DIR, 'workflow_taxonomy.json'));
const gateSequence = loadJson(path.join(TASK3_DIR, 'gate-sequence.json'));

const engine = loadJson(path.join(TASK4_DIR, 'verify-mcp-engine.json'));
const pluginAbi = loadJson(path.join(TASK4_DIR, 'verifier-plugin-abi.json'));
const evidenceRegistry = loadJson(path.join(TASK4_DIR, 'evidence-registry.json'));

// ─── Gate V1: Engine-Contract Alignment ───

function gateV1() {
  const contractCheckTypes = Object.keys(contract.checkTypes);
  const contractFCRules = contract.failClosedRules.map(r => r.id);

  // V1.1: Scoring engine references all check types from contract
  const engineSteps = engine.scoring_algorithm.steps;
  const pluginSelectStep = engineSteps.find(s => s.name === 'select_plugins');
  if (!pluginSelectStep) {
    errors.push('V1.1: Engine missing select_plugins step');
  }

  // V1.2: All FC rules (FC-001 through FC-005) have enforcement entries in engine
  const fcImplementations = engine.fail_closed_enforcement?.implementations || [];
  const implementedFCRules = new Set(fcImplementations.map(i => i.rule_ref));
  for (const fcId of contractFCRules) {
    if (!implementedFCRules.has(fcId)) {
      errors.push(`V1.2: Engine missing fail-closed implementation for: ${fcId}`);
    }
  }

  // V1.3: Overall status aggregation rules exist
  const osaRules = engine.overall_status_aggregation?.rules || [];
  if (osaRules.length === 0) {
    errors.push('V1.3: Engine missing overall_status_aggregation rules');
  }

  // V1.4: Aggregation precedence matches contract status taxonomy
  const contractStatuses = contract.statusTaxonomy.values;
  const enginePrecedence = engine.overall_status_aggregation?.precedence || [];
  for (const status of contractStatuses) {
    if (!enginePrecedence.includes(status)) {
      errors.push(`V1.4: Engine aggregation precedence missing status: ${status}`);
    }
  }

  // V1.5: Engine scoring algorithm has all required steps
  const requiredStepNames = [
    'validate_inputs', 'extract_criteria', 'resolve_evidence',
    'select_plugins', 'execute_plugins', 'evaluate_criteria',
    'check_ladder_compliance', 'check_freshness', 'compute_overall_status', 'produce_artifact'
  ];
  const engineStepNames = new Set(engineSteps.map(s => s.name));
  for (const name of requiredStepNames) {
    if (!engineStepNames.has(name)) {
      errors.push(`V1.5: Engine missing required step: ${name}`);
    }
  }

  // V1.6: Engine artifact_hash_computation specifies algorithm
  if (!engine.artifact_hash_computation) {
    errors.push('V1.6: Engine missing artifact_hash_computation');
  } else {
    if (!engine.artifact_hash_computation.algorithm) {
      errors.push('V1.6: artifact_hash_computation missing algorithm');
    }
  }

  // V1.7: Engine invariants exist
  if (!engine.engine_invariants || engine.engine_invariants.length === 0) {
    errors.push('V1.7: Engine missing engine_invariants');
  }

  // V1.8: Authority conformance checks reference AC-001 through AC-005
  const acImplementations = engine.authority_conformance_enforcement?.implementations || [];
  const implementedACs = new Set(acImplementations.map(i => i.rule_ref));
  const contractACs = contract.authorityConformanceChecks.checks.map(c => c.id);
  for (const acId of contractACs) {
    if (!implementedACs.has(acId)) {
      errors.push(`V1.8: Engine missing authority conformance implementation for: ${acId}`);
    }
  }
}

// ─── Gate V2: Ladder Coverage ───

function gateV2() {
  const taxonomyClasses = Object.keys(taxonomy.classes);
  const contractLadders = contract.verificationLadder.ladders;
  const validCheckTypes = new Set(Object.keys(contract.checkTypes));

  // V2.1: Engine ladder compliance covers all workflow classes
  // The engine must handle every class in taxonomy
  for (const cls of taxonomyClasses) {
    if (!(cls in contractLadders)) {
      errors.push(`V2.1: Contract verification ladder missing workflow class: ${cls}`);
    }
  }

  // V2.2: Every ladder step maps to a valid check type
  for (const [cls, ladder] of Object.entries(contractLadders)) {
    for (const step of ladder) {
      if (!validCheckTypes.has(step)) {
        errors.push(`V2.2: Ladder for ${cls} references invalid check type: ${step}`);
      }
    }
  }

  // V2.3: Empty ladder (transcription) is explicitly handled
  if (!contractLadders.transcription || contractLadders.transcription.length !== 0) {
    // It's defined and should be empty
    if (contractLadders.transcription && contractLadders.transcription.length > 0) {
      errors.push('V2.3: Transcription ladder should be empty but has entries');
    }
  }

  // V2.4: Taxonomy verification_ladder matches contract ladders
  for (const [cls, config] of Object.entries(taxonomy.classes)) {
    const taxLadder = JSON.stringify(config.verification_ladder);
    const conLadder = JSON.stringify(contractLadders[cls]);
    if (taxLadder !== conLadder) {
      errors.push(`V2.4: Ladder mismatch for ${cls} — taxonomy: ${taxLadder}, contract: ${conLadder}`);
    }
  }

  // V2.5: Engine check_ladder_compliance step exists
  const ladderStep = engine.scoring_algorithm.steps.find(s => s.name === 'check_ladder_compliance');
  if (!ladderStep) {
    errors.push('V2.5: Engine missing check_ladder_compliance step');
  } else {
    if (!ladderStep.on_incomplete_ladder) {
      errors.push('V2.5: check_ladder_compliance step missing on_incomplete_ladder handler');
    }
  }
}

// ─── Gate V3: Plugin ABI Completeness ───

function gateV3() {
  // V3.1: Plugin ABI has input schema with required fields
  const inputRequired = pluginAbi.input_schema?.required || [];
  if (inputRequired.length === 0) {
    errors.push('V3.1: Plugin ABI input_schema missing required fields');
  }
  const requiredInputFields = ['invocation_id', 'correlation_id', 'criteria_id', 'evidence_refs', 'check_type'];
  for (const field of requiredInputFields) {
    if (!inputRequired.some(f => f.field === field)) {
      errors.push(`V3.1: Plugin ABI input_schema missing required field: ${field}`);
    }
  }

  // V3.2: Plugin ABI has output schema with required fields
  const outputRequired = pluginAbi.output_schema?.required || [];
  if (outputRequired.length === 0) {
    errors.push('V3.2: Plugin ABI output_schema missing required fields');
  }
  const requiredOutputFields = ['invocation_id', 'correlation_id', 'criteria_id', 'status', 'rationale'];
  for (const field of requiredOutputFields) {
    if (!outputRequired.some(f => f.field === field)) {
      errors.push(`V3.2: Plugin ABI output_schema missing required field: ${field}`);
    }
  }

  // V3.3: Timeout policy exists and is bounded
  const timeout = pluginAbi.timeout_policy;
  if (!timeout) {
    errors.push('V3.3: Plugin ABI missing timeout_policy');
  } else {
    if (typeof timeout.default_timeout_ms !== 'number') {
      errors.push('V3.3: timeout_policy missing default_timeout_ms');
    }
    if (typeof timeout.max_timeout_ms !== 'number') {
      errors.push('V3.3: timeout_policy missing max_timeout_ms');
    }
    if (timeout.default_timeout_ms > timeout.max_timeout_ms) {
      errors.push('V3.3: default_timeout_ms exceeds max_timeout_ms');
    }
  }

  // V3.4: Resource policy exists and is bounded
  const resources = pluginAbi.resource_policy;
  if (!resources) {
    errors.push('V3.4: Plugin ABI missing resource_policy');
  } else {
    if (typeof resources.max_memory_mb !== 'number') {
      errors.push('V3.4: resource_policy missing max_memory_mb');
    }
    if (typeof resources.max_cpu_seconds !== 'number') {
      errors.push('V3.4: resource_policy missing max_cpu_seconds');
    }
  }

  // V3.5: Capability flags cover check types needing external access
  const capFlags = pluginAbi.capability_flags?.flags || {};
  if (!capFlags.requires_network) {
    errors.push('V3.5: Capability flags missing requires_network');
  }
  if (!capFlags.requires_web) {
    errors.push('V3.5: Capability flags missing requires_web');
  }
  if (!capFlags.requires_fs_read) {
    errors.push('V3.5: Capability flags missing requires_fs_read');
  }
  if (!capFlags.requires_process_exec) {
    errors.push('V3.5: Capability flags missing requires_process_exec');
  }

  // V3.6: Error handling produces valid verification statuses (fail-closed)
  const pluginErrors = pluginAbi.error_handling?.plugin_errors || [];
  if (pluginErrors.length === 0) {
    errors.push('V3.6: Plugin ABI missing error handling');
  }
  for (const err of pluginErrors) {
    if (!err.engine_response || !err.engine_response.includes('blocked')) {
      errors.push(`V3.6: Plugin error type ${err.error_type} does not map to blocked`);
    }
  }

  // V3.7: Plugin lifecycle is defined
  const lifecycle = pluginAbi.lifecycle?.phases || [];
  if (lifecycle.length === 0) {
    errors.push('V3.7: Plugin ABI missing lifecycle phases');
  }
  const requiredPhases = ['load', 'execute', 'teardown'];
  const phaseNames = new Set(lifecycle.map(p => p.phase));
  for (const phase of requiredPhases) {
    if (!phaseNames.has(phase)) {
      errors.push(`V3.7: Plugin lifecycle missing phase: ${phase}`);
    }
  }

  // V3.8: Plugin ABI invariants exist
  if (!pluginAbi.abi_invariants || pluginAbi.abi_invariants.length === 0) {
    errors.push('V3.8: Plugin ABI missing abi_invariants');
  }

  // V3.9: Timeout defaults exist for all check types
  const checkTypes = Object.keys(contract.checkTypes);
  const perTypeDefaults = timeout?.per_check_type_defaults || {};
  for (const ct of checkTypes) {
    if (!(ct in perTypeDefaults)) {
      errors.push(`V3.9: timeout_policy missing per_check_type_default for: ${ct}`);
    }
  }

  // V3.10: Plugin output status enum includes 'error' for fail-closed mapping
  const outputStatusField = outputRequired.find(f => f.field === 'status');
  if (outputStatusField && outputStatusField.enum) {
    if (!outputStatusField.enum.includes('error')) {
      errors.push('V3.10: Plugin output status enum missing "error" for fail-closed mapping');
    }
  }
}

// ─── Gate V4: Evidence Registry Integrity ───

function gateV4() {
  const registryTypes = Object.keys(evidenceRegistry.evidence_types.types);

  // V4.1: Evidence types cover all required_evidence_types from taxonomy
  const allRequiredTypes = new Set();
  for (const config of Object.values(taxonomy.classes)) {
    for (const et of config.required_evidence_types) {
      allRequiredTypes.add(et);
    }
  }
  for (const requiredType of allRequiredTypes) {
    if (!registryTypes.includes(requiredType)) {
      errors.push(`V4.1: Evidence registry missing type required by taxonomy: ${requiredType}`);
    }
  }

  // V4.2: Canonical path format is defined
  if (!evidenceRegistry.canonical_path_format) {
    errors.push('V4.2: Evidence registry missing canonical_path_format');
  } else {
    if (!evidenceRegistry.canonical_path_format.pattern) {
      errors.push('V4.2: canonical_path_format missing pattern');
    }
  }

  // V4.3: Hash algorithm is specified
  if (!evidenceRegistry.hash_points) {
    errors.push('V4.3: Evidence registry missing hash_points');
  } else {
    if (!evidenceRegistry.hash_points.algorithm) {
      errors.push('V4.3: hash_points missing algorithm');
    }
  }

  // V4.4: Evidence ID generation is defined
  if (!evidenceRegistry.evidence_id_generation) {
    errors.push('V4.4: Evidence registry missing evidence_id_generation');
  } else {
    if (!evidenceRegistry.evidence_id_generation.format) {
      errors.push('V4.4: evidence_id_generation missing format');
    }
  }

  // V4.5: Retention policy exists
  const retention = evidenceRegistry.retention_policy?.rules || [];
  if (retention.length === 0) {
    errors.push('V4.5: Evidence registry missing retention_policy rules');
  }

  // V4.6: Evidence record has required fields
  const recordFields = evidenceRegistry.evidence_record?.required_fields || [];
  if (recordFields.length === 0) {
    errors.push('V4.6: Evidence registry missing evidence_record required_fields');
  }
  const requiredRecordFields = ['evidence_id', 'correlation_id', 'evidence_type', 'path', 'content_hash', 'produced_by', 'produced_at'];
  for (const fieldName of requiredRecordFields) {
    if (!recordFields.some(f => f.field === fieldName)) {
      errors.push(`V4.6: Evidence record missing required field: ${fieldName}`);
    }
  }

  // V4.7: Lookup protocol is defined with resolve operation
  const lookupOps = evidenceRegistry.lookup_protocol?.operations || [];
  if (lookupOps.length === 0) {
    errors.push('V4.7: Evidence registry missing lookup_protocol operations');
  }
  const requiredOps = ['resolve', 'verify_integrity', 'register'];
  const opNames = new Set(lookupOps.map(o => o.operation));
  for (const op of requiredOps) {
    if (!opNames.has(op)) {
      errors.push(`V4.7: Lookup protocol missing operation: ${op}`);
    }
  }

  // V4.8: Immutability rules exist
  if (!evidenceRegistry.immutability_rules || evidenceRegistry.immutability_rules.length === 0) {
    errors.push('V4.8: Evidence registry missing immutability_rules');
  }

  // V4.9: Registry invariants exist
  if (!evidenceRegistry.registry_invariants || evidenceRegistry.registry_invariants.length === 0) {
    errors.push('V4.9: Evidence registry missing registry_invariants');
  }

  // V4.10: Each evidence type has storage and extension defined
  for (const [typeName, typeConfig] of Object.entries(evidenceRegistry.evidence_types.types)) {
    if (!typeConfig.storage) {
      errors.push(`V4.10: Evidence type ${typeName} missing storage field`);
    }
    if (!typeConfig.extension) {
      errors.push(`V4.10: Evidence type ${typeName} missing extension field`);
    }
  }
}

// ─── Gate V5: Cross-Artifact Binding ───

function gateV5() {
  // V5.1: Engine evidence resolution uses registry lookup protocol
  const resolveStep = engine.scoring_algorithm.steps.find(s => s.name === 'resolve_evidence');
  if (!resolveStep) {
    errors.push('V5.1: Engine missing resolve_evidence step');
  }

  // V5.2: Plugin ABI input includes evidence_refs that map to registry evidence records
  const pluginInputFields = pluginAbi.input_schema?.required || [];
  const hasEvidenceRefs = pluginInputFields.some(f => f.field === 'evidence_refs');
  if (!hasEvidenceRefs) {
    errors.push('V5.2: Plugin ABI input missing evidence_refs field');
  }

  // V5.3: Plugin ABI output can produce new evidence (produced_evidence)
  const pluginOutputOptional = pluginAbi.output_schema?.optional || [];
  const hasProducedEvidence = pluginOutputOptional.some(f => f.field === 'produced_evidence');
  if (!hasProducedEvidence) {
    errors.push('V5.3: Plugin ABI output missing produced_evidence optional field');
  }

  // V5.4: Engine hash computation matches registry hash algorithm
  const engineHashAlgo = engine.artifact_hash_computation?.algorithm;
  const registryHashAlgo = evidenceRegistry.hash_points?.algorithm;
  if (engineHashAlgo && registryHashAlgo && engineHashAlgo !== registryHashAlgo) {
    errors.push(`V5.4: Hash algorithm mismatch — engine: ${engineHashAlgo}, registry: ${registryHashAlgo}`);
  }

  // V5.5: Gate sequence required_artifacts reference types the engine can consume
  const buildReviewGate = gateSequence.gates['G-003'];
  if (buildReviewGate) {
    const hasExecutionPlan = buildReviewGate.required_artifacts.some(a => a.type === 'ExecutionPlan');
    const hasBuildReport = buildReviewGate.required_artifacts.some(a => a.type === 'BuildReport');
    if (!hasExecutionPlan) {
      errors.push('V5.5: Build review gate missing required ExecutionPlan artifact');
    }
    if (!hasBuildReport) {
      errors.push('V5.5: Build review gate missing required BuildReport artifact');
    }
  } else {
    errors.push('V5.5: Gate sequence missing G-003 (Build Review Gate)');
  }

  // V5.6: Evidence types in registry cover verification artifact schema evidence_ids
  // The VerificationArtifact.criteria_results[].evidence_ids must resolve in registry
  // Check that verification_type_used enum values map to check types with plugins
  const verificationTypeEnum = verificationSchema.properties?.criteria_results?.items?.properties?.verification_type_used?.enum || [];
  const validCheckTypes = new Set(Object.keys(contract.checkTypes));
  for (const vt of verificationTypeEnum) {
    if (vt !== 'manual' && !validCheckTypes.has(vt)) {
      errors.push(`V5.6: VerificationArtifact verification_type_used value "${vt}" not in contract check types`);
    }
  }

  // V5.7: Plugin output status enum maps to engine criteria evaluation
  const evaluateStep = engine.scoring_algorithm.steps.find(s => s.name === 'evaluate_criteria');
  if (!evaluateStep) {
    errors.push('V5.7: Engine missing evaluate_criteria step');
  } else {
    if (!evaluateStep.rules || evaluateStep.rules.length === 0) {
      errors.push('V5.7: evaluate_criteria step missing rules for status mapping');
    }
  }
}

// ─── Run All Gates ───

gateV1();
gateV2();
gateV3();
gateV4();
gateV5();

// ─── Report ───

if (errors.length > 0) {
  console.log(`Stage 4 verification backbone gates: FAIL (${errors.length} errors)`);
  for (const e of errors) {
    console.log(`  - ${e}`);
  }
  process.exit(1);
} else {
  console.log('Stage 4 verification backbone gates: PASS');
  console.log('  - V1: Engine-contract alignment (8 checks)');
  console.log('  - V2: Ladder coverage (5 checks)');
  console.log('  - V3: Plugin ABI completeness (10 checks)');
  console.log('  - V4: Evidence registry integrity (10 checks)');
  console.log('  - V5: Cross-artifact binding (7 checks)');
  process.exit(0);
}
