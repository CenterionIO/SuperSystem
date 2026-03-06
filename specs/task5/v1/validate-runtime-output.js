#!/usr/bin/env node
/**
 * Runtime Output Validator
 *
 * Runs both golden paths (code_change, mcp_tool) via the CLI,
 * captures @@MANIFEST:: output, then validates every run directory
 * against GP1-GP5 + CC-009..CC-013 + artifact completeness checks.
 *
 * Gates:
 *   RO-1: Golden path execution succeeds (exit 0)
 *   RO-2: @@MANIFEST:: line present and parseable
 *   RO-3: Required artifact files exist on disk
 *   RO-4: GP1-GP5 + CC conformance (via validate-run.js)
 *   RO-5: proof.json exists and verdict is pass
 *   RO-6: manifest.json exists with correct correlation_id and entries
 *   RO-7: Evidence files exist on disk and match evidence_records
 *   RO-8: trace.jsonl exists and is non-empty
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..', '..');
const validateRunOutput = require(path.join(ROOT, 'tools', 'validate-run.js'));

const errors = [];
const goldenPaths = ['code_change', 'mcp_tool'];
const runDirs = [];

// ─── RO-1 + RO-2: Execute golden paths and capture manifests ───

for (const wf of goldenPaths) {
  let stdout;
  try {
    stdout = execSync(`node runtime/cli.js golden ${wf}`, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
    });
  } catch (e) {
    errors.push(`RO-1 [${wf}]: golden path execution failed — ${e.message}`);
    continue;
  }

  // RO-2: Parse output directory from CLI output
  // Supports both @@MANIFEST:: and "Output: <path>" formats
  let outputDir;
  const manifestLine = stdout.split('\n').find(l => l.startsWith('@@MANIFEST::'));
  if (manifestLine) {
    try {
      const m = JSON.parse(manifestLine.slice('@@MANIFEST::'.length));
      outputDir = m.output_dir;
    } catch {
      errors.push(`RO-2 [${wf}]: @@MANIFEST:: line not valid JSON`);
      continue;
    }
  } else {
    const outputLine = stdout.split('\n').find(l => l.trim().startsWith('Output:'));
    if (outputLine) {
      outputDir = outputLine.trim().replace(/^Output:\s*/, '');
    }
  }

  if (!outputDir) {
    errors.push(`RO-2 [${wf}]: could not find output directory in CLI output`);
    continue;
  }

  const runDir = path.resolve(outputDir);
  if (!fs.existsSync(runDir)) {
    errors.push(`RO-2 [${wf}]: output_dir does not exist: ${runDir}`);
    continue;
  }

  // Extract correlation_id from run_state.json
  const rsPath = path.join(runDir, 'run_state.json');
  let correlationId;
  if (fs.existsSync(rsPath)) {
    correlationId = JSON.parse(fs.readFileSync(rsPath, 'utf8')).correlation_id;
  }

  runDirs.push({ wf, runDir, correlationId });
}

// ─── RO-3: Required artifact files exist ───

const requiredFiles = [
  'run_state.json',
  'VerificationArtifact.json',
  'evidence_records.json',
  'BuildReport.json',
  'ExecutionPlan.json',
  'ResearchReport.json',
];

for (const { wf, runDir } of runDirs) {
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(runDir, file))) {
      errors.push(`RO-3 [${wf}]: missing required file: ${file}`);
    }
  }
}

// ─── RO-4: GP1-GP5 + CC conformance via validate-run.js ───

for (const { wf, runDir } of runDirs) {
  // Temporarily redirect console.log to capture validate-run output
  const origLog = console.log;
  const logLines = [];
  console.log = (...args) => logLines.push(args.join(' '));

  const ok = validateRunOutput(runDir);

  console.log = origLog;

  if (!ok) {
    errors.push(`RO-4 [${wf}]: conformance FAIL`);
    for (const line of logLines) {
      if (line.includes('FAIL') || line.trim().startsWith('-')) {
        errors.push(`  ${line.trim()}`);
      }
    }
  }
}

// ─── RO-5: proof.json exists and verdict is pass ───

