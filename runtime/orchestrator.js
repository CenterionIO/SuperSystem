#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PolicyBundle } = require('./policy_engine');
const { EvidenceRegistry } = require('./evidence_registry');
const { VerifyEngine } = require('./verify_engine');
const { PlanAlignmentPlugin } = require('./plugins/plan_alignment');
const { EvidenceIntegrityPlugin } = require('./plugins/evidence_integrity');
const { FreshnessPlugin } = require('./plugins/freshness');

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

    this.verifyEngine = new VerifyEngine();
    this.verifyEngine.registerPlugin('unit', new PlanAlignmentPlugin());
    this.verifyEngine.registerPlugin('integration', new EvidenceIntegrityPlugin());
    this.verifyEngine.registerPlugin('freshness', new FreshnessPlugin());

    this.adapters = {};
  }

  setAdapter(role, adapter) {
    this.adapters[role] = adapter;
  }

  async run(workflowClass, goal, opts = {}) {
    const correlationId = opts.correlation_id || crypto.randomUUID();
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

    // Persist all intermediate artifacts
    if (runState.artifacts.research_report) {
      fs.writeFileSync(path.join(runDir, 'ResearchReport.json'), JSON.stringify(runState.artifacts.research_report, null, 2), 'utf8');
    }
    if (runState.artifacts.execution_plan) {
      fs.writeFileSync(path.join(runDir, 'ExecutionPlan.json'), JSON.stringify(runState.artifacts.execution_plan, null, 2), 'utf8');
    }
    if (runState.artifacts.build_report) {
      fs.writeFileSync(path.join(runDir, 'BuildReport.json'), JSON.stringify(runState.artifacts.build_report, null, 2), 'utf8');
    }

    // Persist run state (includes all artifacts + transitions)
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

    // Emit request.json (normalized goal payload)
    fs.writeFileSync(path.join(runDir, 'request.json'), JSON.stringify({
      correlation_id: correlationId,
      workflow_class: workflowClass,
      goal,
      requested_at: runState.started_at,
    }, null, 2), 'utf8');

    // Emit policy_snapshot.json (effective policy bundle)
    fs.writeFileSync(path.join(runDir, 'policy_snapshot.json'), JSON.stringify({
      correlation_id: correlationId,
      policy_version: this.policy.version || 'v1',
      routing_policy: this.policy.routingPolicy || {},
      workflow_taxonomy: this.policy.taxonomy || {},
      loop_control: this.loopControl,
      gate_sequence_version: this.gateSequence.version || 'v1',
      snapshot_at: new Date().toISOString(),
    }, null, 2), 'utf8');

    // Emit trace.jsonl
    const traceLines = runState.transitions.map(t => JSON.stringify(t));
    fs.writeFileSync(path.join(runDir, 'trace.jsonl'), traceLines.join('\n') + '\n', 'utf8');

    // Emit proof.json (fail-closed)
    let proofVerdict = 'fail';
    const vaPath = path.join(runDir, 'VerificationArtifact.json');
    const erPath = path.join(runDir, 'evidence_records.json');
    if (fs.existsSync(vaPath) && fs.existsSync(erPath)) {
      const va = JSON.parse(fs.readFileSync(vaPath, 'utf8'));
      const ers = JSON.parse(fs.readFileSync(erPath, 'utf8'));
      const evIds = new Set(ers.map(r => r.evidence_id));
      const allResolved = (va.criteria_results || []).every(cr =>
        (cr.evidence_ids || []).every(id => evIds.has(id))
      );
      const nonFailure = (va.overall_status === 'pass' || va.overall_status === 'warn');
      proofVerdict = (nonFailure && allResolved) ? va.overall_status : 'fail';
      fs.writeFileSync(path.join(runDir, 'proof.json'), JSON.stringify({
        correlation_id: correlationId,
        workflow_class: workflowClass,
        verdict: proofVerdict,
        overall_status: proofVerdict,
        created_at: new Date().toISOString(),
        evidence_count: ers.length,
        criteria_count: (va.criteria_results || []).length,
        all_evidence_resolved: allResolved,
        evidence_linkage_resolved: allResolved,
      }, null, 2), 'utf8');
    }

    // Emit manifest.json
    const manifestArtifacts = ['VerificationArtifact.json', 'evidence_records.json', 'proof.json', 'trace.jsonl', 'run_state.json', 'request.json', 'policy_snapshot.json'];
    const manifestEntries = [];
    for (const file of manifestArtifacts) {
      const filePath = path.join(runDir, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        manifestEntries.push({
          file,
          path: file,
          sha256: crypto.createHash('sha256').update(content).digest('hex'),
          size_bytes: Buffer.byteLength(content, 'utf8'),
        });
      }
    }
    fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({
      schema_version: 'v1',
      correlation_id: correlationId,
      workflow_class: workflowClass,
      required_artifacts: manifestArtifacts,
      created_at: new Date().toISOString(),
      artifacts: manifestEntries,
    }, null, 2), 'utf8');

    // Fail-closed: proof failure downgrades run status
    const flowStatus = runState.current_state === 'complete' ? 'pass' : (runState.current_state === 'escalation' ? 'blocked' : 'fail');
    const proofIsSuccess = (proofVerdict === 'pass' || proofVerdict === 'warn');
    const finalStatus = (flowStatus === 'pass' && !proofIsSuccess) ? 'fail' : flowStatus;

    return {
      status: finalStatus,
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
    const plan = run.artifacts.execution_plan;
    const build = run.artifacts.build_report;
    const evidenceRecords = this.registry.listByCorrelation(run.correlation_id);

    const result = this.verifyEngine.verify({
      correlation_id: run.correlation_id,
      execution_plan: plan,
      build_report: build,
      workflow_class: run.workflow_class,
      evidence_records: evidenceRecords,
    });

    run.artifacts.verification_artifact = result.artifact;

    // Persist
    const runDir = path.join(this.outDir, run.correlation_id);
    if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'VerificationArtifact.json'),
      JSON.stringify(result.artifact, null, 2),
      'utf8'
    );

    return { verdict: result.verdict };
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
