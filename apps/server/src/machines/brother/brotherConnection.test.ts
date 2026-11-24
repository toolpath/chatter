import net from 'net';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BROTHER_RECONNECT_MS, BrotherConnector, MAX_BROTHER_REPLY_BYTES, NO_REPLY_ERROR } from './BrotherConnector.js';
import type { BrotherMachineStatus } from '../../types/index.js';
import { TOOL_SYNC_TIMEOUT_MS } from './toolSync.js';
import { captureLog, type CapturedLog } from '../../logging/testSupport.js';
import { ConnectionLog } from '../../logging/ConnectionLog.js';
import { HardwarePoller } from '../../polling/poller.js';
import type { MachineRegistry } from '../../polling/MachineRegistry.js';
import { MEM_FEED_HOLD, MOCK_RESPONSES, closeFakeBrothers, closedPort, startFakeBrother, type FakeBrother } from './testSupport.js';
import { sendForever } from '../testSupport.js';

/**
 * The TCP connection to the control, with a real socket and a fake Brother: the connect, a reply that does not come,
 * a connection that closes, and the planned reconnect every 60 seconds.
 */

/** A short timeout, so that a test does not wait long for a machine that does not answer */
const SHORT_TIMEOUT_MS = 150;

/** A reply that does not come */
const never = () => new Promise<void>(() => {});

let connector: BrotherConnector | undefined;

function connectorFor(port: number, timeout = SHORT_TIMEOUT_MS): BrotherConnector {
  connector = new BrotherConnector({ id: 'b1', name: 'Test', host: '127.0.0.1', dataPort: port, timeout });
  return connector;
}

/** A fake Brother that accepts the connection, and never answers */
const startSilentBrother = () => startFakeBrother({ hold: never });

afterEach(async () => {
  vi.restoreAllMocks();
  connector?.disconnect();
  connector = undefined;
  await closeFakeBrothers();
});

