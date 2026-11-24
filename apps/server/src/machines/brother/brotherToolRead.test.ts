import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrotherConnector, NO_REPLY_ERROR } from './BrotherConnector.js';
import { TOOL_SYNC_READY_HOLD_MS, TOOL_SYNC_TIMEOUT_MS } from './toolSync.js';
import { applyBrotherUpdate } from '../../polling/machineSettings.js';
import {
  D00_ATCTLD,
  FakeConnection,
  MEM_FEED_HOLD,
  MEM_NO_RUN_STATE,
  MEM_RUNNING,
  MOCK_RESPONSES,
  UNKNOWN_ATCTL,
  UNKNOWN_ATCTLD,
  closeFakeBrothers,
  connectedBrother,
  startFakeBrother,
  unknownCommandReply,
} from './testSupport.js';

/**
 * The tool read: the tool table (ATC) and the tool data, read apart from the state polls, automatically or by Sync.
 * Also the control type (C00 or D00), which the first tool read finds, and what an address change does to both.
 */

const MACRO_REPLY = 'RLOD    MCRNI1  00\r\nC100, 42.0000\r\n\r\n00%';

/** The machine state: each poll reads these */
const STATE_COMMANDS = ['PANEL', 'MEM', 'ALARM', 'WKCNTR', 'PDSP', 'MCRNI1'];
/** The tool table and the tool data */
const TOOL_COMMANDS = ['ATCTL', 'TOLNI1'];

/** A command that does not end, for a test that must not wait */
const never = () => new Promise<void>(() => {});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await closeFakeBrothers();
});

/** Only the clock is fake, so the 30 s Sync limit and the 10 minutes can pass at once */
function useFakeClock() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-21T08:00:00Z'));
  });
}

/**
 * A connected Brother with a macro, on a fake clock. Each reply takes `msPerCommand` on that clock.
 * `poll` clears the list of sent commands first, so `fake.sent` has the commands of the last poll and its tool read.
 */
function machineThatTakes(msPerCommand: number) {
  const fake = connectedBrother({ ...MOCK_RESPONSES, MCRNI1: MACRO_REPLY }, { macros: [{ location: 100, name: 'Count' }] });
  fake.msPerCommand = msPerCommand;
  const poll = async () => {
    fake.sent.length = 0;
    return fake.connector.poll();
  };
  /** A poll, then the end of the tool sync that it can start */
  const pollAndSync = async () => {
    const status = await poll();
    await fake.connector.toolSyncEnded();
    return status;
  };
  /** READY polls for the hold time, so the last poll can start the automatic tool read */
  const pollUntilReadyHeld = async () => {
    await pollAndSync();
    vi.setSystemTime(Date.now() + TOOL_SYNC_READY_HOLD_MS);
    return pollAndSync();
  };
  return { fake, connector: fake.connector, replies: fake.replies, sent: fake.sent, poll, pollAndSync, pollUntilReadyHeld };
}

/** Sync the tools `count` times, 30 s apart (the Sync limit), and connect again before each one */
async function syncWithReconnects(fake: FakeConnection, count: number) {
  for (let i = 0; i < count; i++) {
    fake.connector.disconnect();
    await fake.connector.poll();
    await fake.connector.toolSyncEnded();
    await fake.connector.requestToolSync();
    vi.setSystemTime(Date.now() + 30_000);
  }
}

describe('Brother tool table from a tool sync', () => {
  it('puts the tool of each ATC pot in the table, with the offsets and name from the tool data', async () => {
    const fake = connectedBrother();
    const { connector } = fake;
    await fake.poll();

    await connector.requestToolSync();

    const { data } = connector.getStatus();
    expect(data.hasPocketInfo).toBe(true);
    expect(data.toolTable).toEqual({
      1: { toolNum: 1, length: 1.5, lengthWear: 0, diameter: 0.25, diameterWear: 0, name: 'ENDMILL' },
      2: { toolNum: 2 },
    });
  });

  it('reads tool data with 3-digit keys', async () => {
    const fake = connectedBrother({
      ...MOCK_RESPONSES,
      TOLNI1: "RLOD    TOLNI1  00\r\nT001, 1.5000, 0.0001, 0.2500, 0.0000, 0, 0, 0, 0, 'ENDMILL '\r\n\r\n00%",
    });
    const { connector } = fake;
    await fake.poll();

    await connector.requestToolSync();

    expect(connector.getStatus().data.toolTable?.[1]).toMatchObject({ length: 1.5, lengthWear: 0.0001, name: 'ENDMILL' });
  });

  it('asks for metric tool data when the unit is mm', async () => {
    const fake = connectedBrother({ ...MOCK_RESPONSES, TOLNM1: MOCK_RESPONSES.TOLNI1 }, { defaultUnit: 'mm' });
    await fake.poll();

    await fake.connector.requestToolSync();

    expect(fake.sent).toContain('TOLNM1');
    expect(fake.sent).not.toContain('TOLNI1');
  });
});

