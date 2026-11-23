import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendToExistingLog, LogFile } from './LogFile.js';

describe('LogFile', () => {
  let folder: string;
  let filePath: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(os.tmpdir(), 'log-file-'));
    filePath = path.join(folder, 'logs', 'chatter.log');
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('makes the folder, and adds each line to the file', async () => {
    const file = new LogFile(filePath);
    file.write('one');
    file.write('two');
    await file.close();
    expect(readFileSync(filePath, 'utf8')).toBe('one\ntwo\n');
  });

  it('adds to the lines from before a restart', async () => {
    const first = new LogFile(filePath);
    first.write('before');
    await first.close();
    const second = new LogFile(filePath);
    second.write('after');
    await second.close();
    expect(readFileSync(filePath, 'utf8')).toBe('before\nafter\n');
  });

  it('adds a line after close() at once, so a request that ends while Chatter stops keeps its line', async () => {
    const file = new LogFile(filePath);
    file.write('before the stop');
    await file.close();

    file.write('after the stop');

    // No wait: the line is in the file before Chatter can exit
    expect(readFileSync(filePath, 'utf8')).toBe('before the stop\nafter the stop\n');
    await file.close();
  });

  it('keeps one old file when the file is full, so the log never takes more than 2 files', async () => {
    const file = new LogFile(filePath, 9);
    for (const text of ['aaaa', 'bbbb', 'cccc', 'dddd']) file.write(text);
    await file.close();
    expect(readFileSync(`${filePath}.1`, 'utf8')).toBe('cccc\n');
    expect(readFileSync(filePath, 'utf8')).toBe('dddd\n');
    expect(file.filePaths).toEqual([`${filePath}.1`, filePath]);
  });

  it('drops lines when the card is too slow, so at most 256 KB waits in memory, and tells how many it dropped', async () => {
    const file = new LogFile(filePath);
    const line = 'x'.repeat(999);
    // 600 KB in one tick: the card cannot write any of it before the loop ends
    for (let i = 0; i < 600; i++) file.write(line);
    await file.close();

    const text = readFileSync(filePath, 'utf8');
    const dropped = Number(/^\[(\d+) lines dropped: the card was too slow\]$/m.exec(text)?.[1]);
    expect(dropped).toBeGreaterThan(0);
    expect(text.split('\n').filter(written => written === line)).toHaveLength(600 - dropped);
    expect(Buffer.byteLength(text)).toBeLessThan(256 * 1024 + 2 * (line.length + 1));
  });

  it('a rotate that fails does not throw, and writes nothing more', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    // A folder with a file in it where the old file must go, so the rename fails
    mkdirSync(`${filePath}.1`, { recursive: true });
    writeFileSync(path.join(`${filePath}.1`, 'keep'), '');
    const file = new LogFile(filePath, 9);
    file.write('aaaa');
    // The file is full, so this line needs a rotate
    expect(() => file.write('bbbb')).not.toThrow();
    expect(() => file.write('cccc')).not.toThrow();
    await file.close();
    expect(readFileSync(filePath, 'utf8')).toBe('aaaa\n');
    expect(process.stderr.write).toHaveBeenCalledTimes(1);
  });

  it('a file that cannot be written does not throw, and writes nothing more', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    // A file where the folder must be, so the folder cannot be made
    writeFileSync(path.join(folder, 'logs'), 'not a folder');
    const file = new LogFile(filePath);
    expect(() => file.write('one')).not.toThrow();
    expect(() => file.write('two')).not.toThrow();
    await file.close();
    expect(existsSync(filePath)).toBe(false);
    expect(process.stderr.write).toHaveBeenCalledTimes(1);
  });
});

describe('appendToExistingLog (a second process, such as npm run reset-password)', () => {
  let folder: string;
  let filePath: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(os.tmpdir(), 'log-file-'));
    filePath = path.join(folder, 'logs', 'chatter.log');
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('adds the line to the log file of the server', () => {
    mkdirSync(path.dirname(filePath));
    writeFileSync(filePath, 'server line\n');

    expect(appendToExistingLog(filePath, 'reset line')).toBe(true);

    expect(readFileSync(filePath, 'utf8')).toBe('server line\nreset line\n');
  });

  it('makes no file and no folder, so a run as root cannot make a file that the server cannot write', () => {
    expect(appendToExistingLog(filePath, 'reset line')).toBe(false);

    expect(existsSync(path.dirname(filePath))).toBe(false);
  });
});
