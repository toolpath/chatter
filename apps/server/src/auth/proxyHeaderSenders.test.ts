import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SENDERS, MAX_WARNED_ADDRESSES, ProxyHeaderSenders } from './proxyHeaderSenders.js';
import { captureLog } from '../logging/testSupport.js';

describe('ProxyHeaderSenders', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function sendersAtTime() {
    let time = 0;
    return new ProxyHeaderSenders(() => new Date(++time * 1000));
  }

  it('lists the newest first, and moves a computer up when it sends again', () => {
    const senders = sendersAtTime();

    senders.record('10.0.0.1', true);
    senders.record('10.0.0.2', true);
    senders.record('10.0.0.1', true);

    expect(senders.list()).toEqual([
      { address: '10.0.0.1', lastSeen: new Date(3000) },
      { address: '10.0.0.2', lastSeen: new Date(2000) },
    ]);
  });

  it(`keeps only the last ${MAX_SENDERS}`, () => {
    const senders = sendersAtTime();

    for (let i = 0; i <= MAX_SENDERS; i++) senders.record(`10.0.0.${i}`, false);

    const addresses = senders.list().map(sender => sender.address);
    expect(addresses).toHaveLength(MAX_SENDERS);
    expect(addresses).not.toContain('10.0.0.0');
  });

  it('logs one time for each computer that is not trusted', () => {
    const log = captureLog();
    const senders = sendersAtTime();

    senders.record('10.0.0.9', false);
    senders.record('10.0.0.9', false);
    senders.record('127.0.0.1', true);

    log.restore();
    expect(log.lines.filter(line => line.level === 'warn')).toHaveLength(1);
    expect(log.text('warn')).toContain('address=10.0.0.9');
  });

  it(`logs at most ${MAX_WARNED_ADDRESSES} computers, also after they leave the list`, () => {
    const log = captureLog();
    const senders = sendersAtTime();

    for (let i = 0; i < MAX_WARNED_ADDRESSES + 5; i++) senders.record(`10.0.0.${i}`, false);
    senders.record('10.0.0.0', false);

    log.restore();
    expect(log.lines.filter(line => line.level === 'warn')).toHaveLength(MAX_WARNED_ADDRESSES);
  });
});