describe('Brother tool sync: the tool table and the tool data, read apart from the state polls', () => {
  useFakeClock();

  it('reads only the machine state in a poll, with the macros', async () => {
    const machine = machineThatTakes(100);
    machine.replies.MEM = MEM_RUNNING;

    await machine.pollAndSync();

    expect([...machine.sent].sort()).toEqual([...STATE_COMMANDS].sort());
  });

  it('does not read the tools while a program runs, also after 10 minutes and more', async () => {
    const machine = machineThatTakes(100);
    machine.replies.MEM = MEM_RUNNING;
    await machine.pollAndSync();

    vi.setSystemTime(Date.now() + 15 * 60_000);
    await machine.pollAndSync();

    expect(machine.sent).not.toEqual(expect.arrayContaining(['ATCTL']));
    expect(machine.sent).not.toContain('TOLNI1');
    expect(machine.connector.getStatus().data.toolSync?.lastSyncAt).toBeNull();
  });

  it('does not find the control type before the first tool read', async () => {
    const machine = machineThatTakes(100);
    machine.replies.MEM = MEM_RUNNING;

    const status = await machine.pollAndSync();

    expect(status.data.controlType).toBeNull();
    expect(machine.sent).not.toContain('ATCTL');
  });

  it('does not read the tools while the control has said READY for less than 2 minutes', async () => {
    const machine = machineThatTakes(100);
    await machine.pollAndSync();
    expect(machine.sent).not.toContain('ATCTL');

    vi.setSystemTime(Date.now() + TOOL_SYNC_READY_HOLD_MS - 1000);
    await machine.pollAndSync();

    expect(machine.sent).not.toContain('ATCTL');
    expect(machine.connector.getStatus().data.toolSync?.lastAttemptAt).toBeNull();
  });

  it('reads the tools when the control has said READY for 2 minutes with no break, the first time at once', async () => {
    const machine = machineThatTakes(100);

    await machine.pollUntilReadyHeld();

    expect(machine.sent.slice(-2)).toEqual(TOOL_COMMANDS);
    const { data } = machine.connector.getStatus();
    expect(data.toolTable?.[1]).toMatchObject({ toolNum: 1, length: 1.5, name: 'ENDMILL' });
    expect(data.controlType).toBe('C00');
    expect(data.toolSync).toEqual({ lastSyncAt: new Date(Date.now()).toISOString(), lastAttemptAt: new Date(Date.now()).toISOString(), error: null, running: false });
  });

  // The shop finding: a door open stops the spindle, and a tool read then kept the C00 from going into feed hold
  it.each([
    ['a program that runs (ACTIVE)', MEM_RUNNING],
    ['a feed hold', MEM_FEED_HOLD],
    ['no run state that Chatter knows', MEM_NO_RUN_STATE],
  ])('does not read the tools during %s, also when the spindle stands still for 15 minutes', async (_, mem) => {
    const machine = machineThatTakes(100);
    machine.replies.MEM = mem;
    await machine.pollAndSync();
    expect(machine.connector.getStatus().data.spindleSpeed).toBe(0);

    vi.setSystemTime(Date.now() + 15 * 60_000);
    await machine.pollAndSync();

    expect(machine.sent).not.toContain('ATCTL');
    expect(machine.sent).not.toContain('TOLNI1');
    expect(machine.connector.getStatus().data.toolSync?.lastAttemptAt).toBeNull();
  });

  it('starts the 2 minutes again after one poll that is not READY', async () => {
    const machine = machineThatTakes(100);
    await machine.pollAndSync();
    vi.setSystemTime(Date.now() + TOOL_SYNC_READY_HOLD_MS - 10_000);
    machine.replies.MEM = MEM_FEED_HOLD;
    await machine.pollAndSync();
    machine.replies.MEM = MOCK_RESPONSES.MEM;
    await machine.pollAndSync();

    vi.setSystemTime(Date.now() + 60_000);
    await machine.pollAndSync();
    expect(machine.sent).not.toContain('ATCTL');

    vi.setSystemTime(Date.now() + TOOL_SYNC_READY_HOLD_MS);
    await machine.pollAndSync();
    expect(machine.sent).toEqual(expect.arrayContaining(TOOL_COMMANDS));
  });

  it('starts the 2 minutes again after the connection was lost', async () => {
    const machine = machineThatTakes(100);
    await machine.pollAndSync();
    vi.setSystemTime(Date.now() + TOOL_SYNC_READY_HOLD_MS - 10_000);
    machine.connector.disconnect();
    await machine.pollAndSync();
    expect(machine.fake.connects).toBe(1);

    vi.setSystemTime(Date.now() + 60_000);
    await machine.pollAndSync();

    expect(machine.sent).not.toContain('ATCTL');
  });

  it('starts the 2 minutes again after a failed poll', async () => {
    const machine = machineThatTakes(100);
    await machine.pollAndSync();
    vi.setSystemTime(Date.now() + TOOL_SYNC_READY_HOLD_MS - 10_000);
    machine.fake.fail('MEM');
    expect((await machine.pollAndSync()).errors).not.toEqual([]);
    await machine.pollAndSync();

    vi.setSystemTime(Date.now() + 60_000);
    await machine.pollAndSync();

    expect(machine.sent).not.toContain('ATCTL');
  });

  it('does not read the tools again while idle when the last read is 10 minutes old or less', async () => {
    const machine = machineThatTakes(100);
    await machine.pollUntilReadyHeld();

    vi.setSystemTime(Date.now() + 10 * 60_000 - 1000);
    await machine.pollAndSync();

    expect(machine.sent).not.toContain('ATCTL');
  });

  it('reads the tools again while idle when the last read is more than 10 minutes old', async () => {
    const machine = machineThatTakes(100);
    await machine.pollUntilReadyHeld();

    vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);
    await machine.pollAndSync();

    expect(machine.sent).toEqual(expect.arrayContaining(TOOL_COMMANDS));
  });

  it('keeps the tool table between reads, so it stays on the screen and in the history', async () => {
    const machine = machineThatTakes(100);
    await machine.pollUntilReadyHeld();

    const status = await machine.pollAndSync();

    expect(status.data.toolTable?.[1]).toMatchObject({ toolNum: 1, length: 1.5, name: 'ENDMILL' });
    expect(machine.connector.getDataSnapshot().custom).toMatchObject({ toolTable: { 1: { toolNum: 1, length: 1.5 } } });
  });

  it('reads the tools at once when a user asks and the last poll said READY, with no wait for 2 minutes', async () => {
    const machine = machineThatTakes(100);
    await machine.pollAndSync();

    const result = await machine.connector.requestToolSync();

    expect(result).toEqual({ outcome: 'synced', toolSync: expect.objectContaining({ error: null, running: false }) });
    expect(machine.sent).toEqual(expect.arrayContaining(TOOL_COMMANDS));
  });

  it.each([
    ['a program runs', MEM_RUNNING],
    ['the machine is in a feed hold', MEM_FEED_HOLD],
    ['the run state is not known', MEM_NO_RUN_STATE],
  ])('refuses a request when %s, and sends no tool command', async (_, mem) => {
    const machine = machineThatTakes(100);
    machine.replies.MEM = mem;
    await machine.pollAndSync();

    expect(await machine.connector.requestToolSync()).toEqual({ outcome: 'program-running' });
    expect(machine.sent).not.toContain('ATCTL');
    expect(machine.sent).not.toContain('TOLNI1');
    // A refused request does not count in the limit of 30 seconds
    machine.replies.MEM = MOCK_RESPONSES.MEM;
    await machine.pollAndSync();
    expect((await machine.connector.requestToolSync()).outcome).toBe('synced');
  });

  it('refuses a request before the first poll', async () => {
    const machine = machineThatTakes(100);

    expect(await machine.connector.requestToolSync()).toEqual({ outcome: 'program-running' });
  });

  it('refuses a second request within 30 seconds, and a request while a read runs', async () => {
    const machine = machineThatTakes(100);
    await machine.fake.poll();
    await machine.connector.requestToolSync();

    expect(await machine.connector.requestToolSync()).toEqual({ outcome: 'too-soon', retryAfterSeconds: 30 });

    vi.setSystemTime(Date.now() + 30_000);
    const toolData = machine.fake.hold('TOLNI1');
    const running = machine.connector.requestToolSync();
    await vi.waitFor(() => expect(toolData.waiting).toBe(true));
    expect(await machine.connector.requestToolSync()).toEqual({ outcome: 'busy' });
    toolData.release();
    expect((await running).outcome).toBe('synced');
  });

  it('refuses a request when the machine is not connected', async () => {
    const machine = machineThatTakes(100);
    machine.connector.disconnect();

    expect(await machine.connector.requestToolSync()).toEqual({ outcome: 'not-connected' });
  });

  it('gives the error of a failed read, and keeps the last tool table', async () => {
    const machine = machineThatTakes(100);
    await machine.pollUntilReadyHeld();
    vi.setSystemTime(Date.now() + 60_000);
    machine.fake.fail('TOLNI1');

    const result = await machine.connector.requestToolSync();

    expect(result).toEqual({ outcome: 'failed', toolSync: expect.objectContaining({ error: 'No reply for TOLNI1' }) });
    expect(machine.connector.getStatus().data.toolTable?.[1]).toMatchObject({ length: 1.5 });
    expect(machine.connector.getStatus().errors).toEqual([]);
  });

  it('does not use the connection in a state poll while a tool read runs, and the poll is still good', async () => {
    const machine = machineThatTakes(100);
    await machine.fake.poll();
    const toolData = machine.fake.hold('TOLNI1');
    const sync = machine.connector.requestToolSync();
    await vi.waitFor(() => expect(toolData.waiting).toBe(true));

    const status = await machine.poll();

    expect(machine.sent).toEqual([]);
    expect(status.connected).toBe(true);
    expect(status.errors).toEqual([]);
    expect(status.data.toolSync?.running).toBe(true);
    toolData.release();
    await sync;
  });

  it('refuses a second Sync as busy while the first one waits for the state poll', async () => {
    const machine = machineThatTakes(100);
    await machine.fake.poll();
    const pdsp = machine.fake.hold('PDSP');
    const poll = machine.poll();
    await vi.waitFor(() => expect(pdsp.waiting).toBe(true));

    const first = machine.connector.requestToolSync();

    expect(await machine.connector.requestToolSync()).toEqual({ outcome: 'busy' });
    pdsp.release();
    await poll;
    expect((await first).outcome).toBe('synced');
    expect(machine.sent.filter(command => command === 'ATCTL')).toHaveLength(1);
  });

  it('waits for a state poll that runs before it starts a tool read', async () => {
    const machine = machineThatTakes(100);
    await machine.fake.poll();
    const pdsp = machine.fake.hold('PDSP');
    const poll = machine.poll();
    await vi.waitFor(() => expect(pdsp.waiting).toBe(true));

    const sync = machine.connector.requestToolSync();
    // Each promise that can settle now settles before setImmediate. Then a read that did not wait has sent ATCTL.
    await new Promise(resolve => setImmediate(resolve));
    expect(machine.sent).not.toContain('ATCTL');

    pdsp.release();
    await poll;
    await sync;
    expect(machine.sent.indexOf('ATCTL')).toBeGreaterThan(machine.sent.indexOf('MCRNI1'));
  });

  it.each([
    ['a feed hold', MEM_FEED_HOLD],
    ['a program that runs', MEM_RUNNING],
  ])('refuses a Sync when the state poll that it waited for found %s, and sends no tool command', async (_, mem) => {
    const machine = machineThatTakes(100);
    await machine.fake.poll();
    const panel = machine.fake.hold('PANEL');
    const poll = machine.poll();
    await vi.waitFor(() => expect(panel.waiting).toBe(true));
    const sync = machine.connector.requestToolSync();

    machine.replies.MEM = mem;
    panel.release();
    await poll;

    expect(await sync).toEqual({ outcome: 'program-running' });
    expect(machine.sent).not.toContain('ATCTL');
    expect(machine.sent).not.toContain('TOLNI1');
    expect(machine.connector.getStatus().data.toolSync).toEqual({ lastSyncAt: null, lastAttemptAt: null, error: null, running: false });
    // The refused Sync does not count in the limit of 30 seconds
    machine.replies.MEM = MOCK_RESPONSES.MEM;
    await machine.pollAndSync();
    expect((await machine.connector.requestToolSync()).outcome).toBe('synced');
  });

  it('refuses a Sync after a failed poll, which disconnects, and sends no tool command', async () => {
    const machine = machineThatTakes(100);
    await machine.pollAndSync();
    machine.fake.fail('MEM');
    expect((await machine.pollAndSync()).errors).not.toEqual([]);

    expect(await machine.connector.requestToolSync()).toEqual({ outcome: 'not-connected' });
    expect(machine.sent).not.toContain('ATCTL');
  });

  it('starts the 2 minutes again after the machine closed the connection', async () => {
    const machine = machineThatTakes(100);
    await machine.pollAndSync();
    vi.setSystemTime(Date.now() + TOOL_SYNC_READY_HOLD_MS - 10_000);
    machine.fake.machineClosed();
    await machine.pollAndSync();
    expect(machine.fake.connects).toBe(1);

    vi.setSystemTime(Date.now() + 60_000);
    await machine.pollAndSync();
    expect(machine.sent).not.toContain('ATCTL');

    vi.setSystemTime(Date.now() + TOOL_SYNC_READY_HOLD_MS);
    await machine.pollAndSync();
    expect(machine.sent).toEqual(expect.arrayContaining(TOOL_COMMANDS));
  });

  // The shop finding on a C00: a tool read at the time when an open door stopped the program kept the control from
  // going into feed hold. The spindle stopped, so the old rule started the read.
  it('shop finding: reads no tools at a door-open stop more than 10 minutes after the last read, nor in the 2 minutes of READY after it', async () => {
    const machine = machineThatTakes(100);
    await machine.pollUntilReadyHeld();
    expect(machine.sent).toEqual(expect.arrayContaining(TOOL_COMMANDS));
    const toolCommands: string[] = [];
    const record = () => toolCommands.push(...machine.sent.filter(command => TOOL_COMMANDS.includes(command)));

    vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);
    machine.replies.MEM = MEM_RUNNING;
    await machine.pollAndSync();
    record();
    vi.setSystemTime(Date.now() + 1000);
    machine.replies.MEM = MEM_FEED_HOLD;
    const status = await machine.pollAndSync();
    record();
    expect(status.data.spindleSpeed).toBe(0);

    machine.replies.MEM = MOCK_RESPONSES.MEM;
    await machine.pollAndSync();
    record();
    vi.setSystemTime(Date.now() + TOOL_SYNC_READY_HOLD_MS - 1000);
    await machine.pollAndSync();
    record();

    expect(toolCommands).toEqual([]);
  });
});

