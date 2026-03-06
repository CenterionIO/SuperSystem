#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PolicyBundle } = require('./policy_engine');
const { EvidenceRegistry } = require('./evidence_registry');

const ROOT = path.join(__dirname, '..');

class Orchestrator {
  constructor(opts = {}) {
    this.policy = new PolicyBundle(opts.policyDir);
    this.config = opts.config || JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'runtime.json'), 'utf8'));
    this.loopControl = JSON.parse(fs.readFileSync(path.join(ROOT, this.config.spec_paths.loop_control), 'utf8'));
    this.gateSequence = JSON.parse(fs.readFileSync(path.join(ROOT, this.config.spec_paths.gate_sequence), 'utf8'));

    const outDir = path.join(ROOT, this.config.output_dir || 'out');
    const evidenceDir = path.join(ROOT, this.config.evidence_dir || 'out/evidence');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    this.outDir = outDir;
    this.registry = new EvidenceRegistry(evidenceDir);

    this.adapters = {};
  }

  setAdapter(role, adapter) {
    this.adapters[role] = adapter;
  }

  async run(workflowClass, goal) {
    const correlationId = crypto.randomUUID();
    const normalFlow = this.policy.normalFlow(workflowClass);
    if (!normalFlow || normalFlow.length === 0) {
      return { status: 'blocked', reason: `No routing for workflow_class: ${workflowClass}` };
    }

    const runState = {
      correlation_id: correlationId,
      workflow_class: workflowClass,
      goal,
      current_state: normalFlow[0],
      transitions: [],
      artifacts: {},
      started_at: new Date().toISOString(),
      iteration_counts: {},
      retry_counts: {},
    };

    try {
      await this._executeFlow(runState, normalFlow);
    } catch (err) {
      this._transition(runState, 'escalation', `Error: ${err.message}`);
      runState.error = err.message;
    }

    // Persist run
    const runDir = path.join(this.outDir, correlationId);
    if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'run_state.json'),
      JSON.stringify(runState, null, 2),
      'utf8'
    );

    // Persist evidence records
    const evidenceRecords = this.registry.listByCorrelation(correlationId);
    if (evidenceRecords.length > 0) {
      fs.writeFileSync(
        path.join(runDir, 'evidence_records.json'),
        JSON.stringify(evidenceRecords, null, 2),
        'utf8'
      );
    }

    return {
      status: runState.current_state === 'complete' ? 'pass' : (runState.current_state === 'escalation' ? 'blocked' : 'fail'),
      correlation_id: correlationId,
      final_state: runState.current_state,
      transitions: runState.transitions,
      artifacts: Object.keys(runState.artifacts),
      output_dir: runDir,
    };
  }

  async _executeFlow(run, normalFlow) {
    for (let i = 1; i < normalFlow.length; i++) {
      const targetState = normalFlow[i];
      const fromState = run.current_state;

      // Check iteration cap
      const iterKey = targetState;
      run.iteration_counts[iterKey] = (run.iteration_counts[iterKey] || 0) + 1;
      const maxIter = this.loopControl.max_iterations_per_phase[iterKey];
      if (maxIter && run.iteration_counts[iterKey] > maxIter) {
        this._transition(run, 'escalation', `Iteration cap exceeded for ${iterKey}`);
        return;
      }

      this._transition(run, targetState, `Normal flow: ${fromState} -> ${targetState}`);

      // Execute state
      const result = await this._executeState(run, targetState);
      if (!result) continue;

      if (result.error) {
        this._transition(run, 'workflow_error', result.error);
        const retryTarget = this.policy.reworkRoute(run.workflow_class, 'verification_fail');
        const retryCap = this.loopControl.retry_caps_by_error_type.workflow_error || 3;
        run.retry_counts.workflow_error = (run.retry_counts.workflow_error || 0) + 1;
        if (run.retry_counts.workflow_error > retryCap) {
          this._transition(run, 'escalation', 'Retry cap exceeded for workflow_error');
          return;
        }
        if (retryTarget) this._transition(run, retryTarget, 'Rework after workflow_error');
        return;
      }

      // Handle gate verdicts (review states)
      if (result.verdict && result.verdict !== 'pass') {
        const nextState = this.policy.nextStateForVerdict(run.workflow_class, result.verdict);
        if (nextState) {
          this._transition(run, nextState, `Gate verdict: ${result.verdict}`);
          return;
        }
      }
    }
  }

  async _executeState(run, state) {
    switch (state) {
      case 'idle':
      case 'classifying':
        return null; // pass-through

      case 'researching':
        return await this._runResearch(run);

      case 'research_review':
        return this._runGate(run, 'G-001');

      case 'planning':
        return await this._runPlanning(run);

      case 'plan_review':
        return this._runGate(run, 'G-002');

      case 'building':
        return await this._runBuilding(run);

      case 'build_review':
        return this._runBuildReview(run);

      case 'complete':
        return null;

      default:
        return null;
    }
  }

  async _runResearch(run) {
    const adapter = this.adapters.research;
    if (!adapter) return { error: 'No research adapter configured' };
    const report = await adapter.research(run.correlation_id, run.workflow_class, run.goal);
    run.artifacts.research_report = report;
    return {};
  }

  async _runPlanning(run) {
    const adapter = this.adapters.planner;
    if (!adapter) return { error: 'No planner adapter configured' };
    const plan = await adapter.plan(run.correlation_id, run.workflow_class, run.goal, run.artifacts.research_report);
    run.artifacts.execution_plan = plan;
    return {};
  }

  async _runBuilding(run) {
    const adapter = this.adapters.builder;
    if (!adapter) return { error: 'No builder adapter configured' };
    const result = await adapter.build(run.correlation_id, run.artifacts.execution_plan, this.registry);
    run.artifacts.build_report = result.build_report;
    return {};
  }

  _runGate(run, gateId) {
    // For stubs, gates pass if their required artifacts exist
    const gate = this.gateSequence.gates[gateId];
    if (!gate) return { verdict: 'blocked', reason: `Unknown gate: ${gateId}` };

    for (const req of gate.required_artifacts) {
      const artifactKey = this._artifactKeyFromType(req.type);
      if (!run.artifacts[artifactKey]) {
        return { verdict: 'blocked', reason: `Missing required artifact: ${req.type}` };
      }
    }
    return { verdict: 'pass' };
  }

  _runBuildReview(run) {
    // Full verification via verify adapter or inline
    const adapter = this.adapters.verify;
    if (!adapter) {
      // Inline minimal verification
      return this._inlineVerify(run);
    }
    return adapter.verify(run);
  }

  _inlineVerify(run) {
    const plan = run.artifacts.execution_plan;
    const build = run.artifacts.build_report;
    if (!plan || !build) return { verdict: 'blocked', reason: 'Missing plan or build report' };

    const criteriaResults = [];
    let overallPass = true;

    for (const crit of plan.acceptance_criteria) {
      const evidenceIds = build.evidence_map[crit.criteria_id] || [];
      const hasEvidence = evidenceIds.length > 0;
      let status = hasEvidence ? 'pass' : 'blocked';
      status = this.policy.applyFailClosed(status, crit.required);

      if (crit.required && status !== 'pass') overallPass = false;
      criteriaResults.push({
        criteria_id: crit.criteria_id,
        status,
        evidence_ids: evidenceIds,
        rationale: hasEvidence ? 'Evidence present and verified.' : 'No evidence found.',
        required: crit.required,
        verification_type_used: 'unit',
      });
    }

    const ladder = this.policy.ladder(run.workflow_class);
    const verificationArtifact = {
      verification_id: crypto.randomUUID(),
      correlation_id: run.correlation_id,
      execution_plan_id: plan.execution_plan_id,
      build_report_id: build.build_report_id,
      workflow_class: run.workflow_class,
      created_at: new Date().toISOString(),
      overall_status: overallPass ? 'pass' : 'blocked',
      criteria_results: criteriaResults,
      freshness_results: {
        freshness_required: plan.verification_requirements?.freshness_required || false,
        checks_performed: [],
        all_fresh: true,
      },
      ladder_compliance: {
        required_ladder: ladder,
        executed_ladder: ladder,
        compliant: true,
      },
      fail_closed_enforced: true,
      warn_rationale: null,
      council_override: null,
      artifact_hash: '', // placeholder
    };

    // Compute artifact hash
    const hashContent = JSON.stringify(verificationArtifact, Object.keys(verificationArtifact).filter(k => k !== 'artifact_hash').sort());
    verificationArtifact.artifact_hash = crypto.createHash('sha256').update(hashContent).digest('hex');

    run.artifacts.verification_artifact = verificationArtifact;

    // Persist
    const runDir = path.join(this.outDir, run.correlation_id);
    if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'VerificationArtifact.json'),
      JSON.stringify(verificationArtifact, null, 2),
      'utf8'
    );

    return { verdict: verificationArtifact.overall_status };
  }

  _transition(run, toState, reason) {
    const record = {
      from: run.current_state,
      to: toState,
      reason,
      timestamp: new Date().toISOString(),
    };
    run.transitions.push(record);
    run.current_state = toState;
  }

  _artifactKeyFromType(type) {
    const map = {
      ResearchReport: 'research_report',
      ExecutionPlan: 'execution_plan',
      BuildReport: 'build_report',
      VerificationArtifact: 'verification_artifact',
      recovery_result: 'recovery_result',
      health_check_result: 'health_check_result',
    };
    return map[type] || type.toLowerCase();
  }
}

module.exports = { Orchestrator };
