#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const TASK7_DIR = path.join(ROOT, 'specs', 'task7', 'v1');
const errors = [];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requireFields(label, obj, fields) {
  for (const f of fields) {
    if (obj[f] === undefined || obj[f] === null) {
      errors.push(`${label} missing required field: ${f}`);
    }
  }
}

function gateS81Presence() {
  const required = [
    'STAGE8_IMPLEMENTATION_MAP.md',
    'versioning-migration-policy.json',
    'replayability-spec.json',
    'risk-tiers-policy.json',
    'policy-as-code-ci-requirements.json',
    'validate-task7.js'
  ];
  for (const name of required) {
    if (!fs.existsSync(path.join(TASK7_DIR, name))) {
      errors.push(`S8-1 missing file: ${name}`);
    }
  }
}

function gateS82VersioningMigration() {
  const doc = loadJson(path.join(TASK7_DIR, 'versioning-migration-policy.json'));
  requireFields('S8-2', doc, ['version', 'semver_policy', 'backward_compat_window', 'migration_strategy']);

  // semver_policy deep checks
  const sp = doc.semver_policy || {};
  if (sp.format !== 'major.minor.patch') {
    errors.push('S8-2 semver_policy.format must be "major.minor.patch"');
  }
  for (const key of ['breaking_change_triggers', 'minor_change_triggers', 'patch_change_triggers']) {
    if (!Array.isArray(sp[key]) || sp[key].length === 0) {
      errors.push(`S8-2 semver_policy.${key} must be a non-empty array`);
    }
  }

  // backward_compat_window deep checks
  const bc = doc.backward_compat_window || {};
  if (typeof bc.duration_days !== 'number' || bc.duration_days < 1) {
    errors.push('S8-2 backward_compat_window.duration_days must be a positive integer');
  }
  if (typeof bc.strategy !== 'string' || bc.strategy.length === 0) {
    errors.push('S8-2 backward_compat_window.strategy must be a non-empty string');
  }
  if (typeof bc.deprecation_notice_required !== 'boolean') {
    errors.push('S8-2 backward_compat_window.deprecation_notice_required must be boolean');
  }

  // migration_strategy deep checks
  const ms = doc.migration_strategy || {};
  if (typeof ms.approach !== 'string' || ms.approach.length === 0) {
    errors.push('S8-2 migration_strategy.approach must be a non-empty string');
  }
  if (typeof ms.rollback_supported !== 'boolean') {
    errors.push('S8-2 migration_strategy.rollback_supported must be boolean');
  }
  if (typeof ms.data_migration_required !== 'boolean') {
    errors.push('S8-2 migration_strategy.data_migration_required must be boolean');
  }
  if (typeof ms.validation_before_cutover !== 'boolean') {
    errors.push('S8-2 migration_strategy.validation_before_cutover must be boolean');
  }
}

function gateS83Replayability() {
  const doc = loadJson(path.join(TASK7_DIR, 'replayability-spec.json'));
  requireFields('S8-3', doc, ['version', 'required_artifacts', 'replay_inputs', 'determinism_requirements']);

  if (!Array.isArray(doc.required_artifacts) || doc.required_artifacts.length === 0) {
    errors.push('S8-3 required_artifacts must be a non-empty array');
  }
  if (doc.determinism_requirements && !doc.determinism_requirements.hash_algorithm) {
    errors.push('S8-3 determinism_requirements missing hash_algorithm');
  }
}

function gateS84RiskTiers() {
  const doc = loadJson(path.join(TASK7_DIR, 'risk-tiers-policy.json'));
  requireFields('S8-4', doc, ['version', 'tiers', 'tier_rules']);

  const requiredTiers = ['low', 'med', 'high'];
  for (const tier of requiredTiers) {
    if (!doc.tiers || !doc.tiers[tier]) {
      errors.push(`S8-4 missing tier: ${tier}`);
    }
    if (!doc.tier_rules || !doc.tier_rules[tier]) {
      errors.push(`S8-4 missing tier_rules for: ${tier}`);
      continue;
    }
    const rule = doc.tier_rules[tier];
    if (!rule.autonomy) {
      errors.push(`S8-4 tier_rules.${tier} missing autonomy`);
    }
    if (!Array.isArray(rule.required_gates) || rule.required_gates.length === 0) {
      errors.push(`S8-4 tier_rules.${tier} missing required_gates`);
    }
  }
}

function gateS85PolicyAsCodeCi() {
  const doc = loadJson(path.join(TASK7_DIR, 'policy-as-code-ci-requirements.json'));
  requireFields('S8-5', doc, ['version', 'required_workflows', 'required_commands', 'fail_conditions']);

  if (!Array.isArray(doc.required_workflows) || doc.required_workflows.length === 0) {
    errors.push('S8-5 required_workflows must be a non-empty array');
  }
  if (!Array.isArray(doc.required_commands) || doc.required_commands.length === 0) {
    errors.push('S8-5 required_commands must be a non-empty array');
  }
  if (typeof doc.fail_conditions !== 'object' || Object.keys(doc.fail_conditions).length === 0) {
    errors.push('S8-5 fail_conditions must be a non-empty object');
  }
}

function gateS86CiFailClosed() {
  if (errors.length > 0) return;

  const policyFiles = [
    'versioning-migration-policy.json',
    'replayability-spec.json',
    'risk-tiers-policy.json',
    'policy-as-code-ci-requirements.json'
  ];
  for (const name of policyFiles) {
    const doc = loadJson(path.join(TASK7_DIR, name));
    if (doc.version !== 'v1') {
      errors.push(`S8-6 fail-closed: ${name} version must be v1`);
    }
  }
}

function main() {
  gateS81Presence();
  if (errors.length === 0) {
    gateS82VersioningMigration();
    gateS83Replayability();
    gateS84RiskTiers();
    gateS85PolicyAsCodeCi();
    gateS86CiFailClosed();
  }

  if (errors.length > 0) {
    console.log('Stage 8 gates: FAIL');
    for (const err of errors) console.log(`- ${err}`);
    process.exit(1);
  }

  console.log('Stage 8 gates: PASS');
  console.log('- S8-1: presence gate');
  console.log('- S8-2: versioning/migration policy gate');
  console.log('- S8-3: replayability spec gate');
  console.log('- S8-4: risk tiers policy gate');
  console.log('- S8-5: policy-as-code CI requirements gate');
  console.log('- S8-6: CI fail-closed gate');
}

main();