describe('Brother tool sync that does not end', () => {
  it('ends with an error after 20 seconds and disconnects, so the next poll connects again', async () => {
    vi.useFakeTimers();
    const fake = connectedBrother();
    await fake.poll();
    fake.hold('ATCTL');
    const { connector } = fake;

    let result: unknown;
    void connector.requestToolSync().then(value => { result = value; });

    await vi.advanceTimersByTimeAsync(19_999);
    expect(result).toBeUndefined();
    expect(connector.getStatus().data.toolSync?.running).toBe(true);
    expect(connector.connected).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ outcome: 'failed', toolSync: expect.objectContaining({ error: expect.stringContaining('20 seconds'), running: false }) });
    expect(connector.connected).toBe(false);
  });

  it('ends after 20 seconds also when it waits for a state poll that does not end, so the next poll runs', async () => {
    vi.useFakeTimers();
    const fake = connectedBrother();
    await fake.poll();
    fake.hold('PANEL', { keepAfterClose: true });
    const { connector } = fake;
    void connector.poll();
    const sync = connector.requestToolSync();

    await vi.advanceTimersByTimeAsync(20_000);

    expect(await sync).toEqual({ outcome: 'failed', toolSync: expect.objectContaining({ error: expect.stringContaining('20 seconds'), running: false }) });
    expect(connector.connected).toBe(false);
    fake.sent.length = 0;
    void connector.poll();
    await vi.waitFor(() => expect(fake.sent).toContain('PANEL'));
    expect(fake.connects).toBe(1);
  });

  it('does not start the tool read when the state poll ends after the 20 seconds', async () => {
    vi.useFakeTimers();
    const fake = connectedBrother();
    await fake.poll();
    const panel = fake.hold('PANEL', { keepAfterClose: true });
    const poll = fake.connector.poll();
    const sync = fake.connector.requestToolSync();
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await sync).outcome).toBe('failed');

    panel.release();
    await poll;
    await vi.advanceTimersByTimeAsync(0);

    expect(fake.sent).not.toContain('ATCTL');
    expect(fake.sent).not.toContain('TOLNI1');
  });

  it('does not start the tool read when a newer poll connected again before the old state poll ended', async () => {
    vi.useFakeTimers();
    const fake = connectedBrother();
    await fake.poll();
    const firstPanel = fake.hold('PANEL', { keepAfterClose: true });
    const oldPoll = fake.connector.poll();
    const sync = fake.connector.requestToolSync();
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await sync).outcome).toBe('failed');
    expect((await fake.connector.poll()).connected).toBe(true);

    firstPanel.release();
    await oldPoll;
    await vi.advanceTimersByTimeAsync(0);

    expect(fake.sent).not.toContain('ATCTL');
    expect(fake.sent).not.toContain('TOLNI1');
  });

  it('keeps a Sync waiting for the poll that runs now when an older poll, which the scheduler left behind, ends', async () => {
    const fake = connectedBrother();
    await fake.poll();
    const leftBehindPanel = fake.hold('PANEL');
    const newPanel = fake.hold('PANEL');
    const leftBehindPoll = fake.connector.poll();
    const newPoll = fake.connector.poll();
    await vi.waitFor(() => expect(newPanel.waiting).toBe(true));

    leftBehindPanel.release();
    await leftBehindPoll;
    const sync = fake.connector.requestToolSync();
    await new Promise(resolve => setImmediate(resolve));

    expect(fake.sent).not.toContain('ATCTL');
    newPanel.release();
    await newPoll;
    expect((await sync).outcome).toBe('synced');
    expect(fake.sent.indexOf('ATCTL')).toBeGreaterThan(fake.sent.lastIndexOf('ALARM'));
  });

  it('does not take the run state of a poll that the scheduler left behind and that ends after a newer poll', async () => {
    const fake = connectedBrother();
    await fake.poll();
    const leftBehindPdsp = fake.hold('PDSP');
    const leftBehindPoll = fake.connector.poll();
    await vi.waitFor(() => expect(leftBehindPdsp.waiting).toBe(true));
    fake.replies.MEM = MEM_FEED_HOLD;
    await fake.connector.poll();

    leftBehindPdsp.release();
    await leftBehindPoll;

    expect(await fake.connector.requestToolSync()).toEqual({ outcome: 'program-running' });
    expect(fake.sent).not.toContain('ATCTL');
  });
});

