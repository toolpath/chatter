import { describe, expect, it } from 'vitest';
import {
  HELPER_SILENCE_LIMIT_MS,
  parseHelperInfo,
  parseUpdateStatus,
  shownUpdateStatus,
  UPDATE_REQUESTS,
  type UpdateStatus,
} from '@local-chatter/shared';

const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const secondsAgo = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe('UPDATE_REQUESTS', () => {
  it('are the only two texts the helper accepts', () => {
    expect(UPDATE_REQUESTS).toEqual(['check', 'install']);
  });
});

describe('parseUpdateStatus', () => {
  it('reads a status that the helper wrote', () => {
    const text = JSON.stringify({ state: 'ready', version: '1.2.0', heartbeat: secondsAgo(5), freeBytes: 1000 });

    expect(parseUpdateStatus(text)).toEqual({ state: 'ready', version: '1.2.0', heartbeat: secondsAgo(5), freeBytes: 1000 });
  });

  it('keeps the reason and the freed space', () => {
    const text = JSON.stringify({ state: 'done', version: '1.2.0', heartbeat: secondsAgo(5), freeBytes: 10, freedBytes: 20, reason: 'x' });

    expect(parseUpdateStatus(text)).toMatchObject({ freedBytes: 20, reason: 'x' });
  });

  it('gives nothing for text that is not a status', () => {
    expect(parseUpdateStatus('not json')).toBeNull();
    expect(parseUpdateStatus(JSON.stringify({ state: 'exploded', heartbeat: secondsAgo(5), freeBytes: 0 }))).toBeNull();
    expect(parseUpdateStatus(JSON.stringify({ state: 'ready', heartbeat: 'yesterday', freeBytes: 0 }))).toBeNull();
    expect(parseUpdateStatus(JSON.stringify({ state: 'ready', heartbeat: secondsAgo(5), freeBytes: -1 }))).toBeNull();
  });

  it('drops a version that is not a release version, but keeps the status', () => {
    const text = JSON.stringify({ state: 'refused', heartbeat: secondsAgo(5), freeBytes: 0, version: 'v1' });

    expect(parseUpdateStatus(text)).toEqual({ state: 'refused', heartbeat: secondsAgo(5), freeBytes: 0 });
  });

  it('drops fields it does not know', () => {
    const text = JSON.stringify({ state: 'failed', heartbeat: secondsAgo(5), freeBytes: 0, extra: '<script>' });

    expect(parseUpdateStatus(text)).not.toHaveProperty('extra');
  });
});

describe('shownUpdateStatus', () => {
  const status = (state: UpdateStatus['state'], secondsSinceHeartbeat: number): UpdateStatus => ({
    state, heartbeat: secondsAgo(secondsSinceHeartbeat), freeBytes: 0,
  });

  it('keeps a busy status while the helper is alive', () => {
    expect(shownUpdateStatus(status('installing', 60), NOW).state).toBe('installing');
  });

  it('shows failed when a busy helper is silent for too long', () => {
    const silentSeconds = HELPER_SILENCE_LIMIT_MS / 1000 + 1;

    expect(shownUpdateStatus(status('checking', silentSeconds), NOW).state).toBe('failed');
    expect(shownUpdateStatus(status('installing', silentSeconds), NOW).state).toBe('failed');
  });

  it('never changes a status that is not busy', () => {
    expect(shownUpdateStatus(status('done', 3600), NOW).state).toBe('done');
  });
});

describe('parseHelperInfo', () => {
  it('reads the processor type that the helper wrote', () => {
    expect(parseHelperInfo('{"arch":"armv7"}')).toEqual({ arch: 'armv7' });
  });

  it('gives nothing for an unknown processor type', () => {
    expect(parseHelperInfo('{"arch":"armhf"}')).toBeNull();
    expect(parseHelperInfo('[]')).toBeNull();
  });
});