describe('Brother connection problems, with a real TCP connection', () => {
  it('tells that another program can hold the connection when the machine accepts it but does not answer', async () => {
    const fake = await startSilentBrother();

    const status = await connectorFor(fake.port).poll();

    expect(status.connected).toBe(false);
    expect(status.errors).toEqual([NO_REPLY_ERROR]);
  });

  it('connects again on the next poll after a machine did not answer', async () => {
    const fake = await startSilentBrother();
    const silent = connectorFor(fake.port);
    await silent.poll();

    await silent.poll();

    expect(fake.machineSides).toHaveLength(2);
  });

  it('gives one error line with the socket error, not the no-answer message, when nothing listens on the port', async () => {
    const status = await connectorFor(await closedPort()).poll();

    expect(status.connected).toBe(false);
    expect(status.errors).toEqual([expect.stringMatching(/^Unable to connect: connect ECONNREFUSED/)]);
  });

  it('gives one error line "Unable to connect: Connection timeout" when the connection does not open in time', async () => {
    // The connect never ends, as with a machine that is off behind a router
    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket) { return this; });

    const status = await connectorFor(10000).poll();

    expect(status.connected).toBe(false);
    expect(status.errors).toEqual(['Unable to connect: Connection timeout']);
  });

  it('writes one reason in the connection log for a failed connect', async () => {
    const log = captureLog();
    try {
      const brother = connectorFor(await closedPort());
      await brother.poll();

      new ConnectionLog().record(brother);

      expect(log.text('warn')).toMatch(/Machine cannot be reached.*reason="Unable to connect: connect ECONNREFUSED [^;"]*"/);
    } finally {
      log.restore();
    }
  });

  it('gives one error line when the machine resets the connection during a poll', async () => {
    const fake = await startSilentBrother();
    const brother = connectorFor(fake.port, 60_000);
    const poll = brother.poll();
    await vi.waitFor(() => expect(fake.commands).toContain('PANEL'));

    fake.machineSides[0].resetAndDestroy();
    const status = await poll;

    expect(status.connected).toBe(false);
    expect(status.errors).toEqual(['Poll failed: read ECONNRESET']);
  });

  it('tells the socket error when the machine resets the connection between two polls', async () => {
    const fake = await startFakeBrother();
    const brother = connectorFor(fake.port, 60_000);
    await brother.poll();

    fake.machineSides[0].resetAndDestroy();

    await vi.waitFor(() => expect(brother.getStatus().connected).toBe(false));
    expect(brother.getStatus().errors).toEqual(['Socket error: read ECONNRESET']);
  });

  it('gives no error when the machine answers each command', async () => {
    const fake = await startFakeBrother();

    const status = await connectorFor(fake.port).poll();

    expect(status.errors).toEqual([]);
    expect(status.connected).toBe(true);
    expect(status.data.partCount).toBe(78);
  });

  it('does not read a late reply as the reply to a command of the next poll', async () => {
    // A control answers in order. The first PANEL reply comes after the timeout, and it has an old mode (EDIT).
    const replies = { ...MOCK_RESPONSES, PANEL: MOCK_RESPONSES.PANEL.replace('K01,0,', 'K01,3,') };
    const fake = await startFakeBrother({
      replies,
      onCommand: (command, connection) => { if (command === 'PANEL' && connection > 1) replies.PANEL = MOCK_RESPONSES.PANEL; },
      hold: (command, connection) => (command === 'PANEL' && connection === 1
        ? new Promise(resolve => setTimeout(resolve, SHORT_TIMEOUT_MS + 50))
        : null),
    });
    const slowOnce = connectorFor(fake.port);

    const first = await slowOnce.poll();
    // At once, so the next poll waits for its PANEL reply when the late reply comes
    const next = await slowOnce.poll();

    expect(first.errors).toEqual([NO_REPLY_ERROR]);
    expect(next.errors).toEqual([]);
    expect(next.data.mode).toBe('MANUAL');
    expect(next.data.partCount).toBe(78);
  });

  it('connects again on the next poll after the machine closed the connection', async () => {
    const fake = await startFakeBrother();
    const answering = connectorFor(fake.port);
    await answering.poll();

    fake.machineSides[0].end();
    await vi.waitFor(() => expect(answering.connected).toBe(false));
    const status = await answering.poll();

    expect(fake.machineSides).toHaveLength(2);
    expect(status.errors).toEqual([]);
    expect(status.data.partCount).toBe(78);
  });

  it('stays connected when the old connection closes after a new connect', async () => {
    const fake = await startFakeBrother();
    const answering = connectorFor(fake.port);
    await answering.connect();
    const oldSocket = Reflect.get(answering, 'socket') as net.Socket;
    await answering.connect();
    await new Promise(resolve => (oldSocket.closed ? resolve(undefined) : oldSocket.once('close', resolve)));

    // A late 'close' of the old socket, as when it comes after the new connection opened
    oldSocket.emit('close', false);

    expect(answering.connected).toBe(true);
  });

  it('stays connected with no error when the time between two polls is longer than the timeout', async () => {
    const fake = await startFakeBrother();
    const answering = connectorFor(fake.port);
    await answering.poll();

    await new Promise(resolve => setTimeout(resolve, SHORT_TIMEOUT_MS * 2));

    expect(answering.getStatus().errors).toEqual([]);
    expect(answering.connected).toBe(true);
  });
});

describe('Brother socket options', () => {
  it('turns on TCP keepalive and sends each command at once', async () => {
    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket) { return this; });
    const keepAlive = vi.spyOn(net.Socket.prototype, 'setKeepAlive');
    const noDelay = vi.spyOn(net.Socket.prototype, 'setNoDelay');
    const connecting = connectorFor(10000, 60_000).connect();

    connector!.disconnect();
    await connecting.catch(() => {});

    expect(keepAlive).toHaveBeenCalledWith(true, expect.any(Number));
    expect(noDelay).toHaveBeenCalledWith(true);
  });
});

