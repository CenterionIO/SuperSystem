#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { Orchestrator } = require('./orchestrator');
const { ResearchStub } = require('./adapters/research_stub');
const { PlannerStub } = require('./adapters/planner_stub');
const { BuilderStub } = require('./adapters/builder_stub');

const ROOT = path.join(__dirname, '..');

function createOrchestrator() {
  const orch = new Orchestrator();
  orch.setAdapter('research', new ResearchStub());
  orch.setAdapter('planner', new PlannerStub());
  orch.setAdapter('builder', new BuilderStub());
  return orch;
}

async function runGoldenPath(name) {
  // Accept both code_change and code-change
  const normalizedName = name.replace(/_/g, '-');
  const goldenFile = path.join(ROOT, 'specs', 'task5', 'v1', `golden-path-${normalizedName}.json`);
  if (!fs.existsSync(goldenFile)) {
    console.error(`Golden path not found: ${goldenFile}`);
    process.exit(1);
  }
  const goldenPath = JSON.parse(fs.readFileSync(goldenFile, 'utf8'));

  console.log(`Running golden path: ${name}`);
  console.log(`  Workflow class: ${goldenPath.workflow_metadata.workflow_class}`);
  console.log(`  Goal: ${goldenPath.workflow_metadata.goal}`);
  console.log();

  const orch = createOrchestrator();
  const result = await orch.run(
    goldenPath.workflow_metadata.workflow_class,
    goldenPath.workflow_metadata.goal
  );

  console.log(`Result: ${result.status.toUpperCase()}`);
  console.log(`  Final state: ${result.final_state}`);
  console.log(`  Correlation ID: ${result.correlation_id}`);
  console.log(`  Transitions: ${result.transitions.length}`);
  console.log(`  Artifacts: ${result.artifacts.join(', ')}`);
  console.log(`  Output: ${result.output_dir}`);
  console.log();

  // Print transition log
  console.log('Transition log:');
  for (const t of result.transitions) {
    console.log(`  ${t.from} -> ${t.to}: ${t.reason}`);
  }

  // Verify output files exist
  console.log();
  const runDir = result.output_dir;
  const expectedFiles = ['run_state.json', 'VerificationArtifact.json', 'evidence_records.json'];
  let allPresent = true;
  for (const f of expectedFiles) {
    const exists = fs.existsSync(path.join(runDir, f));
    console.log(`  ${exists ? 'OK' : 'MISSING'}: ${f}`);
    if (!exists) allPresent = false;
  }

  return result.status === 'pass' && allPresent;
}

async function runWorkflow(workflowClass, goal) {
  console.log(`Running workflow: ${workflowClass}`);
  console.log(`  Goal: ${goal}`);
  console.log();

  const orch = createOrchestrator();
  const result = await orch.run(workflowClass, goal);

  console.log(`Result: ${result.status.toUpperCase()}`);
  console.log(`  Final state: ${result.final_state}`);
  console.log(`  Correlation ID: ${result.correlation_id}`);
  console.log(`  Output: ${result.output_dir}`);

  return result.status === 'pass';
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'golden') {
    const name = args[1];
    if (!name) {
      console.error('Usage: supersystem golden <code_change|mcp_tool>');
      process.exit(1);
    }
    const ok = await runGoldenPath(name);
    process.exit(ok ? 0 : 1);

  } else if (command === 'run') {
    const wfClass = args[1];
    const goal = args.slice(2).join(' ') || 'Default goal';
    if (!wfClass) {
      console.error('Usage: supersystem run <workflow_class> [goal]');
      process.exit(1);
    }
    const ok = await runWorkflow(wfClass, goal);
    process.exit(ok ? 0 : 1);

  } else {
    console.log('SuperSystem Runtime CLI');
    console.log();
    console.log('Commands:');
    console.log('  golden <code_change|mcp_tool>   Run a golden path end-to-end');
    console.log('  run <workflow_class> [goal]      Run a workflow with stubs');
    console.log();
    console.log('Examples:');
    console.log('  npx supersystem golden code_change');
    console.log('  npx supersystem run code_change "Add /healthz endpoint"');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
