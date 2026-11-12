import type { BaseMachineConnector } from '../machines/BaseMachineConnector.js';
import { machineSelector, metricLines } from './metricLines.js';
import { pollTimeOf } from './pollTime.js';
import { createLogger } from '../logging/logger.js';

const log = createLogger('history');

const IMPORT_PATH = '/api/v1/import/prometheus';
const DELETE_SERIES_PATH = '/api/v1/admin/tsdb/delete_series';
const DEFAULT_FLUSH_EVERY_MS = 5000;
/** About 15 minutes of 10 busy machines. Each line is about 80 bytes, so this is about 8 MB. */
const DEFAULT_MAX_BUFFERED_LINES = 100_000;
const DEFAULT_MAX_LINES_PER_REQUEST = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** "docker stop" kills the program after 10 seconds, and the database must close before that */
const DEFAULT_STOP_WAIT_MS = 3000;
/** Answers that mean "try again later". Other 4xx answers mean that the lines are wrong. */
const TRY_AGAIN_STATUSES = new Set([408, 429]);

export interface MetricsWriterOptions {
  /** The VictoriaMetrics address, for example http://victoriametrics:8428 */
  url: string;
  flushEveryMs?: number;
  /** When more lines wait than this, the oldest are dropped */
  maxBufferedLines?: number;
  maxLinesPerRequest?: number;
  /** stop() waits at most this long for the last send */
  stopWaitMs?: number;
  now?: () => number;
}

interface BufferedLine {
  machineId: string;
  line: string;
}

/** VictoriaMetrics refused the lines. Sending them again cannot work. */
class RefusedError extends Error {}

/**
 * Sends the machine values of each poll to VictoriaMetrics.
 * record() only adds lines to a list in memory, so it never slows or stops the polling.
 * A timer sends the list. When VictoriaMetrics is down, the lines wait for the next try.
 */
export class MetricsWriter {
  private readonly importUrl: string;
  private readonly deleteSeriesUrl: string;
  private readonly flushEveryMs: number;
  private readonly maxBufferedLines: number;
  private readonly maxLinesPerRequest: number;
  private readonly stopWaitMs: number;
  private readonly now: () => number;

  private buffer: BufferedLine[] = [];
  /** The snapshot time of the last poll written for each machine */
  private readonly lastWrittenTimes = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private sending?: Promise<void>;
  private lastErrorMessage = '';
  private lostLineCount = 0;

  constructor({ url, flushEveryMs, maxBufferedLines, maxLinesPerRequest, stopWaitMs, now }: MetricsWriterOptions) {
    this.importUrl = new URL(IMPORT_PATH, url).href;
    this.deleteSeriesUrl = new URL(DELETE_SERIES_PATH, url).href;
    this.flushEveryMs = flushEveryMs ?? DEFAULT_FLUSH_EVERY_MS;
    this.maxBufferedLines = maxBufferedLines ?? DEFAULT_MAX_BUFFERED_LINES;
    this.maxLinesPerRequest = maxLinesPerRequest ?? DEFAULT_MAX_LINES_PER_REQUEST;
    this.stopWaitMs = stopWaitMs ?? DEFAULT_STOP_WAIT_MS;
    this.now = now ?? Date.now;
  }

  get bufferedLineCount(): number {
    return this.buffer.length;
  }

  /** Add the values of a machine that was just polled. An error never stops the polling. */
  record(connector: BaseMachineConnector): void {
    try {
      const snapshot = connector.getDataSnapshot();
      const time = pollTimeOf(snapshot, this.now);
      if (snapshot.connected && this.isAlreadyWritten(snapshot.machineId, time)) return;
      this.lastWrittenTimes.set(snapshot.machineId, time);
      this.addToBuffer(metricLines(snapshot, time).map(line => ({ machineId: snapshot.machineId, line })));
    } catch (error) {
      this.reportError(error);
    }
  }