describe('Brother command when the connection closes', () => {
  /** Connected to a fake that never answers, with a timeout that the test never reaches */
  async function connectedToSilentBrother(): Promise<{ silent: BrotherConnector; fake: FakeBrother }> {
    const fake = await startSilentBrother();
    const silent = connectorFor(fake.port, 60_000);
    await silent.connect();
    return { silent, fake };
  }

  it('ends a waiting command with an error when Chatter disconnects, so the poll does not wait forever', async () => {
    const { silent } = await connectedToSilentBrother();
    const command = silent.sendCommand('PANEL');

    silent.disconnect();

    await expect(command).rejects.toThrow('The connection closed before the machine answered');
  });

  it('ends a waiting command with an error when the machine closes the connection', async () => {
    const { silent, fake } = await connectedToSilentBrother();
    await vi.waitFor(() => expect(fake.machineSides).toHaveLength(1));
    const command = silent.sendCommand('PANEL');

    fake.machineSides[0].end();

    await expect(command).rejects.toThrow('The connection closed before the machine answered');
  });

  it('ends a connect with an error when Chatter disconnects before the connection opens', async () => {
    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket) { return this; });
    const connecting = connectorFor(10000, 60_000).connect();

    connector!.disconnect();

    await expect(connecting).rejects.toThrow('The connection closed before it opened');
  });

  it('ends a poll with a reason when Chatter disconnects during a command', async () => {
    const { silent } = await connectedToSilentBrother();
    // poll() runs at once up to the first command, which then waits for a reply
    const poll = silent.poll();

    silent.disconnect();
    const status = await poll;

    expect(status.connected).toBe(false);
    expect(status.errors.join('; ')).toContain('The connection closed before the machine answered');
  });
});

