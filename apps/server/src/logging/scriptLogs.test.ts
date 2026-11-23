import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeAudit } from './audit.js';
import { createLogger } from './logger.js';
import { connectScriptLogs } from './scriptLogs.js';
import { captureAudit } from './testSupport.js';

const log = createLogger('reset');

describe('connectScriptLogs (a second process, such as npm run reset-password)', () => {
  let folder: string;
  let logs: string;
  beforeEach(() => {
    folder = mkdtempSync(path.join(os.tmpdir(), 'script-logs-'));
    logs = path.join(folder, 'logs');
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it('adds the log lines to logs/chatter.log and the audit lines to logs/audit.log of the server', () => {
    mkdirSync(logs);
    writeFileSync(path.join(logs, 'chatter.log'), 'old server line\n');
    writeFileSync(path.join(logs, 'audit.log'), 'old audit line\n');

    const stop = connectScriptLogs(folder, {});
    try {
      log.warn('Made a new Admin', { username: 'ann' });
      writeAudit('Password reset made a new Admin', { username: 'ann' });
    } finally {
      stop();
    }

    expect(readFileSync(path.join(logs, 'chatter.log'), 'utf8')).toMatch(/^old server line\n.*\[reset\] Made a new Admin username=ann\n$/);
    expect(readFileSync(path.join(logs, 'audit.log'), 'utf8')).toMatch(/^old audit line\n.*\[audit\] Password reset made a new Admin username=ann\n$/);
  });

  it('makes no file when the server has not made it, so a run as root cannot make a file that the server cannot write', () => {
    const stop = connectScriptLogs(folder, {});
    try {
      log.warn('Made a new Admin', { username: 'ann' });
      writeAudit('Password reset made a new Admin', { username: 'ann' });
    } finally {
      stop();
    }

    expect(existsSync(logs)).toBe(false);
  });

  it('gives the audit lines back to the old sink when it stops', () => {
    const audit = captureAudit();
    try {
      connectScriptLogs(folder, {})();
      writeAudit('Password try', { username: 'ann' });

      expect(audit.lines).toEqual([expect.stringContaining('Password try username=ann')]);
    } finally {
      audit.restore();
    }
  });
});