  /**
   * Forget a removed machine and delete its history. It never throws.
   * The delete waits for a send that runs now, because that send could bring the history back.
   */
  async removeMachine(machineId: string): Promise<void> {
    this.lastWrittenTimes.delete(machineId);
    this.buffer = this.buffer.filter(buffered => buffered.machineId !== machineId);
    await this.sending;
    try {
      await this.deleteSeries(machineId);
    } catch (error) {
      log.error('Could not delete the history of a machine', { machine: machineId, reason: describeError(error) });
    }
  }

  start(): void {
    this.timer ??= setInterval(() => void this.flush(), this.flushEveryMs);
    // The timer must not keep the program running
    this.timer.unref();
  }

  /** Stop the timer and send the lines that still wait. It waits at most stopWaitMs, so a dead VictoriaMetrics cannot hold up the stop. */
  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    let stopWaitTimer: NodeJS.Timeout | undefined;
    const stopWait = new Promise<void>(resolve => { stopWaitTimer = setTimeout(resolve, this.stopWaitMs); });
    await Promise.race([this.flush(), stopWait]);
    clearTimeout(stopWaitTimer);
  }

  /** Send the waiting lines now. Only one send runs at a time. It never throws. */
  flush(): Promise<void> {
    this.sending ??= this.sendAll().finally(() => { this.sending = undefined; });
    return this.sending;
  }

  /** A machine that stops answering sends its last values again, with the same time */
  private isAlreadyWritten(machineId: string, time: number): boolean {
    return time <= (this.lastWrittenTimes.get(machineId) ?? -Infinity);
  }

  private addToBuffer(lines: BufferedLine[]): void {
    this.buffer.push(...lines);
    const overflow = this.buffer.length - this.maxBufferedLines;
    if (overflow > 0) {
      this.buffer.splice(0, overflow);
      this.lostLineCount += overflow;
    }
  }

  private async sendAll(): Promise<void> {
    while (this.buffer.length > 0) {
      const batch = this.buffer.slice(0, this.maxLinesPerRequest);
      try {
        await this.send(batch);
      } catch (error) {
        if (error instanceof RefusedError) this.removeFromBuffer(batch);
        this.reportError(error);
        return;
      }
      this.removeFromBuffer(batch);
      this.reportWorksAgain();
    }
  }

  private async send(batch: BufferedLine[]): Promise<void> {
    const importBody = batch.map(buffered => buffered.line).join('\n') + '\n';
    const response = await post(this.importUrl, importBody);
    if (response.ok) return;
    const message = await describeAnswer(response);
    const tryAgain = response.status >= 500 || TRY_AGAIN_STATUSES.has(response.status);
    throw tryAgain ? new Error(message) : new RefusedError(message);
  }

  private async deleteSeries(machineId: string): Promise<void> {
    const response = await post(this.deleteSeriesUrl, new URLSearchParams({ 'match[]': machineSelector(machineId) }));
    if (!response.ok) throw new Error(await describeAnswer(response));
  }

  /** Remove a batch that was sent. Lines may be dropped from the start of the list during the send. */
  private removeFromBuffer(batch: BufferedLine[]): void {
    const sent = new Set(batch);
    this.buffer = this.buffer.filter(buffered => !sent.has(buffered));
  }

  /** Show each new kind of error once, so a long outage does not fill the log */
  private reportError(error: unknown): void {
    const message = describeError(error);
    if (message !== this.lastErrorMessage) log.error('Could not save the machine history', { reason: message });
    this.lastErrorMessage = message;
  }

  private reportWorksAgain(): void {
    if (!this.lastErrorMessage) return;
    const lost = this.lostLineCount > 0 ? ` ${this.lostLineCount} values were lost.` : '';
    log.info(`Saving the machine history works again.${lost}`);
    this.lastErrorMessage = '';
    this.lostLineCount = 0;
  }
}

function post(url: string, body: string | URLSearchParams): Promise<Response> {
  return fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

/** fetch() says only "fetch failed". The cause tells why, for example "connect ECONNREFUSED 127.0.0.1:8428". */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}

async function describeAnswer(response: Response): Promise<string> {
  return `VictoriaMetrics answered ${response.status}: ${(await response.text()).trim()}`;
}
