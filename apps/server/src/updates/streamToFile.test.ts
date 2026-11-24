import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTooLargeError, StreamIdleError, streamToFile } from './streamToFile.js';

const bytesOf = (text: string) => new TextEncoder().encode(text);

/** A stream that gives these pieces, one by one */
function streamOf(...pieces: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(bytesOf(piece));
      controller.close();
    },
  });
}

/** Limits that the tests do not reach, unless a test sets one lower */
const LIMITS = { maxBytes: 100, idleMs: 10_000 };

describe('streamToFile', () => {
  let folder: string;
  let file: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(os.tmpdir(), 'stream-to-file-'));
    file = path.join(folder, 'out');
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('writes each piece to the file, and gives the size', async () => {
    expect(await streamToFile(streamOf('abc', 'def'), file, LIMITS)).toBe(6);
    expect(readFileSync(file, 'utf8')).toBe('abcdef');
  });

  it('stops when the stream is larger than the limit', async () => {
    await expect(streamToFile(streamOf('abc', 'def'), file, { ...LIMITS, maxBytes: 5 })).rejects.toBeInstanceOf(FileTooLargeError);
  });

  it('never writes over a file that is there', async () => {
    await streamToFile(streamOf('first'), file, LIMITS);
    await expect(streamToFile(streamOf('second'), file, LIMITS)).rejects.toThrow();
    expect(readFileSync(file, 'utf8')).toBe('first');
  });

  it('fails when the stream fails', async () => {
    const broken = new ReadableStream<Uint8Array>({ pull: controller => controller.error(new Error('connection lost')) });
    await expect(streamToFile(broken, file, LIMITS)).rejects.toThrow('connection lost');
    expect(existsSync(file)).toBe(true);
  });

  it('stops when no bytes come in for the idle time, and cancels the stream', async () => {
    let isCancelled = false;
    const stalled = new ReadableStream<Uint8Array>({
      start: controller => controller.enqueue(bytesOf('abc')),
      cancel: () => void (isCancelled = true),
    });

    await expect(streamToFile(stalled, file, { ...LIMITS, idleMs: 30 })).rejects.toBeInstanceOf(StreamIdleError);
    expect(isCancelled).toBe(true);
  });

  it('does not stop a slow stream that keeps sending', async () => {
    // Fake time: each piece comes 30 ms after the last one was written, so the idle limit of 50 ms is never reached,
    // but the whole stream takes longer than the limit. Real time on a busy computer cannot change the result.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pieces = ['a', 'b', 'c', 'd'];
      let sent = 0;
      const writtenBytes = () => (existsSync(file) ? statSync(file).size : 0);
      const slow = new ReadableStream<Uint8Array>({
        async pull(controller) {
          // Wait until the last piece is written, so the idle timer started again (setImmediate is not faked)
          while (writtenBytes() < sent) await new Promise(resolve => setImmediate(resolve));
          const piece = pieces.shift();
          if (!piece) return controller.close();
          vi.advanceTimersByTime(30);
          sent += piece.length;
          controller.enqueue(bytesOf(piece));
        },
      });

      expect(await streamToFile(slow, file, { ...LIMITS, idleMs: 50 })).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
