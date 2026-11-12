import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MetricsReader } from './MetricsReader.js';

const FROM = Date.UTC(2026, 10, 9, 9, 0);
const WINDOW_MS = 10_000;

/** A fake VictoriaMetrics that keeps the asked query and gives a fixed answer */
class FakeVictoriaMetrics {
  lastQuery?: URLSearchParams;
  lastPath?: string;
  /** Every query, for the methods that send more than one */
  queries: string[] = [];
  /** For an instant query: the one value to answer for each query */
  answerFor?: (query: string) => string;
  status = 200;
  answer: unknown = { status: 'success', data: { resultType: 'matrix', result: [] } };
  private server?: Server;

  async start(): Promise<string> {
    this.server = createServer((request, response) => {
      const address = new URL(request.url ?? '', 'http://fake');
      this.lastPath = address.pathname;
      this.lastQuery = address.searchParams;
      const query = address.searchParams.get('query') ?? '';
      this.queries.push(query);
      response.statusCode = this.status;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(this.answerFor ? instantAnswer(this.answerFor(query)) : this.answer));
    });
    await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise(resolve => this.server?.close(resolve));
  }

  answerWith(values: [number, string][]): void {
    this.answer = { status: 'success', data: { resultType: 'matrix', result: [{ metric: {}, values }] } };
  }
}

/** The answer to an instant query that has one value */
function instantAnswer(value: string) {
  return { status: 'success', data: { resultType: 'vector', result: [{ metric: {}, value: [FROM / 1000, value] }] } };
}

describe('MetricsReader', () => {
  let fake: FakeVictoriaMetrics;
  let reader: MetricsReader;

  const query = (to = FROM + 30_000) => ({ metric: 'chatter_spindle_speed', machineId: 'm1', from: FROM, to, windowMs: WINDOW_MS });

  beforeEach(async () => {
    fake = new FakeVictoriaMetrics();
    reader = new MetricsReader({ url: await fake.start() });
  });

  afterEach(async () => {
    await fake.stop();
  });

  it('asks for the average of each window of one machine', async () => {
    await reader.windowAverages(query());

    expect(fake.lastPath).toBe('/api/v1/query_range');
    expect(fake.lastQuery?.get('query')).toBe('avg(avg_over_time(chatter_spindle_speed{machine="m1"}[10000ms]))');
    expect(fake.lastQuery?.get('step')).toBe('10');
  });

  it('reads the minute averages for a window of 1 minute or more', async () => {
    await reader.windowAverages({ ...query(FROM + 600_000), windowMs: 60_000 });

    expect(fake.lastQuery?.get('query')).toBe('avg(avg_over_time(chatter_spindle_speed:avg1m{machine="m1"}[60000ms]))');
  });

  it('reads the points for a window that is not a whole number of minutes', async () => {
    await reader.windowAverages({ ...query(FROM + 600_000), windowMs: 90_000 });

    expect(fake.lastQuery?.get('query')).toContain('chatter_spindle_speed{machine="m1"}[90000ms]');
  });

  it('asks for the times at the end of each window, because a VictoriaMetrics point covers the time before it', async () => {
    await reader.windowAverages(query(FROM + 25_000));

    expect(fake.lastQuery?.get('start')).toBe(String((FROM + WINDOW_MS) / 1000));
    expect(fake.lastQuery?.get('end')).toBe(String((FROM + 3 * WINDOW_MS) / 1000));
  });

  it('gives each average at the start of its window', async () => {
    fake.answerWith([[(FROM + 10_000) / 1000, '1200'], [(FROM + 30_000) / 1000, '1250.5']]);

    const points = await reader.windowAverages(query());

    expect(points).toEqual([{ time: FROM, value: 1200 }, { time: FROM + 20_000, value: 1250.5 }]);
  });

  it('gives no points when the machine has no history', async () => {
    expect(await reader.windowAverages(query())).toEqual([]);
  });

  it('leaves out a value that is not a number', async () => {
    fake.answerWith([[(FROM + 10_000) / 1000, 'NaN'], [(FROM + 20_000) / 1000, '+Inf']]);

    expect(await reader.windowAverages(query())).toEqual([]);
  });

  it('escapes a quote and a backslash in the machine id', async () => {
    await reader.windowAverages({ ...query(), machineId: 'a"b\\c' });

    expect(fake.lastQuery?.get('query')).toContain('{machine="a\\"b\\\\c"}');
  });

  it('throws when VictoriaMetrics refuses the query', async () => {
    fake.status = 422;
    fake.answer = { status: 'error', errorType: 'bad_data', error: 'cannot parse the query' };

    await expect(reader.windowAverages(query())).rejects.toThrow('cannot parse the query');
  });

  it('throws when VictoriaMetrics does not answer', async () => {
    await fake.stop();

    await expect(reader.windowAverages(query())).rejects.toThrow();
  });

  describe('one value for the whole range', () => {
    const DAY_MS = 86_400_000;
    const range = { metric: 'chatter_running', machineId: 'm1', from: FROM - DAY_MS, to: FROM };

    it('adds the minute averages of a state, at the end of the range, to get the minutes that it was on', async () => {
      await reader.stateTime(range);

      expect(fake.lastPath).toBe('/api/v1/query');
      expect(fake.queries).toContain(`sum(sum_over_time(chatter_running:avg1m{machine="m1"}[${DAY_MS}ms]))`);
      expect(fake.queries).toContain(`sum(count_over_time(chatter_running:avg1m{machine="m1"}[${DAY_MS}ms]))`);
      expect(fake.lastQuery?.get('time')).toBe(String(FROM / 1000));
    });

    it('gives the time that a state was on, and the time that it was known, in milliseconds', async () => {
      fake.answerFor = query => (query.includes('sum_over_time') ? '90.5' : '120');

      expect(await reader.stateTime(range)).toEqual({ onMs: 90.5 * 60_000, knownMs: 120 * 60_000 });
    });

    it('refuses a range that is not a whole number of minutes, because it reads the minute averages', async () => {
      await expect(reader.stateTime({ ...range, from: range.from + 1000 })).rejects.toThrow('whole number of minutes');
    });

    it('asks for the increase from the first saved value, because increase() guesses differently for a long range', async () => {
      await reader.rangeIncrease({ ...range, metric: 'chatter_part_count' });

      expect(fake.lastQuery?.get('query')).toBe(`sum(increase_prometheus(chatter_part_count{machine="m1"}[${DAY_MS}ms]))`);
    });

    it('gives the increase as a number', async () => {
      fake.answerFor = () => '37';

      expect(await reader.rangeIncrease(range)).toBe(37);
    });

    it('gives null when the machine has no data in the range', async () => {
      expect(await reader.stateTime(range)).toBeNull();
      expect(await reader.rangeIncrease(range)).toBeNull();
    });

    it('throws when VictoriaMetrics refuses the query', async () => {
      fake.status = 422;
      fake.answer = { status: 'error', error: 'cannot parse the query' };

      await expect(reader.rangeIncrease(range)).rejects.toThrow('cannot parse the query');
    });
  });
});
