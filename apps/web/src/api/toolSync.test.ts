import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolSyncState } from '../types';
import { ToolSyncError, syncTools } from './toolSync';

const FAILED: ToolSyncState = { lastSyncAt: null, lastAttemptAt: '2026-11-21T08:05:00.000Z', error: 'No reply', running: false };

function replyWith(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(text, { status, headers: { 'Content-Type': 'application/json' } })));
}

/** The error that syncTools throws */
async function errorOfSync(): Promise<ToolSyncError> {
  const error = await syncTools('m1').catch((err: unknown) => err);
  expect(error).toBeInstanceOf(ToolSyncError);
  return error as ToolSyncError;
}

describe('syncTools', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the server to read the tools of the machine, and gives the new state', async () => {
    replyWith(200, { toolSync: { ...FAILED, error: null } });

    expect(await syncTools('m1')).toEqual({ ...FAILED, error: null });
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('/api/machine/m1/tools/sync');
  });

  it('gives the text of the server and the state of the failed read', async () => {
    replyWith(502, { error: 'The machine did not send its tool table: No reply', outcome: 'failed', toolSync: FAILED });

    const error = await errorOfSync();

    expect(error.message).toBe('The machine did not send its tool table: No reply');
    expect(error.problem).toEqual({ outcome: 'failed', toolSync: FAILED });
  });

  it('gives the text and the seconds to wait when the server refuses a Sync that comes too soon', async () => {
    replyWith(429, { error: 'Chatter read the tool table a short time ago. Try again in 12 seconds.', outcome: 'too-soon', retryAfterSeconds: 12 });

    const error = await errorOfSync();

    expect(error.message).toBe('Chatter read the tool table a short time ago. Try again in 12 seconds.');
    expect(error.problem).toEqual({ outcome: 'too-soon', retryAfterSeconds: 12 });
  });

  it.each(['busy', 'not-connected', 'program-running'] as const)('gives the outcome %s of a refusal', async outcome => {
    replyWith(409, { error: 'Refused', outcome });

    expect((await errorOfSync()).problem).toEqual({ outcome });
  });

  it('gives the outcome "other" and a general text when the reply is not from Chatter', async () => {
    replyWith(504, '<html>Gateway Timeout</html>');

    const error = await errorOfSync();

    expect(error.message).toBe('Could not read the tool table');
    expect(error.problem).toEqual({ outcome: 'other' });
  });

  it('gives the outcome when the address changed during the read', async () => {
    replyWith(409, { error: 'The address of the machine changed during the read.', outcome: 'address-changed' });

    const error = await errorOfSync();

    expect(error.message).toBe('The address of the machine changed during the read.');
    expect(error.problem).toEqual({ outcome: 'address-changed' });
  });

  it('gives the text of the server and the outcome "other" for an error body with no outcome', async () => {
    replyWith(404, { error: 'Machine not found' });

    const error = await errorOfSync();

    expect(error.message).toBe('Machine not found');
    expect(error.problem).toEqual({ outcome: 'other' });
  });
});
