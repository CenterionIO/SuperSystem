#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Ajv = require('ajv');

const ROOT = path.join(__dirname, '..');
const SCHEMA_PATH = path.join(ROOT, 'specs', 'task5', 'v1', 'canonical-conformance-bundle.schema.json');

const ARTIFACT_MAP = {
  verification_artifact: 'VerificationArtifact.json',
  execution_plan: 'ExecutionPlan.json',
  build_report: 'BuildReport.json',
  evidence_registry: 'evidence_records.json',
  proof: 'proof.json',
  manifest: 'manifest.json',
  trace: 'trace.jsonl',
  run_state: 'run_state.json',
  policy_snapshot: 'policy_snapshot.json',
  request: 'request.json',
};

function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return {
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    size_bytes: content.length,
  };
}

function exportBundle(runDir) {
  const runId = path.basename(runDir);

  // Detect workflow_class from run_state.json or manifest.json
  let workflowClass = 'unknown';
  const rsPath = path.join(runDir, 'run_state.json');
  const mfPath = path.join(runDir, 'manifest.json');
  if (fs.existsSync(rsPath)) {
    workflowClass = JSON.parse(fs.readFileSync(rsPath, 'utf8')).workflow_class || workflowClass;
  } else if (fs.existsSync(mfPath)) {
    workflowClass = JSON.parse(fs.readFileSync(mfPath, 'utf8')).workflow_class || workflowClass;
  }

  const artifacts = {};
  for (const [key, filename] of Object.entries(ARTIFACT_MAP)) {
    const filePath = path.join(runDir, filename);
    if (fs.existsSync(filePath)) {
      artifacts[key] = hashFile(filePath);
    } else {
      artifacts[key] = null;
    }
  }

  const bundle = {
    version: 'v1',
    workflow_class: workflowClass,
    run_id: runId,
    artifacts,
  };

  // Validate against schema
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  delete schema.$schema;
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(bundle)) {
    console.error('Schema validation FAIL:');
    for (const err of validate.errors) {
      console.error(`  ${err.instancePath || '/'}: ${err.message}`);
    }
    process.exit(1);
  }

  const outPath = path.join(runDir, 'canonical_conformance_bundle.json');
  fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
  console.log(`Exported: ${outPath}`);
  return bundle;
}

// CLI: accept one or more run directories, or auto-discover from out/
const args = process.argv.slice(2);
let dirs = args;

if (dirs.length === 0) {
  const outDir = path.join(ROOT, 'out');
  if (fs.existsSync(outDir)) {
    dirs = fs.readdirSync(outDir)
      .map(d => path.join(outDir, d))
      .filter(d => fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, 'run_state.json')));
  }
}

if (dirs.length === 0) {
  console.error('No run directories found. Pass paths or ensure out/ has run dirs.');
  process.exit(1);
}

for (const dir of dirs) {
  exportBundle(dir);
}