describe('Brother control type, found once by the reply status', () => {
  useFakeClock();

  it('should start with null controlType before detection', () => {
    const status = connectedBrother().connector.getStatus();

    expect(status.data).toHaveProperty('controlType');
    expect(status.data.controlType).toBeNull();
  });

  it('is a C00 control when ATCTL gives ATC pots', async () => {
    const fake = connectedBrother();
    const { connector } = fake;
    await fake.poll();

    await connector.requestToolSync();

    expect(connector.getStatus().data.controlType).toBe('C00');
  });

  it('is a D00 control when ATCTL is unknown and ATCTLD gives ATC pots', async () => {
    const fake = connectedBrother({ ...MOCK_RESPONSES, ATCTL: UNKNOWN_ATCTL, ATCTLD: D00_ATCTLD });
    const { connector } = fake;
    await fake.poll();

    await connector.requestToolSync();

    expect(connector.getStatus().data.controlType).toBe('D00');
  });

  it('has no control type when the control knows neither command', async () => {
    const fake = connectedBrother({ ...MOCK_RESPONSES, ATCTL: UNKNOWN_ATCTL, ATCTLD: UNKNOWN_ATCTLD });
    const { connector } = fake;
    await fake.poll();

    await connector.requestToolSync();

    expect(connector.getStatus().data.controlType).toBeNull();
    expect(connector.getStatus().data.hasPocketInfo).toBe(false);
  });

  it('never sends ATCTLD to a C00 control, across reconnects and tool syncs', async () => {
    const fake = connectedBrother({ ...MOCK_RESPONSES, ATCTLD: UNKNOWN_ATCTLD });

    await syncWithReconnects(fake, 3);

    expect(fake.sent).not.toContain('ATCTLD');
    expect(fake.sent.filter(command => command === 'ATCTL').length).toBeGreaterThanOrEqual(3);
    expect(fake.connector.getStatus().data.controlType).toBe('C00');
  });

  it('is a C00 control when ATCTL answers with status 00 and no pots, and does not try ATCTLD', async () => {
    const fake = connectedBrother({ ...MOCK_RESPONSES, ATCTL: 'RLOD    ATCTL   00\r\n\r\n00%', ATCTLD: UNKNOWN_ATCTLD });
    await fake.poll();

    await fake.connector.requestToolSync();

    expect(fake.connector.getStatus().data.controlType).toBe('C00');
    expect(fake.sent).not.toContain('ATCTLD');
  });

  it('on a D00 control, sends ATCTL one time only, and then ATCTLD', async () => {
    const fake = connectedBrother({ ...MOCK_RESPONSES, ATCTL: UNKNOWN_ATCTL, ATCTLD: D00_ATCTLD });

    await syncWithReconnects(fake, 3);

    expect(fake.sent.filter(command => command === 'ATCTL')).toHaveLength(1);
    expect(fake.sent.filter(command => command === 'ATCTLD').length).toBeGreaterThanOrEqual(3);
    expect(fake.connector.getStatus().data.controlType).toBe('D00');
    expect(fake.connector.getStatus().data.toolTable?.[1]).toMatchObject({ toolNum: 1 });
  });

  it('asks no ATC command again when the control knows neither, and still reads the tool data', async () => {
    const fake = connectedBrother({ ...MOCK_RESPONSES, ATCTL: UNKNOWN_ATCTL, ATCTLD: UNKNOWN_ATCTLD });

    await syncWithReconnects(fake, 3);

    expect(fake.sent.filter(command => command.startsWith('ATCTL'))).toEqual(['ATCTL', 'ATCTLD']);
    expect(fake.connector.getStatus().data.controlType).toBeNull();
    expect(fake.sent.filter(command => command === 'TOLNI1').length).toBeGreaterThanOrEqual(3);
  });
});

