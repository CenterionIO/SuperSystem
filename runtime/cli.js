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

  printResult(result);

  // Post-run: validate generated output
  console.log();
  console.log('Post-run conformance validation:');
  const conformanceOk = validateRunOutput(result.output_dir);

  return result.status === 'pass' && conformanceOk;
}

async function runWorkflow(workflowClass, goal, opts = {}) {
  console.log(`Running workflow: ${workflowClass}`);
  console.log(`  Goal: ${goal}`);
  if (opts.correlation_id) console.log(`  Correlation ID: ${opts.correlation_id}`);
  console.log();

  const orch = createOrchestrator();
  const result = await orch.run(workflowClass, goal, opts);

  printResult(result);

  console.log();
  console.log('Post-run conformance validation:');
  const conformanceOk = validateRunOutput(result.output_dir);

  return result.status === 'pass' && conformanceOk;
}

function printResult(result) {
  console.log(`Result: ${result.status.toUpperCase()}`);
  console.log(`  Final state: ${result.final_state}`);
  console.log(`  Correlation ID: ${result.correlation_id}`);
  console.log(`  Transitions: ${result.transitions.length}`);
  console.log(`  Artifacts: ${result.artifacts.join(', ')}`);
  console.log(`  Output: ${result.output_dir}`);
  console.log();

  console.log('Transition log:');
  for (const t of result.transitions) {
    console.log(`  ${t.from} -> ${t.to}: ${t.reason}`);
  }
}

function validateRunOutput(runDir) {
  // Delegate to the standalone validator
  const validateRun = require('../tools/validate-run');
  return validateRun(runDir);
}

async function cmdValidateRun(runDir) {
  if (!runDir) {
    console.error('Usage: supersystem validate-run <out/<correlation_id>>');
    process.exit(1);
  }
  const absDir = path.resolve(runDir);
  if (!fs.existsSync(absDir)) {
    console.error(`Directory not found: ${absDir}`);
    process.exit(1);
  }
  const ok = validateRunOutput(absDir);
  process.exit(ok ? 0 : 1);
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
    // Support: run --request <file.json>  OR  run <workflow_class> [goal]
    const requestIdx = args.indexOf('--request');
    let wfClass, goal, opts = {};
    if (requestIdx !== -1 && args[requestIdx + 1]) {
      const reqFile = args[requestIdx + 1];
      if (!fs.existsSync(reqFile)) {
        console.error(`Request file not found: ${reqFile}`);
        process.exit(1);
      }
      const req = JSON.parse(fs.readFileSync(reqFile, 'utf8'));
      wfClass = req.workflow_class;
      goal = req.goal || 'Default goal';
      if (req.correlation_id) opts.correlation_id = req.correlation_id;
      if (req.risk_tier) opts.risk_tier = req.risk_tier;
      if (req.autonomy_mode) opts.autonomy_mode = req.autonomy_mode;
      if (Array.isArray(req.required_checks)) opts.required_checks = req.required_checks;
      if (Array.isArray(req.requested_checks)) opts.requested_checks = req.requested_checks;
      if (req.council_override_requested === true) opts.council_override_requested = true;
      if (Array.isArray(req.council_override_artifacts)) opts.council_override_artifacts = req.council_override_artifacts;
      if (req.simulate_platform_error === true) opts.simulate_platform_error = true;
      if (req.simulate_workflow_error === true) opts.simulate_workflow_error = true;
    } else {
      wfClass = args[1];
      goal = args.slice(2).join(' ') || 'Default goal';
    }
    if (!wfClass) {
      console.error('Usage: supersystem run <workflow_class> [goal]');
      console.error('       supersystem run --request <file.json>');
      process.exit(1);
    }
    const ok = await runWorkflow(wfClass, goal, opts);
    process.exit(ok ? 0 : 1);

  } else if (command === 'validate-run') {
    await cmdValidateRun(args[1]);

  } else if (command === 'validate-all') {
    const { execSync } = require('child_process');
    try {
      execSync('npm run validate:all', { cwd: ROOT, stdio: 'inherit' });
    } catch {
      process.exit(1);
    }

  } else {
    console.log('SuperSystem CLI');
    console.log();
    console.log('Commands:');
    console.log('  golden <code_change|mcp_tool>        Run golden path end-to-end + validate output');
    console.log('  run <workflow_class> [goal]           Run workflow with stubs + validate output');
    console.log('  run --request <file.json>             Run from canonical task request file');
    console.log('  validate-run <out/<correlation_id>>   Validate any run output directory');
    console.log('  validate-all                          Run all spec validators (task1-5)');
    console.log();
    console.log('Examples:');
    console.log('  npx supersystem golden code_change');
    console.log('  npx supersystem run code_change "Add /healthz endpoint"');
    console.log('  npx supersystem run --request task.json');
    console.log('  npx supersystem validate-run out/abc123-def4-...');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
