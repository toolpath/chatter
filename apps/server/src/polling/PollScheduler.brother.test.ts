import { afterEach, describe, expect, it } from 'vitest';
import { BrotherConnector } from '../machines/brother/BrotherConnector.js';
import { closeFakeBrothers, startFakeBrother, type FakeBrother } from '../machines/brother/testSupport.js';
import type { BaseMachineConnector } from '../machines/BaseMachineConnector.js';
import { PollScheduler } from './PollScheduler.js';

/**
 * A real Brother connector, a real scheduler and a fake Brother on a TCP port, with short time limits.
 * On a Pi, a poll that ran out of time left the machine offline, with no reason, until Chatter restarted.
 */

/** Short limits, so the test takes about one second. The poll limit is shorter than one slow poll. */
const LIMITS = { pollTimeoutMs: 300, stuckPollMs: 3000, intervalMs: 50 };
const COMMAND_TIMEOUT_MS = 250;
/** Each reply of a slow connection takes this long. A poll sends about 8 commands, so it takes longer than the poll limit. */
const SLOW_REPLY_MS = 100;

/** The tool table and the tool data */
const TOOL_COMMANDS = ['ATCTL', 'TOLNI1'];

/**
 * A fake Brother. Each reply of the first connection takes `firstDelayMs`, and each reply of a later one `laterDelayMs`.
 * A reply to a tool command takes `toolDelayMs` when it is given.
 */
function startSlowBrother(firstDelayMs = SLOW_REPLY_MS, laterDelayMs = 0, toolDelayMs?: number): Promise<FakeBrother> {
  return startFakeBrother({
    hold: (command, connection) => {
      const connectionDelayMs = connection === 1 ? firstDelayMs : laterDelayMs;
      const delayMs = toolDelayMs !== undefined && TOOL_COMMANDS.includes(command) ? toolDelayMs : connectionDelayMs;
      return new Promise(resolve => setTimeout(resolve, delayMs));
    },
  });
}

describe('a Brother poll that runs out of time in the scheduler', () => {
  let scheduler: PollScheduler | null = null;
  let fake: FakeBrother | null = null;
  let connector: BrotherConnector | null = null;

  afterEach(async () => {
    scheduler?.stopAll();
    connector?.disconnect();
    await closeFakeBrothers();
    scheduler = null;
    fake = null;
    connector = null;
  });

  it('gives a reason, ends the poll, and connects again, so the machine comes back', async () => {
    fake = await startSlowBrother();
    const { port } = fake;
    connector = new BrotherConnector({ id: 'speedio', name: 'Speedio', host: '127.0.0.1', dataPort: port, timeout: COMMAND_TIMEOUT_MS });
    const results: { connected: boolean; errors: string[]; partCount: unknown }[] = [];
    scheduler = new PollScheduler({
      afterPoll: (machine: BaseMachineConnector) => {
        const { connected, errors } = machine.getStatus();
        results.push({ connected, errors: [...errors], partCount: machine.getDataSnapshot().partCount });
      },
      connectingEnded: () => {},
    }, LIMITS);
    scheduler.setInterval(LIMITS.intervalMs);

    scheduler.start(connector);

    await expect.poll(() => results.some(result => result.connected), { timeout: 2500, interval: 20 }).toBe(true);
    expect(results[0].connected).toBe(false);
    expect(results[0].errors.join('; ')).toContain('did not answer all requests');
    expect(results.at(-1)?.errors).toEqual([]);
    expect(results.at(-1)?.partCount).toBe(78);
  });
});

describe('a slow Brother tool read in the scheduler', () => {
  /** The limits of a real Chatter, 10 times shorter: a 1 s poll limit */
  const SCALED = { pollTimeoutMs: 1000, stuckPollMs: 6000, intervalMs: 20 };
  let scheduler: PollScheduler | null = null;
  let fake: FakeBrother | null = null;
  let connector: BrotherConnector | null = null;

  afterEach(async () => {
    scheduler?.stopAll();
    connector?.disconnect();
    await closeFakeBrothers();
    scheduler = null;
    fake = null;
    connector = null;
  });

  /**
   * Poll the fake Brother with a real scheduler until `count` polls ended, and give the result of each poll.
   * After the first poll, a user presses Sync, so the tool read runs between the polls of the scheduler.
   */
  async function pollSlowBrother(replyDelayMs: number, count: number, toolDelayMs?: number) {
    fake = await startSlowBrother(replyDelayMs, replyDelayMs, toolDelayMs);
    const { port } = fake;
    connector = new BrotherConnector({ id: 'speedio', name: 'Speedio', host: '127.0.0.1', dataPort: port, timeout: 900 });
    const results: { connected: boolean; errors: string[] }[] = [];
    scheduler = new PollScheduler({
      afterPoll: (machine: BaseMachineConnector) => {
        const { connected, errors } = machine.getStatus();
        results.push({ connected, errors: [...errors] });
        if (results.length === 1) void connector!.requestToolSync();
      },
      connectingEnded: () => {},
    }, SCALED);
    scheduler.setInterval(SCALED.intervalMs);

    scheduler.start(connector);
    await expect.poll(() => results.length, { timeout: count * 1500, interval: 20 }).toBeGreaterThanOrEqual(count);
    scheduler.stopAll();
    return results.slice(0, count);
  }

  it('stays online while a tool read takes longer than the poll limit, and then shows the tool table', async () => {
    // The two tool replies take 1.4 s together, more than the 1 s poll limit
    const results = await pollSlowBrother(5, 60, 700);
    await connector!.toolSyncEnded();

    expect(results.every(result => result.connected && result.errors.length === 0)).toBe(true);
    expect(fake!.commands).toEqual(expect.arrayContaining(TOOL_COMMANDS));
    expect(connector!.getStatus().data.toolTable?.[1]).toMatchObject({ toolNum: 1, length: 1.5 });
  }, 10_000);
});