for (const { wf, runDir } of runDirs) {
  const proofPath = path.join(runDir, 'proof.json');
  if (!fs.existsSync(proofPath)) {
    errors.push(`RO-5 [${wf}]: proof.json not found`);
    continue;
  }
  try {
    const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
    if (proof.verdict !== 'pass') {
      errors.push(`RO-5 [${wf}]: proof.json verdict is '${proof.verdict}', expected 'pass'`);
    }
  } catch {
    errors.push(`RO-5 [${wf}]: proof.json is not valid JSON`);
  }
}

// ─── RO-6: manifest.json exists with correct structure ───

for (const { wf, runDir, correlationId } of runDirs) {
  const manifestPath = path.join(runDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    errors.push(`RO-6 [${wf}]: manifest.json not found`);
    continue;
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (correlationId && manifest.correlation_id !== correlationId) {
      errors.push(`RO-6 [${wf}]: manifest.json correlation_id mismatch`);
    }
    if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
      errors.push(`RO-6 [${wf}]: manifest.json artifacts empty or missing`);
    }
    // Each entry must have file, sha256, size_bytes
    for (const entry of manifest.artifacts || []) {
      if (!entry.file || !entry.sha256 || typeof entry.size_bytes !== 'number') {
        errors.push(`RO-6 [${wf}]: manifest entry missing file/sha256/size_bytes`);
        break;
      }
      // Verify sha256 matches actual file
      const filePath = path.join(runDir, entry.file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const actualHash = crypto.createHash('sha256').update(content).digest('hex');
        if (actualHash !== entry.sha256) {
          errors.push(`RO-6 [${wf}]: manifest sha256 mismatch for ${entry.file}`);
        }
      }
    }
  } catch {
    errors.push(`RO-6 [${wf}]: manifest.json is not valid JSON`);
  }
}

// ─── RO-7: Evidence files exist on disk ───

for (const { wf, runDir } of runDirs) {
  const evidencePath = path.join(runDir, 'evidence_records.json');
  if (!fs.existsSync(evidencePath)) continue;

  const records = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  for (const rec of records) {
    const evPath = path.join(ROOT, 'out', rec.path);
    if (!fs.existsSync(evPath)) {
      errors.push(`RO-7 [${wf}]: evidence file missing: ${rec.path}`);
      continue;
    }
    // Verify hash
    const content = fs.readFileSync(evPath);
    const actualHash = crypto.createHash('sha256').update(content).digest('hex');
    if (actualHash !== rec.content_hash) {
      errors.push(`RO-7 [${wf}]: evidence hash mismatch for ${rec.evidence_id}`);
    }
    // Verify size
    if (content.length !== rec.size_bytes) {
      errors.push(`RO-7 [${wf}]: evidence size mismatch for ${rec.evidence_id} (expected ${rec.size_bytes}, got ${content.length})`);
    }
  }
}

// ─── RO-8: trace.jsonl exists and is non-empty ───

for (const { wf, runDir } of runDirs) {
  const tracePath = path.join(runDir, 'trace.jsonl');
  if (!fs.existsSync(tracePath)) {
    errors.push(`RO-8 [${wf}]: trace.jsonl not found`);
    continue;
  }
  const content = fs.readFileSync(tracePath, 'utf8').trim();
  if (content.length === 0) {
    errors.push(`RO-8 [${wf}]: trace.jsonl is empty`);
    continue;
  }
  // Each line must be valid JSON
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    try {
      JSON.parse(lines[i]);
    } catch {
      errors.push(`RO-8 [${wf}]: trace.jsonl line ${i + 1} is not valid JSON`);
      break;
    }
  }
}

// ─── Report ───

if (errors.length > 0) {
  console.log(`Runtime output validation: FAIL (${errors.length} errors)`);
  for (const e of errors) {
    console.log(`  - ${e}`);
  }
  process.exit(1);
}

console.log('Runtime output validation: PASS');
console.log(`  - RO-1: golden path execution (${goldenPaths.length} paths)`);
console.log('  - RO-2: @@MANIFEST:: capture and parse');
console.log('  - RO-3: required artifact files present');
console.log('  - RO-4: GP1-GP5 + CC-009..CC-013 conformance');
console.log('  - RO-5: proof.json exists with pass verdict');
console.log('  - RO-6: manifest.json structure + sha256 verification');
console.log('  - RO-7: evidence files exist with hash/size match');
console.log('  - RO-8: trace.jsonl valid JSONL');