describe('Brother control type when a send fails during the detection', () => {
  useFakeClock();

  it.each([
    ['"Not connected", after the machine closed its side and before the close event', () => () => new Error('Not connected')],
    ['a closed connection', (fake: FakeConnection) => () => {
      fake.machineClosed();
      return new Error('The connection closed before the machine answered');
    }],
  ])('does not remember "knows neither" after %s on ATCTL, and finds C00 later', async (_, failure) => {
    const fake = connectedBrother({ ...MOCK_RESPONSES, ATCTLD: UNKNOWN_ATCTLD });
    await fake.poll();
    fake.fail('ATCTL', failure(fake));

    const failed = await fake.connector.requestToolSync();
    vi.setSystemTime(Date.now() + 30_000);
    await syncWithReconnects(fake, 1);

    expect(failed.outcome).toBe('failed');
    expect(fake.sent).not.toContain('ATCTLD');
    expect(fake.connector.getStatus().data.controlType).toBe('C00');
    expect(fake.connector.getStatus().data.hasPocketInfo).toBe(true);
  });

  it('on a D00, finds D00 later when ATCTLD gets "Not connected", and does not send ATCTL again', async () => {
    const fake = connectedBrother({ ...MOCK_RESPONSES, ATCTL: UNKNOWN_ATCTL, ATCTLD: D00_ATCTLD });
    await fake.poll();
    fake.fail('ATCTLD', () => new Error('Not connected'));

    const failed = await fake.connector.requestToolSync();
    vi.setSystemTime(Date.now() + 30_000);
    await syncWithReconnects(fake, 2);

    expect(failed.outcome).toBe('failed');
    expect(fake.sent.filter(command => command === 'ATCTL')).toHaveLength(1);
    expect(fake.connector.getStatus().data.controlType).toBe('D00');
    expect(fake.connector.getStatus().data.hasPocketInfo).toBe(true);
    expect(fake.connector.getStatus().data.toolTable?.[1]).toMatchObject({ toolNum: 1 });
  });
});

