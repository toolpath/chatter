import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BaseMachineConnector } from '../machines/BaseMachineConnector.js';
import { ConnectionLog, durationText } from './ConnectionLog.js';
import { captureLog, type CapturedLog } from './testSupport.js';

const START = new Date('2026-11-12T10:00:00.000Z').getTime();

/** A connector after a poll: only the status matters here */
function polled(connected: boolean, errors: string[] = []): BaseMachineConnector {
  return {
    getStatus: () => ({ id: 'm1', name: 'DNM 6700', type: 'siemens', host: '10.0.0.5', connected, errors }),
  } as unknown as BaseMachineConnector;
}

describe('ConnectionLog', () => {
  let log: CapturedLog;
  let now: number;
  let connections: ConnectionLog;

  /** The messages of the lines, without the time and the details */
  const messages = () => log.lines.map(line => line.text.replace(/^\S+ (\w+)\s+\[machines\] (.*?)( machine=.*)?$/, '$1 $2'));

  beforeEach(() => {
    log = captureLog();
    now = START;
    connections = new ConnectionLog(undefined, () => new Date(now));
  });

  afterEach(() => log.restore());

  it('logs the first poll of each machine, with the machine', () => {
    connections.record(polled(true));
    expect(messages()).toEqual(['INFO Machine connected']);
    expect(log.text()).toContain('machine=m1 name="DNM 6700" type=siemens host=10.0.0.5');
  });

  it('logs a machine that cannot be reached at the first poll, with the reason', () => {
    connections.record(polled(false, ['Unable to connect: ECONNREFUSED']));
    expect(messages()).toEqual(['WARN Machine cannot be reached']);
    expect(log.text()).toContain('reason="Unable to connect: ECONNREFUSED"');
  });

  it('logs nothing while nothing changes, also after many failed polls', () => {
    connections.record(polled(true));
    for (let i = 0; i < 100; i++) connections.record(polled(true));
    connections.record(polled(false, ['Poll failed: timeout']));
    for (let i = 0; i < 100; i++) connections.record(polled(false, ['Poll failed: timeout']));
    expect(messages()).toEqual(['INFO Machine connected', 'WARN Machine went offline']);
  });

  it('logs a new reason while the machine stays offline', () => {
    connections.record(polled(false, ['Unable to connect: ECONNREFUSED']));
    connections.record(polled(false, ['Unable to connect: EHOSTUNREACH']));
    connections.record(polled(false, ['Unable to connect: EHOSTUNREACH']));
    expect(messages()).toEqual(['WARN Machine cannot be reached', 'WARN Machine is still offline, for another reason']);
  });

  it('logs when the machine is back, and how long it was offline', () => {
    connections.record(polled(true));
    now = START + 1000;
    connections.record(polled(false, ['Poll failed: timeout']));
    now = START + 1000 + 3 * 3600_000 + 5 * 60_000;
    connections.record(polled(true));
    expect(messages().at(-1)).toBe('INFO Machine is online again');
    expect(log.lines.at(-1)?.text).toContain('offlineFor="3h 5m"');
  });

  it('counts the offline time from the first failed poll, not the last', () => {
    connections.record(polled(false, ['a']));
    now += 60_000;
    connections.record(polled(false, ['a']));
    now += 60_000;
    connections.record(polled(true));
    expect(log.text()).toContain('offlineFor=2m');
  });

  it('does not log a second message for the same cause as a new reason', () => {
    connections.record(polled(true));
    connections.record(polled(false, ['Poll failed: fetch failed']));
    connections.record(polled(false, ['Connection failed: fetch failed', 'Poll failed: fetch failed']));
    expect(messages()).toEqual(['INFO Machine connected', 'WARN Machine went offline']);
  });

  it('logs a problem of a connected machine one time, and when it is gone', () => {
    connections.record(polled(true));
    connections.record(polled(true, ['Alarms cannot be read: BadServiceUnsupported']));
    connections.record(polled(true, ['Alarms cannot be read: BadServiceUnsupported']));
    connections.record(polled(true));
    expect(messages()).toEqual(['INFO Machine connected', 'WARN Machine reports a problem', 'INFO Machine problem is gone']);
  });

  it('says nothing while a machine is still connecting, and then only how it ended', () => {
    let connecting = true;
    connections = new ConnectionLog(undefined, () => new Date(now), () => connecting);
    connections.record(polled(false, ['Unable to connect: ECONNREFUSED']));
    connections.record(polled(false, ['Unable to connect: ECONNREFUSED']));
    expect(messages()).toEqual([]);

    connecting = false;
    connections.record(polled(true));
    expect(messages()).toEqual(['INFO Machine connected']);
  });

  it('logs a machine that is still unreachable when its connecting time ends', () => {
    let connecting = true;
    connections = new ConnectionLog(undefined, () => new Date(now), () => connecting);
    connections.record(polled(false, ['Unable to connect: ECONNREFUSED']));
    connecting = false;
    connections.record(polled(false, ['Unable to connect: ECONNREFUSED']));
    expect(messages()).toEqual(['WARN Machine cannot be reached']);
  });

  it('starts again for a machine that is removed and added', () => {
    connections.record(polled(true));
    connections.removeMachine('m1');
    connections.record(polled(true));
    expect(messages()).toEqual(['INFO Machine connected', 'INFO Machine connected']);
  });
});

describe('durationText', () => {
  const at = (seconds: number) => new Date(START + seconds * 1000);

  it('gives seconds, minutes, hours and days', () => {
    expect(durationText(at(0), at(45))).toBe('45s');
    expect(durationText(at(0), at(12 * 60 + 30))).toBe('12m');
    expect(durationText(at(0), at(3 * 3600 + 5 * 60))).toBe('3h 5m');
    expect(durationText(at(0), at(2 * 86400 + 4 * 3600))).toBe('2d 4h');
  });

  it('gives nothing without a start', () => {
    expect(durationText(null, at(0))).toBeUndefined();
  });
});