describe('Brother planned reconnect every 60 seconds, with a real TCP connection', () => {
  let fake: FakeBrother;
  let brother: BrotherConnector;
  let log: CapturedLog;

  /** A fake Brother that tells what it sees, and a connector for it */
  async function startRecordingBrother(): Promise<void> {
    fake = await startFakeBrother();
    brother = connectorFor(fake.port, 1000);
  }

  /** A poll, and then what the connection log of the poller writes for it */
  async function pollAndLog(connectionLog: ConnectionLog) {
    const status = await brother.poll();
    connectionLog.record(brother);
    return status;
  }

  beforeEach(() => {
    // Only the clock is fake, so the sockets work as usual
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-21T08:00:00Z'));
    log = captureLog();
  });

  afterEach(() => {
    log.restore();
    vi.useRealTimers();
  });

  it('closes the connection in order and opens a new one at the first poll after 60 seconds', async () => {
    await startRecordingBrother();
    await brother.poll();
    vi.setSystemTime(Date.now() + 59_000);
    await brother.poll();
    expect(fake.events).toEqual(['connect 1']);

    vi.setSystemTime(Date.now() + 1_000);
    const status = await brother.poll();

    await vi.waitFor(() => expect(fake.events).toEqual(['connect 1', 'end 1', 'connect 2']));
    expect(status.connected).toBe(true);
    expect(status.errors).toEqual([]);
    expect(status.data.partCount).toBe(78);
    expect(BROTHER_RECONNECT_MS).toBe(60_000);
  });

  it('does not show the machine offline, and writes no connection log line for it', async () => {
    await startRecordingBrother();
    const connectionLog = new ConnectionLog();
    await pollAndLog(connectionLog);
    const linesBefore = log.text('info') + log.text('warn');

    vi.setSystemTime(Date.now() + BROTHER_RECONNECT_MS);
    const status = await pollAndLog(connectionLog);
    await pollAndLog(connectionLog);

    expect(status.connected).toBe(true);
    expect(log.text('info') + log.text('warn')).toBe(linesBefore);
    expect(log.text('debug')).toMatch(/Planned reconnect.*machine=b1/);
  });

  it('reads no tools at a planned reconnect, and accepts a Sync after it', async () => {
    await startRecordingBrother();
    await brother.poll();
    vi.setSystemTime(Date.now() + BROTHER_RECONNECT_MS);
    await brother.poll();
    expect(fake.events).toContain('connect 2');
    expect(fake.commands).not.toContain('ATCTL');

    expect((await brother.requestToolSync()).outcome).toBe('synced');
    expect(fake.commands).toContain('ATCTL');
  });

  it('counts the planned reconnects in the poll times', async () => {
    await startRecordingBrother();
    await brother.poll();

    vi.setSystemTime(Date.now() + BROTHER_RECONNECT_MS);
    const status = await brother.poll();

    expect(status.pollTimings?.plannedReconnects).toEqual({ count: 1, lastAt: new Date(Date.now()).toISOString() });
  });

  it.each([
    ['Chatter disconnects', (machine: BrotherConnector) => machine.disconnect()],
    ['the user removes the machine', (machine: BrotherConnector) => machine.dispose()],
  ])('ends a tool read with the reason when %s during it, clears its 20 s timer, and the next poll connects again', async (_, close) => {
    await startRecordingBrother();
    await brother.poll();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    fake.hold = command => (command === 'TOLNI1' ? never() : null);
    const sync = brother.requestToolSync();
    await vi.waitFor(() => expect(fake.commands.filter(command => command === 'TOLNI1')).toHaveLength(1));

    close(brother);
    const result = await sync;

    expect(result).toEqual({
      outcome: 'failed',
      toolSync: expect.objectContaining({ error: 'The connection closed before the machine answered', running: false }),
    });
    const timerCall = setTimeoutSpy.mock.calls.findIndex(([, ms]) => ms === TOOL_SYNC_TIMEOUT_MS);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(setTimeoutSpy.mock.results[timerCall].value);
    fake.hold = () => null;
    const status = await brother.poll();
    expect(status.connected).toBe(true);
    expect(status.errors).toEqual([]);
    expect(fake.events).toEqual(expect.arrayContaining(['connect 2']));
  });

  it('ends a Sync that waits for the state poll with the reason when the user removes the machine, and clears its 20 s timer', async () => {
    await startRecordingBrother();
    await brother.poll();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    fake.hold = command => (command === 'PDSP' ? never() : null);
    fake.commands.length = 0;
    const poll = brother.poll();
    await vi.waitFor(() => expect(fake.commands).toContain('PDSP'));
    const sync = brother.requestToolSync();

    brother.dispose();

    const result = await sync;
    expect(result).toEqual({
      outcome: 'failed',
      toolSync: expect.objectContaining({ error: expect.stringContaining('The connection closed before the machine answered'), running: false }),
    });
    const timerCall = setTimeoutSpy.mock.calls.findIndex(([, ms]) => ms === TOOL_SYNC_TIMEOUT_MS);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(setTimeoutSpy.mock.results[timerCall].value);
    expect(fake.commands).not.toContain('ATCTL');
    await poll;
  });

  it('does not reconnect while a tool read runs', async () => {
    await startRecordingBrother();
    await brother.poll();
    vi.setSystemTime(Date.now() + BROTHER_RECONNECT_MS);
    let releaseToolData: (() => void) | undefined;
    fake.hold = command => (command === 'TOLNI1' ? new Promise<void>(resolve => { releaseToolData = resolve; }) : null);
    const sync = brother.requestToolSync();
    await vi.waitFor(() => expect(releaseToolData).toBeDefined());

    const status = await brother.poll();

    expect(status.connected).toBe(true);
    expect(fake.events).toEqual(['connect 1']);
    releaseToolData!();
    expect((await sync).outcome).toBe('synced');
  });

  it('does not stop a poll that runs at the 60 s mark, and reconnects at the next poll', async () => {
    await startRecordingBrother();
    await brother.poll();
    vi.setSystemTime(Date.now() + 59_000);
    fake.onCommand = command => { if (command === 'MEM') vi.setSystemTime(Date.now() + 2_000); };

    const status = await brother.poll();

    expect(status.errors).toEqual([]);
    expect(fake.events).toEqual(['connect 1']);
    fake.onCommand = () => {};
    await brother.poll();
    await vi.waitFor(() => expect(fake.events).toEqual(['connect 1', 'end 1', 'connect 2']));
  });
});

