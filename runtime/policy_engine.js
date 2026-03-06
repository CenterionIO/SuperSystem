#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

class PolicyBundle {
  constructor(policyDir) {
    const dir = policyDir || path.join(ROOT, 'policy', 'v1');
    this.taxonomy = JSON.parse(fs.readFileSync(path.join(dir, 'workflow_taxonomy.json'), 'utf8'));
    this.routing = JSON.parse(fs.readFileSync(path.join(dir, 'routing_policy.json'), 'utf8'));
    this.permissions = JSON.parse(fs.readFileSync(path.join(dir, 'permissions_policy.json'), 'utf8'));
    this.override = JSON.parse(fs.readFileSync(path.join(dir, 'override_policy.json'), 'utf8'));
  }

  classConfig(workflowClass) {
    return this.taxonomy.classes[workflowClass] || null;
  }

  classRoute(workflowClass) {
    return this.routing.classes[workflowClass] || null;
  }

  rolePermissions(role) {
    return this.permissions.roles[role] || null;
  }

  ladder(workflowClass) {
    const cfg = this.classConfig(workflowClass);
    return cfg ? cfg.verification_ladder : [];
  }

  requiredChecks(workflowClass) {
    const cfg = this.classConfig(workflowClass);
    return cfg ? cfg.required_checks : [];
  }

  normalFlow(workflowClass) {
    const route = this.classRoute(workflowClass);
    return route ? route.normal_flow : [];
  }

  reworkRoute(workflowClass, errorType) {
    const route = this.classRoute(workflowClass);
    return route ? route.rework_routes[errorType] : null;
  }

  applyFailClosed(status, required) {
    const fc = this.routing.fail_closed;
    if (!required) return status;
    if (status === 'warn') return fc.required_warn_behavior || 'blocked';
    if (!['pass', 'warn', 'fail', 'blocked'].includes(status)) return fc.required_missing_check_behavior || 'blocked';
    return status;
  }

  nextStateForVerdict(workflowClass, verdict, currentGate) {
    const route = this.classRoute(workflowClass);
    if (!route) return 'escalation';
    if (verdict === 'pass') return null; // use gate routing
    if (verdict === 'fail') return route.rework_routes.verification_fail;
    if (verdict === 'blocked' || verdict === 'warn') return route.blocked_evidence_route || 'escalation';
    return 'escalation';
  }
}

module.exports = { PolicyBundle };