describe('Brother control type when the machine does not answer ATCTL, with a real TCP connection', () => {
  useFakeClock();

  it('sends ATCTL again at the next detection, finds C00, and sends no ATCTLD after the timeout', async () => {
    let atcCommands = 0;
    // The first ATCTL gets no reply
    const fake = await startFakeBrother({
      onCommand: command => { if (command === 'ATCTL') atcCommands++; },
      hold: command => (command === 'ATCTL' && atcCommands === 1 ? never() : null),
    });
    const connector = new BrotherConnector({ id: 'b1', name: 'Speedio', host: '127.0.0.1', dataPort: fake.port, timeout: 150 });

    const pollUntilReadyHeld = async () => {
      await connector.poll();
      vi.setSystemTime(Date.now() + TOOL_SYNC_READY_HOLD_MS);
      await connector.poll();
      await connector.toolSyncEnded();
    };

    await pollUntilReadyHeld();
    const first = connector.getStatus().data.toolSync;
    // The read with no reply disconnected, so the READY time starts again at the next poll
    await pollUntilReadyHeld();
    connector.disconnect();

    expect(first?.error).toBe(NO_REPLY_ERROR);
    expect(connector.getStatus().errors).toEqual([]);
    expect(connector.getStatus().data.controlType).toBe('C00');
    expect(fake.commands).not.toContain('ATCTLD');
    expect(fake.commands.filter(sent => sent === 'ATCTL')).toHaveLength(2);
  });
});

