import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAudit } from './audit.js';
import { startServerLog } from './startServerLog.js';
import { captureAudit } from './testSupport.js';

/** An exit that reads a file when Chatter stops, and a promise of its code. No wait in real time. */
function exitThatReads(filePath: string) {
  let textAtExit = '';
  let exited: (code: number) => void = () => {};
  const code = new Promise<number>(resolve => {
    exited = resolve;
  });
  const exit = (exitCode: number) => {
    textAtExit = readFileSync(filePath, 'utf-8');
    exited(exitCode);
  };
  return { exit, code, text: () => textAtExit };
}

describe('startServerLog', () => {
  let folder: string;
  let stopListening = () => {};

  beforeEach(() => {
    folder = mkdtempSync(path.join(os.tmpdir(), 'server-log-'));
  });
  afterEach(() => {
    stopListening();
    rmSync(folder, { recursive: true, force: true });
  });

  it('stops Chatter on each kind of crash, one time for each kind', () => {
    const target = new EventEmitter();

    ({ stopListening } = startServerLog(folder, { target, environment: { LOG_FILE: 'off' }, exit: vi.fn() }));

    expect(target.listenerCount('uncaughtException')).toBe(1);
    expect(target.listenerCount('unhandledRejection')).toBe(1);
  });

  it('writes the crash to the log file before it stops, so Settings > Diagnostics shows it after the restart', async () => {
    const target = new EventEmitter();
    const logFile = path.join(folder, 'logs', 'chatter.log');
    const stop = exitThatReads(logFile);
    let serverLog;
    ({ serverLog, stopListening } = startServerLog(folder, { target, environment: {}, exit: stop.exit }));

    target.emit('uncaughtException', new Error('socket hang up'));

    await expect(stop.code).resolves.toBe(1);
    expect(serverLog.filePaths).toContain(logFile);
    expect(stop.text()).toContain('socket hang up');
  });

  it('writes the audit lines to logs/audit.log, and each line is on the card before Chatter stops after a crash', async () => {
    const target = new EventEmitter();
    const stop = exitThatReads(path.join(folder, 'logs', 'audit.log'));
    ({ stopListening } = startServerLog(folder, { target, environment: {}, exit: stop.exit }));

    writeAudit('Password try', { username: 'ann', result: 'no-such-user' });
    target.emit('uncaughtException', new Error('socket hang up'));

    await expect(stop.code).resolves.toBe(1);
    expect(stop.text()).toMatch(/\[audit\] Password try username=ann result=no-such-user\n$/);
  });

  it('makes no audit file with LOG_FILE=off, and keeps the audit sink as it was', async () => {
    const audit = captureAudit();
    try {
      let serverLog;
      ({ serverLog, stopListening } = startServerLog(folder, { target: new EventEmitter(), environment: { LOG_FILE: 'off' }, exit: vi.fn() }));

      writeAudit('Password try', { username: 'ann' });
      await serverLog.close();

      expect(audit.lines).toEqual([expect.stringContaining('Password try username=ann')]);
      expect(existsSync(path.join(folder, 'logs'))).toBe(false);
    } finally {
      audit.restore();
    }
  });

  it('stops the writes to the audit file when it stops listening', async () => {
    let serverLog;
    ({ serverLog, stopListening } = startServerLog(folder, { target: new EventEmitter(), environment: {}, exit: vi.fn() }));
    stopListening();
    stopListening = () => {};

    writeAudit('Password try', { username: 'ann' });
    await serverLog.close();

    expect(existsSync(path.join(folder, 'logs', 'audit.log'))).toBe(false);
  });
});