describe('Brother planned reconnect when the control does not close its side', () => {
  let fake: FakeBrother;
  let log: CapturedLog;

  beforeEach(() => {
    log = captureLog();
  });

  afterEach(() => {
    log.restore();
    vi.useRealTimers();
  });

  /**
   * A fake Brother that gets the FIN of Chatter and keeps its own side open (allowHalfOpen), so the orderly close
   * waits its full 2 s. Gives a connector after its first poll, 60 s later, so its next poll makes the planned reconnect.
   */
  async function brotherThatKeepsItsSideOpen(): Promise<BrotherConnector> {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-11-21T08:00:00Z'));
    fake = await startFakeBrother({ allowHalfOpen: true });
    const brother = connectorFor(fake.port, 1000);
    await brother.poll();
    vi.setSystemTime(Date.now() + BROTHER_RECONNECT_MS);
    return brother;
  }

  it('destroys the old connection after 2 s, and the poll ends connected on a new connection', async () => {
    const brother = await brotherThatKeepsItsSideOpen();
    const oldSocket = Reflect.get(brother, 'socket') as net.Socket;
    let status: BrotherMachineStatus | undefined;
    const poll = brother.poll().then(result => { status = result; });
    await vi.advanceTimersByTimeAsync(1999);
    expect(status).toBeUndefined();
    expect(fake.machineSides).toHaveLength(1);
    // Chatter still waits for the control to close its side
    expect(oldSocket.destroyed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(oldSocket.destroyed).toBe(true);
    await poll;

    expect(fake.machineSides).toHaveLength(2);
    expect(status?.connected).toBe(true);
    expect(status?.errors).toEqual([]);
    expect(status?.data.partCount).toBe(78);
  });

  it('shows the machine online in each status and writes no log line while it waits for the orderly close', async () => {
    const brother = await brotherThatKeepsItsSideOpen();
    const poller = new HardwarePoller(new Database(':memory:'));
    (Reflect.get(poller, 'registry') as MachineRegistry).add(brother);
    const connectionLog = new ConnectionLog();
    connectionLog.record(brother);
    const poll = brother.poll();
    await vi.advanceTimersByTimeAsync(1000);

    expect(brother.getStatus().connected).toBe(true);
    // The poller sends this status to the screens after the poll of each machine, also of another machine
    expect(poller.getStatus().find(machine => machine.id === 'b1')).toMatchObject({ connected: true });
    connectionLog.record(brother);

    await vi.advanceTimersByTimeAsync(1000);
    await poll;
    expect(brother.getStatus().connected).toBe(true);
    expect(log.text('warn')).not.toContain('offline');
    // The reconnect has ended: when the control closes the new connection, the status shows the machine offline
    fake.machineSides.at(-1)!.destroy();
    await vi.waitFor(() => expect(brother.getStatus().connected).toBe(false));
  });

  it('shows the machine offline with the reason when the new connect fails', async () => {
    const brother = await brotherThatKeepsItsSideOpen();
    const connectionLog = new ConnectionLog();
    connectionLog.record(brother);
    const poll = brother.poll();
    // The control is gone: it takes no new connection
    fake.stopListening();

    await vi.advanceTimersByTimeAsync(2000);
    const status = await poll;

    // Also shows that the reconnect has ended: during it, the status says connected
    expect(status.connected).toBe(false);
    expect(status.errors.join('; ')).toContain('Unable to connect');
    connectionLog.record(brother);
    expect(log.text('warn')).toMatch(/Machine went offline.*Unable to connect/);
  });

  it('ends a Sync during a reconnect that fails with the reason of the connect', async () => {
    const brother = await brotherThatKeepsItsSideOpen();
    const poll = brother.poll();
    fake.stopListening();
    const sync = brother.requestToolSync();

    await vi.advanceTimersByTimeAsync(2000);
    await poll;

    expect(await sync).toEqual({
      outcome: 'failed', toolSync: expect.objectContaining({ error: expect.stringContaining('Unable to connect'), running: false }),
    });
  });

  it.each([
    ['disconnects it', (brother: BrotherConnector) => brother.disconnect()],
    ['removes it', (brother: BrotherConnector) => brother.dispose()],
  ])('shows the machine offline at once when Chatter %s during the reconnect, and opens no new connection', async (_, close) => {
    const brother = await brotherThatKeepsItsSideOpen();
    const poll = brother.poll();
    await vi.advanceTimersByTimeAsync(1000);

    close(brother);

    expect(brother.getStatus().connected).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    const status = await poll;
    expect(status.connected).toBe(false);
    expect(brother.getStatus().connected).toBe(false);
    // The scheduler polls a removed machine no more, so a new connection would hold the one client slot of the control
    expect(fake.machineSides).toHaveLength(1);
  });

  it('ends a Sync that waits for the reconnect with the reason when Chatter removes the machine, and reads no tools', async () => {
    const brother = await brotherThatKeepsItsSideOpen();
    const lastSyncAt = brother.getStatus().data.toolSync?.lastSyncAt;
    const poll = brother.poll();
    await vi.advanceTimersByTimeAsync(1000);
    const sync = brother.requestToolSync();

    brother.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    await poll;

    expect(await sync).toEqual({
      outcome: 'failed',
      toolSync: expect.objectContaining({ error: 'Unable to connect: The connection closed before it opened', lastSyncAt, running: false }),
    });
    expect(fake.machineSides).toHaveLength(1);
  });

  it('reads the tools after the reconnect when a user presses Sync during it', async () => {
    const brother = await brotherThatKeepsItsSideOpen();
    const poll = brother.poll();
    await vi.advanceTimersByTimeAsync(1000);

    const sync = brother.requestToolSync();
    await vi.advanceTimersByTimeAsync(1000);
    await poll;

    expect(await sync).toEqual({ outcome: 'synced', toolSync: expect.objectContaining({ error: null, running: false }) });
    expect(fake.machineSides).toHaveLength(2);
  });

  it('refuses a Sync during the reconnect when the new connection finds a feed hold, and reads no tools', async () => {
    const brother = await brotherThatKeepsItsSideOpen();
    // The poll before the reconnect said READY. The poll on the new connection finds a feed hold.
    fake.replies.MEM = MEM_FEED_HOLD;
    const poll = brother.poll();
    await vi.advanceTimersByTimeAsync(1000);

    const sync = brother.requestToolSync();
    await vi.advanceTimersByTimeAsync(1000);
    await poll;

    expect(await sync).toEqual({ outcome: 'program-running' });
    expect(fake.machineSides).toHaveLength(2);
    expect(fake.commands.filter(command => command.startsWith('ATCTL') || command.startsWith('TOLN'))).toEqual([]);
  });
});

describe('Brother reply size limit, with a real TCP connection', () => {
  let server: net.Server | undefined;
  const machineSides: net.Socket[] = [];

  /** A control that calls `answer` with its side of the connection at the first command */
  async function startControl(answer: (socket: net.Socket) => void): Promise<number> {
    const control = net.createServer(socket => {
      machineSides.push(socket);
      socket.on('error', () => {});
      socket.once('data', () => answer(socket));
    });
    server = control;
    await new Promise<void>(resolve => control.listen(0, '127.0.0.1', resolve));
    return (control.address() as net.AddressInfo).port;
  }

  afterEach(async () => {
    for (const socket of machineSides.splice(0)) socket.destroy();
    const control = server;
    server = undefined;
    if (control) await new Promise(resolve => control.close(resolve));
  });

  it('rejects a reply with no closing % at the limit, closes the connection and writes one warning', async () => {
    let sent: Promise<number> | undefined;
    const port = await startControl(socket => {
      socket.write('%RLOD    TOLNI1  00\r\n');
      sent = sendForever(socket);
    });
    const brother = connectorFor(port, 60_000);
    await brother.connect();
    const log = captureLog();
    try {
      await expect(brother.sendCommand('TOLNI1')).rejects.toThrow(
        'The machine sent a reply larger than 1 MB. Chatter stopped reading it and closed the connection.');

      expect(brother.connected).toBe(false);
      // The control stops when Chatter closes the connection. Only the socket buffers hold more than the limit. On
      // Linux, the receive and send buffers can hold about 10 MB together, so the margin is wide.
      expect(await sent).toBeLessThan(MAX_BROTHER_REPLY_BYTES + 32 * 1024 * 1024);
      expect(log.text('warn').split('\n')).toHaveLength(1);
      expect(log.text('warn')).toContain('b1');
      expect(log.text('warn')).toContain(String(MAX_BROTHER_REPLY_BYTES));
    } finally {
      log.restore();
    }
  });

  it('shows the machine offline with the reason when a poll gets an endless reply', async () => {
    const port = await startControl(socket => { void sendForever(socket); });

    const status = await connectorFor(port, 60_000).poll();

    expect(status.connected).toBe(false);
    expect(status.errors.join('; ')).toContain('The machine sent a reply larger than 1 MB.');
  });

  it('still reads the tool data of a real control, which is about 13 KB', async () => {
    const toolLines = Array.from({ length: 240 }, (_, i) =>
      `T${String(i + 1).padStart(2, '0')}, 1.5000, 0.0000, 0.2500, 0.0000, 0, 0, 0, 0, 'ENDMILL '`);
    const tolni1 = `RLOD    TOLNI1  00\r\n${toolLines.join('\r\n')}\r\n\r\n00%`;
    expect(tolni1.length).toBeGreaterThan(13 * 1024);
    const fake = await startFakeBrother({ replies: { ...MOCK_RESPONSES, TOLNI1: tolni1 } });
    const brother = connectorFor(fake.port, 60_000);
    await brother.connect();

    const reply = await brother.sendCommand('TOLNI1');

    expect(reply.T01).toEqual(['1.5000', '0.0000', '0.2500', '0.0000', '0', '0', '0', '0', "'ENDMILL '"]);
    expect(Object.keys(reply).filter(key => /^T\d+$/.test(key))).toHaveLength(240);
  });

  it('reads a reply that comes in parts, also with the closing % alone in the last part', async () => {
    const parts = ['%RLOD    PA', 'NEL   00\r\nD01,0,0,0\r\n\r\n10', '%'];
    const port = await startControl(async socket => {
      for (const part of parts) {
        socket.write(part);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    });
    const brother = connectorFor(port, 60_000);
    await brother.connect();

    const reply = await brother.sendCommand('PANEL');

    expect(reply.D01).toEqual(['0', '0', '0']);
  });

  /** Connect to a control that sends these parts with a short wait between them, and send one command */
  async function sendToSlowControl(parts: string[]) {
    const port = await startControl(async socket => {
      for (const part of parts) {
        socket.write(part);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    });
    const brother = connectorFor(port, 60_000);
    await brother.connect();
    return brother.sendCommand('PANEL');
  }

  it('reads a reply whose opening % is the last byte of a part after other data', async () => {
    const reply = await sendToSlowControl(['\r\n%', 'RLOD    PANEL   00\r\nD01,0,0,0\r\n\r\n10', '%']);

    expect(reply.D01).toEqual(['0', '0', '0']);
  });

  it('does not read the byte 0xA5 as a %, so a high byte cannot end a reply early', async () => {
    const port = await startControl(socket => {
      socket.write(Buffer.concat([
        Buffer.from('%RLOD    PANEL   00\r\nD01,'), Buffer.from([0xa5]), Buffer.from(',0,0\r\n\r\n10%'),
      ]));
    });
    const brother = connectorFor(port, 60_000);
    await brother.connect();

    const reply = await brother.sendCommand('PANEL');

    expect(reply.D01).toEqual(['¥', '0', '0']);
  });

  it('reads a reply of exactly the limit, when the closing % comes in the next part', async () => {
    const reply = sendToSlowControl(['%' + 'X'.repeat(MAX_BROTHER_REPLY_BYTES - 1), '%']);

    await expect(reply).resolves.toBeDefined();
  });

  it('rejects a reply of one byte more than the limit', async () => {
    const reply = sendToSlowControl(['%' + 'X'.repeat(MAX_BROTHER_REPLY_BYTES)]);

    await expect(reply).rejects.toThrow('The machine sent a reply larger than 1 MB.');
  });
});