describe('Brother address update', () => {
  useFakeClock();
  const HOST = '192.168.1.50';
  const ATC_REPLY = 'RLOD    ATCTL   00\r\nM02,  1,0,0\r\n\r\n00%';

  /** A Brother with a fake connection. The control knows ATCTL when `knowsAtc` is true; it knows no ATCTLD. */
  function brotherThatAnswers(knowsAtc: boolean) {
    const fake = new FakeConnection(new BrotherConnector({ name: 'B', host: HOST }), { ...MOCK_RESPONSES });
    setKnowsAtc(fake, knowsAtc);
    const atcCommandsSent = () => fake.sent.filter(command => command.startsWith('ATCTL'));
    return { fake, connector: fake.connector, atcCommandsSent };
  }

  function setKnowsAtc(fake: FakeConnection, knowsAtc: boolean): void {
    if (knowsAtc) fake.replies.ATCTL = ATC_REPLY;
    else delete fake.replies.ATCTL;
  }

  /** READY polls for the hold time, and the automatic tool read that the last one starts */
  async function pollAndReadTools(connector: BrotherConnector): Promise<void> {
    await connector.poll();
    vi.setSystemTime(Date.now() + TOOL_SYNC_READY_HOLD_MS);
    await connector.poll();
    await connector.toolSyncEnded();
  }

  it.each([
    ['host', { host: '192.168.1.60' }],
    ['data port', { dataPort: 10001 }],
  ])('forgets the control type and the tool table when the %s changes', async (_, update) => {
    const { connector } = brotherThatAnswers(true);
    await pollAndReadTools(connector);
    expect(connector.getStatus().data).toMatchObject({ controlType: 'C00', hasPocketInfo: true });

    applyBrotherUpdate(connector, update);

    expect(connector.getStatus().data).toMatchObject({ controlType: null, hasPocketInfo: false, toolTable: {} });
  });

  it('asks the ATC commands again at the new address, also after the old control knew neither', async () => {
    const { fake, connector, atcCommandsSent } = brotherThatAnswers(false);
    await pollAndReadTools(connector);
    expect(atcCommandsSent()).toEqual(['ATCTL', 'ATCTLD']);

    applyBrotherUpdate(connector, { host: '192.168.1.60' });
    setKnowsAtc(fake, true);
    await pollAndReadTools(connector);

    expect(connector.getStatus().data.controlType).toBe('C00');
    expect(atcCommandsSent().filter(command => command === 'ATCTL').length).toBeGreaterThanOrEqual(2);
  });

  it('reads the tools after the READY hold time at the new address, not 10 minutes later', async () => {
    const { connector, atcCommandsSent } = brotherThatAnswers(true);
    await pollAndReadTools(connector);

    applyBrotherUpdate(connector, { host: '192.168.1.60' });
    expect(connector.getStatus().data.toolSync?.lastSyncAt).toBeNull();
    await pollAndReadTools(connector);

    expect(atcCommandsSent()).toEqual(['ATCTL', 'ATCTL']);
    expect(connector.getStatus().data).toMatchObject({ controlType: 'C00', hasPocketInfo: true });
  });

  it('does not read the tools at the new address before the control there has said READY for 2 minutes', async () => {
    const { connector, atcCommandsSent } = brotherThatAnswers(true);
    await pollAndReadTools(connector);

    applyBrotherUpdate(connector, { host: '192.168.1.60' });
    await connector.poll();
    vi.setSystemTime(Date.now() + TOOL_SYNC_READY_HOLD_MS - 1000);
    await connector.poll();
    await connector.toolSyncEnded();

    expect(atcCommandsSent()).toEqual(['ATCTL']);
  });

  it('records nothing of a tool read at the old address, and reads the tools after the READY hold time at the new address', async () => {
    const { fake, connector, atcCommandsSent } = brotherThatAnswers(true);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const toolData = fake.hold('TOLNI1');
    await connector.poll();
    vi.setSystemTime(Date.now() + TOOL_SYNC_READY_HOLD_MS);
    await connector.poll();
    await vi.waitFor(() => expect(toolData.waiting).toBe(true));

    applyBrotherUpdate(connector, { host: '192.168.1.60' });
    await connector.toolSyncEnded();

    expect(connector.getStatus().data.toolSync).toEqual({ lastSyncAt: null, lastAttemptAt: null, error: null, running: false });
    const timerCall = setTimeoutSpy.mock.calls.findIndex(([, ms]) => ms === TOOL_SYNC_TIMEOUT_MS);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(setTimeoutSpy.mock.results[timerCall].value);
    await pollAndReadTools(connector);
    expect(atcCommandsSent()).toEqual(['ATCTL', 'ATCTL']);
    expect(connector.getStatus().data).toMatchObject({ controlType: 'C00', hasPocketInfo: true, toolSync: { error: null, running: false } });
  });

  it('tells a user who pressed Sync that the address changed during the read', async () => {
    const { fake, connector } = brotherThatAnswers(true);
    await fake.poll();
    const toolData = fake.hold('TOLNI1');
    const sync = connector.requestToolSync();
    await vi.waitFor(() => expect(toolData.waiting).toBe(true));

    applyBrotherUpdate(connector, { dataPort: 10001 });

    expect(await sync).toEqual({ outcome: 'address-changed' });
    expect(connector.getStatus().data.toolSync).toMatchObject({ error: null, lastAttemptAt: null, running: false });
    // The user can press Sync again at once: the abandoned Sync does not count in the limit of 30 seconds
    await pollAndReadTools(connector);
    expect(await connector.requestToolSync()).toMatchObject({ outcome: 'synced' });
  });

  it('keeps nothing of a reply of the old control that came just before the address changed', async () => {
    const { fake, connector, atcCommandsSent } = brotherThatAnswers(true);
    await fake.poll();
    const atc = fake.hold('ATCTL');
    const sync = connector.requestToolSync();
    await vi.waitFor(() => expect(atc.waiting).toBe(true));

    // The old control does not know ATCTL. Its reply has come, but the read has not used it yet.
    atc.answer(unknownCommandReply('ATCTL'));
    applyBrotherUpdate(connector, { host: '192.168.1.60' });

    expect(await sync).toEqual({ outcome: 'address-changed' });
    expect(connector.getStatus().data.controlType).toBeNull();
    expect(atcCommandsSent()).toEqual(['ATCTL']);
    await pollAndReadTools(connector);
    // ATCTL is not marked as unknown for the control at the new address
    expect(atcCommandsSent()).toEqual(['ATCTL', 'ATCTL']);
    expect(connector.getStatus().data.controlType).toBe('C00');
  });

  it('shows no pot of the old control when the control at the new address knows no ATC command', async () => {
    const { fake, connector } = brotherThatAnswers(true);
    await pollAndReadTools(connector);
    expect(connector.getStatus().data.toolTable).toEqual({ 1: expect.objectContaining({ toolNum: 1 }) });

    applyBrotherUpdate(connector, { host: '192.168.1.60' });
    setKnowsAtc(fake, false);
    await pollAndReadTools(connector);

    expect(connector.getStatus().data).toMatchObject({ toolTable: {}, hasPocketInfo: false, toolSync: { error: null } });
    expect(connector.getStatus().data.toolSync?.lastSyncAt).toBe(new Date(Date.now()).toISOString());
  });

  it('keeps the control type when the update has the same host and port', async () => {
    const { connector } = brotherThatAnswers(true);
    await pollAndReadTools(connector);

    applyBrotherUpdate(connector, { name: 'Renamed', host: HOST, dataPort: connector.dataPort });

    expect(connector.getStatus().data).toMatchObject({ controlType: 'C00', hasPocketInfo: true });
  });
});
