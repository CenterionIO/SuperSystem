#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class EvidenceRegistry {
  constructor(evidenceDir) {
    this.evidenceDir = evidenceDir;
    this.records = new Map();
    this.sequence = 0;
  }

  register(correlationId, evidenceType, content, producedBy) {
    this.sequence++;
    const corrShort = correlationId.substring(0, 8);
    const typeShort = this._typeShort(evidenceType);
    const evidenceId = `ev-${corrShort}-${String(this.sequence).padStart(4, '0')}-${typeShort}`;
    const ext = this._extension(evidenceType);

    const corrDir = path.join(this.evidenceDir, correlationId);
    if (!fs.existsSync(corrDir)) {
      fs.mkdirSync(corrDir, { recursive: true });
    }

    const filePath = path.join(corrDir, `${evidenceId}${ext}`);
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    fs.writeFileSync(filePath, contentStr, 'utf8');

    const contentHash = crypto.createHash('sha256').update(contentStr).digest('hex');
    const record = {
      evidence_id: evidenceId,
      correlation_id: correlationId,
      evidence_type: evidenceType,
      path: `evidence/${correlationId}/${evidenceId}${ext}`,
      content_hash: contentHash,
      produced_by: producedBy,
      produced_at: new Date().toISOString(),
      size_bytes: Buffer.byteLength(contentStr, 'utf8'),
    };

    this.records.set(evidenceId, record);
    return record;
  }

  resolve(evidenceId) {
    return this.records.get(evidenceId) || null;
  }

  resolveBatch(evidenceIds) {
    const found = [];
    const missing = [];
    for (const id of evidenceIds) {
      const rec = this.resolve(id);
      if (rec) found.push(rec);
      else missing.push(id);
    }
    return { found, missing };
  }

  verifyIntegrity(evidenceId) {
    const record = this.resolve(evidenceId);
    if (!record) return false;
    const absPath = path.join(this.evidenceDir, '..', record.path);
    if (!fs.existsSync(absPath)) return false;
    const content = fs.readFileSync(absPath, 'utf8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return hash === record.content_hash;
  }

  listByCorrelation(correlationId) {
    const results = [];
    for (const rec of this.records.values()) {
      if (rec.correlation_id === correlationId) results.push(rec);
    }
    return results;
  }

  allRecords() {
    return Array.from(this.records.values());
  }

  _typeShort(type) {
    const map = {
      diff: 'diff', test_log: 'tlog', command_log: 'clog',
      api_trace: 'atrc', screenshot: 'scrn', research_report: 'rrpt',
      source_references: 'sref', freshness_log: 'flog', transcript: 'trns',
      artifact_hash: 'ahsh', visual_diff: 'vdif', verification_report: 'vrpt',
    };
    return map[type] || type.substring(0, 4);
  }

  _extension(type) {
    const map = {
      diff: '.diff', test_log: '.log', command_log: '.json',
      api_trace: '.json', screenshot: '.png', research_report: '.json',
      source_references: '.json', freshness_log: '.json', transcript: '.txt',
      artifact_hash: '.json', visual_diff: '.png', verification_report: '.json',
    };
    return map[type] || '.json';
  }
}

module.exports = { EvidenceRegistry };
