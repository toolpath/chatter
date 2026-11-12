import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseMachineConnector } from '../machines/BaseMachineConnector.js';
import { MetricsWriter, type MetricsWriterOptions } from './MetricsWriter.js';
import { captureLog, type CapturedLog } from '../logging/testSupport.js';

const START = Date.UTC(2026, 10, 9, 9, 0);
const IMPORT_PATH = '/api/v1/import/prometheus';
const DELETE_SERIES_PATH = '/api/v1/admin/tsdb/delete_series';

/** A machine that was just polled, with this spindle speed at this time */
function polled(time: number, spindleSpeed: number, { connected = true } = {}): BaseMachineConnector {
  return {
    connected,
    getDataSnapshot: () => ({
      timestamp: new Date(time).toISOString(),
      machineId: 'm1',
      machineType: 'brother',
      connected,
      spindleSpeed,
    }),
  } as unknown as BaseMachineConnector;
}

const speedLine = (time: number, speed: number) => `chatter_spindle_speed{machine="m1",type="brother"} ${speed} ${time}`;
const connectedLine = (time: number, connected: 0 | 1) => `chatter_connected{machine="m1",type="brother"} ${connected} ${time}`;

/** Start the server on a free port and give its address */
async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A fake VictoriaMetrics that keeps each import request and answers with the next status */
class FakeVictoriaMetrics {
  readonly requests: { path: string; lines: string[] }[] = [];
  status = 204;
  private server?: Server;

  async start(): Promise<string> {
    this.server = createServer((request, response) => {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        this.requests.push({ path: request.url ?? '', lines: body.split('\n').filter(Boolean) });
        response.statusCode = this.status;
        response.end(this.status >= 400 ? 'cannot parse the lines' : '');
      });
    });
    return listen(this.server);
  }

  async stop(): Promise<void> {
    await new Promise(resolve => this.server?.close(resolve));
  }

  get sentLines(): string[] {
    return this.importRequests.flatMap(request => request.lines);
  }

  get importRequests() {
    return this.requests.filter(request => request.path === IMPORT_PATH);
  }
}

/** An address where nothing listens */
async function closedAddress(): Promise<string> {
  const fake = new FakeVictoriaMetrics();
  const url = await fake.start();
  await fake.stop();
  return url;
}

