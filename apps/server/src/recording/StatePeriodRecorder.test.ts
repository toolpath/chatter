import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BaseMachineConnector } from '../machines/BaseMachineConnector.js';
import type { MachineDataSnapshot } from '../types/index.js';
import { KEEP_PERIODS_MS, MARK_SEEN_EVERY_MS, StatePeriodRecorder } from './StatePeriodRecorder.js';
import { StatePeriodStore } from './StatePeriodStore.js';
import { captureLog } from '../logging/testSupport.js';

const START = Date.UTC(2026, 10, 9, 9, 0);
const ALL_TIME = { machineId: 'm1', from: 0, to: Number.MAX_SAFE_INTEGER, limit: 100 };

/** A machine that was just polled at this time, with these values */
function polled(time: number, values: Partial<MachineDataSnapshot> = {}): BaseMachineConnector {
  const snapshot = { timestamp: new Date(time).toISOString(), machineId: 'm1', machineType: 'fanuc', connected: true, ...values };
  return { connected: snapshot.connected, getDataSnapshot: () => snapshot } as unknown as BaseMachineConnector;
}

describe('StatePeriodRecorder', () => {
  let db: Database.Database;
  let store: StatePeriodStore;
  let now: number;
  let recorder: StatePeriodRecorder;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new StatePeriodStore(db);
    now = START;
    recorder = new StatePeriodRecorder(store, () => now);
  });

  it('opens a period for each state of the first poll', () => {
    recorder.record(polled(START, { program: 'O1', mode: 'MEM' }));

    expect(store.read(ALL_TIME)).toEqual(expect.arrayContaining([
      { kind: 'program', value: 'O1', start: START, end: undefined },
      { kind: 'mode', value: 'MEM', start: START, end: undefined },
    ]));
  });

  it('ends a period and opens the next one when a value changes', () => {
    recorder.record(polled(START, { program: 'O1' }));
    recorder.record(polled(START + 5000, { program: 'O2' }));

    expect(store.read(ALL_TIME)).toEqual([
      { kind: 'program', value: 'O2', start: START + 5000, end: undefined },
      { kind: 'program', value: 'O1', start: START, end: START + 5000 },
    ]);
  });

  it('keeps one period while the value stays the same', () => {
    recorder.record(polled(START, { program: 'O1' }));
    recorder.record(polled(START + 2000, { program: 'O1' }));

    expect(store.read(ALL_TIME)).toHaveLength(1);
  });

  it('ends an alarm period when the alarm goes off', () => {
    recorder.record(polled(START, { alarm: true, alarmCode: '1001' }));
    recorder.record(polled(START + 3000, { alarm: false }));

    expect(store.read(ALL_TIME)).toEqual([{ kind: 'alarm', value: '1001', start: START, end: START + 3000 }]);
  });

  it('ends every period when the machine stops answering, at the time of the poll', () => {
    recorder.record(polled(START, { program: 'O1' }));
    now = START + 10_000;
    recorder.record(polled(START, { connected: false, program: 'O1' }));

    expect(store.read(ALL_TIME)).toEqual([{ kind: 'program', value: 'O1', start: START, end: START + 10_000 }]);
  });

  it('ends the open periods when it stops', () => {
    recorder.record(polled(START, { program: 'O1' }));
    now = START + 7000;

    recorder.stop();

    expect(store.read(ALL_TIME)[0].end).toBe(START + 7000);
  });

  it('opens new periods for the next poll after a stop', () => {
    recorder.record(polled(START, { program: 'O1' }));
    recorder.stop();

    recorder.record(polled(START + 1000, { program: 'O1' }));

    expect(store.read(ALL_TIME)[0]).toEqual({ kind: 'program', value: 'O1', start: START + 1000, end: undefined });
  });

  it('ends a period that a sudden stop left open at the last time it was seen', () => {
    recorder.record(polled(START, { program: 'O1' }));
    recorder.record(polled(START + MARK_SEEN_EVERY_MS, { program: 'O1' }));
    recorder.record(polled(START + MARK_SEEN_EVERY_MS + 2000, { program: 'O1' }));

    // ChatterBox starts again without stop()
    new StatePeriodRecorder(new StatePeriodStore(db), () => now);

    expect(store.read(ALL_TIME)[0].end).toBe(START + MARK_SEEN_EVERY_MS);
  });

  it('removes the periods of a removed machine', () => {
    recorder.record(polled(START, { program: 'O1' }));

    recorder.removeMachine('m1');

    expect(store.read(ALL_TIME)).toEqual([]);
  });

  it('removes periods that ended more than a year ago', () => {
    recorder.record(polled(START, { program: 'O1' }));
    recorder.record(polled(START + 1000, { program: 'O2' }));
    now = START + 1000 + KEEP_PERIODS_MS + 1;
    // The next clean-up is due one hour after the first one
    now += 60 * 60_000;

    recorder.record(polled(now, { program: 'O2' }));

    expect(store.read(ALL_TIME).map(period => period.value)).toEqual(['O2']);
  });

  it('never stops the polling when a poll cannot be saved', () => {
    const log = captureLog();
    db.close();

    expect(() => recorder.record(polled(START, { program: 'O1' }))).not.toThrow();
    log.restore();
    expect(log.lines.filter(line => line.level === 'error')).toHaveLength(1);
  });
});

describe('StatePeriodStore.read', () => {
  let store: StatePeriodStore;

  beforeEach(() => {
    store = StatePeriodStore.inMemory();
    store.open('m1', 'program', 'O1', 1000);
    store.close('m1', 'program', 2000);
    store.open('m1', 'program', 'O2', 2000);
    store.open('m1', 'tool', '4', 1500);
    store.open('m2', 'program', 'O9', 1000);
  });

  it('gives the periods of one machine that overlap the time, newest first', () => {
    expect(store.read({ machineId: 'm1', from: 1800, to: 3000, limit: 10 }).map(period => period.value)).toEqual(['O2', '4', 'O1']);
  });

  it('leaves out a period that ended before the time starts', () => {
    expect(store.read({ machineId: 'm1', from: 2000, to: 3000, limit: 10 }).map(period => period.value)).toEqual(['O2', '4']);
  });

  it('gives only one kind when it is asked', () => {
    expect(store.read({ machineId: 'm1', from: 0, to: 3000, kind: 'tool', limit: 10 }).map(period => period.value)).toEqual(['4']);
  });

  it('gives at most `limit` periods', () => {
    expect(store.read({ machineId: 'm1', from: 0, to: 3000, limit: 1 })).toHaveLength(1);
  });
});
