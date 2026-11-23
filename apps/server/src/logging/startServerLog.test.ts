import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAudit } from './audit.js';
import { startServerLog } from './startServerLog.js';

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
    // The text of the file at the time of the stop
    let textAtExit = '';
    const exit = vi.fn<(code: number) => void>(() => { textAtExit = readFileSync(logFile, 'utf-8'); });
    let serverLog;
    ({ serverLog, stopListening } = startServerLog(folder, { target, environment: {}, exit }));

    target.emit('uncaughtException', new Error('socket hang up'));

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(serverLog.filePaths).toContain(logFile);
    expect(textAtExit).toContain('socket hang up');
  });

  it('writes the audit lines to logs/audit.log, and each line is on the card before Chatter stops after a crash', async () => {
    const target = new EventEmitter();
    const auditFile = path.join(folder, 'logs', 'audit.log');
    let textAtExit = '';
    const exit = vi.fn<(code: number) => void>(() => { textAtExit = readFileSync(auditFile, 'utf-8'); });
    ({ stopListening } = startServerLog(folder, { target, environment: {}, exit }));

    writeAudit('Password try', { username: 'ann', result: 'no-such-user' });
    target.emit('uncaughtException', new Error('socket hang up'));

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(textAtExit).toMatch(/\[audit\] Password try username=ann result=no-such-user\n$/);
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