describe('MetricsWriter', () => {
  let fake: FakeVictoriaMetrics;
  let url: string;
  let now: number;
  let writers: MetricsWriter[];
  let log: CapturedLog;

  const writer = (options: Partial<Omit<MetricsWriterOptions, 'now'>> = {}) => {
    const created = new MetricsWriter({ url, now: () => now, ...options });
    writers.push(created);
    return created;
  };

  beforeEach(async () => {
    fake = new FakeVictoriaMetrics();
    url = await fake.start();
    now = START;
    writers = [];
    log = captureLog();
  });

  afterEach(async () => {
    await Promise.all(writers.map(created => created.stop()));
    await fake.stop();
    log.restore();
    vi.restoreAllMocks();
  });

  it('sends the lines of each poll to the Prometheus import route', async () => {
    const metrics = writer();
    metrics.record(polled(START, 1200));
    metrics.record(polled(START + 1000, 1300));

    await metrics.flush();

    expect(fake.requests.map(request => request.path)).toEqual([IMPORT_PATH]);
    expect(fake.sentLines).toEqual([
      connectedLine(START, 1), speedLine(START, 1200),
      connectedLine(START + 1000, 1), speedLine(START + 1000, 1300),
    ]);
  });

  it('does not send anything when there is nothing new', async () => {
    await writer().flush();

    expect(fake.requests).toEqual([]);
  });

  it('does not write a poll again when the machine sends its last values with the same time', async () => {
    const metrics = writer();
    metrics.record(polled(START, 1200));
    metrics.record(polled(START, 1200));

    await metrics.flush();

    expect(fake.sentLines).toEqual([connectedLine(START, 1), speedLine(START, 1200)]);
  });

  it('writes "not connected" at the time of the poll, because the snapshot time is the last good poll', async () => {
    const metrics = writer();
    now = START + 5000;
    metrics.record(polled(START, 1200, { connected: false }));

    await metrics.flush();

    expect(fake.sentLines).toEqual([connectedLine(START + 5000, 0)]);
  });

  it('keeps the lines when VictoriaMetrics has a problem, and sends them on the next try', async () => {
    const metrics = writer();
    fake.status = 503;
    metrics.record(polled(START, 1200));
    await metrics.flush();

    fake.status = 204;
    metrics.record(polled(START + 1000, 1300));
    await metrics.flush();

    expect(fake.requests.at(-1)?.lines).toEqual([
      connectedLine(START, 1), speedLine(START, 1200),
      connectedLine(START + 1000, 1), speedLine(START + 1000, 1300),
    ]);
  });

  it('keeps the lines when VictoriaMetrics does not answer', async () => {
    const metrics = writer({ url: await closedAddress() });
    metrics.record(polled(START, 1200));

    await expect(metrics.flush()).resolves.toBeUndefined();
    expect(metrics.bufferedLineCount).toBe(2);
    expect(log.text('error')).toContain('ECONNREFUSED');
  });

  it('shows each new kind of error one time only', async () => {
    const metrics = writer();
    fake.status = 503;
    for (let second = 0; second < 3; second++) {
      metrics.record(polled(START + second * 1000, 1200));
      await metrics.flush();
    }

    expect(log.lines.filter(line => line.level === 'error')).toHaveLength(1);
    expect(log.text('error')).toContain('503');
  });

  it('drops the lines that VictoriaMetrics refuses, because sending them again cannot work', async () => {
    const metrics = writer();
    fake.status = 400;
    metrics.record(polled(START, 1200));
    await metrics.flush();

    fake.status = 204;
    await metrics.flush();

    expect(fake.requests).toHaveLength(1);
    expect(metrics.bufferedLineCount).toBe(0);
  });

  it.each([408, 429])('keeps the lines when VictoriaMetrics answers %s, because that means "try again later"', async status => {
    const metrics = writer();
    fake.status = status;
    metrics.record(polled(START, 1200));
    await metrics.flush();

    expect(metrics.bufferedLineCount).toBe(2);
  });

  it('does not write a poll that has no valid time, and keeps the other lines', async () => {
    const metrics = writer();
    metrics.record(polled(START, 1200));
    metrics.record({ connected: true, getDataSnapshot: () => ({ ...polled(START, 1).getDataSnapshot(), timestamp: 'not a time' }) } as unknown as BaseMachineConnector);

    await metrics.flush();

    expect(fake.sentLines).toEqual([connectedLine(START, 1), speedLine(START, 1200)]);
    expect(log.text('error')).toContain('no valid time');
  });

  it('drops the oldest lines when too many wait, and tells how many were lost when it works again', async () => {
    const metrics = writer({ maxBufferedLines: 4 });
    fake.status = 503;
    for (let second = 0; second < 3; second++) metrics.record(polled(START + second * 1000, 1200 + second));
    await metrics.flush();

    fake.status = 204;
    await metrics.flush();

    expect(fake.requests.at(-1)?.lines).toEqual([
      connectedLine(START + 1000, 1), speedLine(START + 1000, 1201),
      connectedLine(START + 2000, 1), speedLine(START + 2000, 1202),
    ]);
    expect(log.text('info')).toContain('2 values were lost');
  });

  it('sends a long wait list in more than one request', async () => {
    const metrics = writer({ maxLinesPerRequest: 2 });
    for (let second = 0; second < 3; second++) metrics.record(polled(START + second * 1000, 1200));

    await metrics.flush();

    expect(fake.requests.map(request => request.lines.length)).toEqual([2, 2, 2]);
  });

  it('sends only one request at a time', async () => {
    const metrics = writer();
    metrics.record(polled(START, 1200));

    await Promise.all([metrics.flush(), metrics.flush()]);

    expect(fake.requests).toHaveLength(1);
  });

  it('sends the lines on a timer after start()', async () => {
    const metrics = writer({ flushEveryMs: 10 });
    metrics.start();
    metrics.record(polled(START, 1200));

    await vi.waitFor(() => expect(fake.sentLines).toHaveLength(2));
  });

  it('sends the last lines when it stops', async () => {
    const metrics = writer({ flushEveryMs: 60_000 });
    metrics.start();
    metrics.record(polled(START, 1200));

    await metrics.stop();

    expect(fake.sentLines).toHaveLength(2);
  });

  it('deletes the history of a removed machine', async () => {
    await writer().removeMachine('m1');

    expect(fake.requests).toEqual([{ path: DELETE_SERIES_PATH, lines: [`match${encodeURIComponent('[]')}=${encodeURIComponent('{machine="m1"}')}`] }]);
  });

  it('drops the waiting lines of a removed machine, so they do not bring its history back', async () => {
    const metrics = writer();
    metrics.record(polled(START, 1200));
    await metrics.removeMachine('m1');

    await metrics.flush();

    expect(fake.importRequests).toEqual([]);
  });

  it('deletes the history after a send that runs now, so that send cannot bring it back', async () => {
    const metrics = writer();
    metrics.record(polled(START, 1200));

    const sending = metrics.flush();
    await metrics.removeMachine('m1');
    await sending;

    expect(fake.requests.map(request => request.path)).toEqual([IMPORT_PATH, DELETE_SERIES_PATH]);
  });

  it('shows an error when the history of a removed machine cannot be deleted', async () => {
    fake.status = 503;

    await expect(writer().removeMachine('m1')).resolves.toBeUndefined();

    expect(log.text('error')).toContain('Could not delete the history of a machine machine=m1');
  });

  it('forgets the last time of a removed machine', async () => {
    const metrics = writer();
    metrics.record(polled(START, 1200));
    await metrics.removeMachine('m1');
    metrics.record(polled(START, 1200));

    await metrics.flush();

    expect(fake.sentLines).toEqual([connectedLine(START, 1), speedLine(START, 1200)]);
  });

  it('does not wait long for the last send when VictoriaMetrics does not answer', async () => {
    const hanging = createServer(() => { /* never answers */ });
    const metrics = writer({ url: await listen(hanging), stopWaitMs: 50 });
    metrics.record(polled(START, 1200));

    const started = Date.now();
    await metrics.stop();

    expect(Date.now() - started).toBeLessThan(1000);
    hanging.closeAllConnections();
    await new Promise(resolve => hanging.close(resolve));
  });

  it('never stops the polling when a snapshot cannot be read', () => {
    const broken = { connected: true, getDataSnapshot: () => { throw new Error('no data'); } } as unknown as BaseMachineConnector;

    expect(() => writer().record(broken)).not.toThrow();
  });
});
