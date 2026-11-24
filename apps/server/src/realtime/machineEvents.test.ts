import { describe, expect, it, vi } from 'vitest';
import { setTimeout as wait } from 'node:timers/promises';
import { Hono, type Context } from 'hono';
import { captureLog } from '../logging/testSupport.js';
import type { MachineChangeFeed } from './MachineChangeFeed.js';
import { KEEP_ALIVE_MS, machineEventRoutes } from './machineEvents.js';

describe('machineEventRoutes', () => {
  it('logs an error of the live events, sends no error text, and closes the stream so the browser connects again', async () => {
    const feed = {
      currentMachines: () => { throw new Error('the machine list is broken'); },
      subscribe: () => () => {},
    } as unknown as MachineChangeFeed;
    const app = new Hono().route('/', machineEventRoutes(feed, () => 'admin'));
    const log = captureLog();

    const res = await app.request('/events');
    // text() ends only when the server closes the stream
    const text = await res.text();
    log.restore();

    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(text).not.toContain('event: error');
    expect(text).not.toContain('the machine list is broken');
    expect(log.lines.filter(line => line.level === 'error')).toHaveLength(1);
    expect(log.text('error')).toContain('the machine list is broken');
    expect(log.text('error')).toContain('path=/events');
  });

  describe('at each keep-alive', () => {
    const feed = { currentMachines: () => [], subscribe: () => () => {} } as unknown as MachineChangeFeed;

    /** Read the stream until the server ends it, and give all its text */
    async function restOf(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
      let text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return text;
        text += new TextDecoder().decode(value);
      }
    }

    it('checks the login of the stream, and stops the checks when the browser closes the stream', async () => {
      vi.useFakeTimers();
      try {
        const isLoggedIn = vi.fn(() => true);
        const app = new Hono().route('/', machineEventRoutes(feed, () => 'admin', isLoggedIn));
        const reader = (await app.request('/events')).body!.getReader();
        await reader.read();
        expect(isLoggedIn).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(KEEP_ALIVE_MS);
        expect(isLoggedIn).toHaveBeenCalledTimes(1);
        expect((isLoggedIn.mock.calls[0] as unknown as [Context])[0].req.path).toBe('/events');
        expect(new TextDecoder().decode((await reader.read()).value)).toContain(': keep-alive');

        await reader.cancel();
        await vi.advanceTimersByTimeAsync(2 * KEEP_ALIVE_MS);
        expect(isLoggedIn).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('ends the stream when its login ended, so the browser connects again and gets the login page', async () => {
      vi.useFakeTimers();
      try {
        let loggedIn = true;
        const app = new Hono().route('/', machineEventRoutes(feed, () => 'admin', () => loggedIn));
        const reader = (await app.request('/events')).body!.getReader();
        await reader.read();

        loggedIn = false;
        await vi.advanceTimersByTimeAsync(KEEP_ALIVE_MS);

        expect(await restOf(reader)).not.toContain(': keep-alive');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('when the first send fails', () => {
    /** A feed whose machine list fails while `failing` is true */
    function feedThatFails() {
      const state = { failing: false };
      const subscribe = vi.fn(() => () => {});
      const feed = {
        currentMachines: () => {
          if (state.failing) throw new Error('the machine list is broken');
          return [];
        },
        subscribe,
      } as unknown as MachineChangeFeed;
      return { state, feed, subscribe };
    }

    /** Open the live events and read the first event (the machine list) */
    async function openEvents(app: Hono): Promise<ReadableStreamDefaultReader<Uint8Array>> {
      const reader = (await app.request('/events')).body!.getReader();
      await reader.read();
      return reader;
    }

    /** True when the server ends the stream within a short time */
    async function endsSoon(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<boolean> {
      const ended = (async () => {
        while (!(await reader.read()).done);
        return true;
      })();
      return Promise.race([ended, wait(300).then(() => false)]);
    }

    it('frees the stream slot of the login, so the failed streams do not close the good ones', async () => {
      const { state, feed, subscribe } = feedThatFails();
      const app = new Hono().route('/', machineEventRoutes(feed, () => 'admin'));
      const log = captureLog();
      const readers = [await openEvents(app)];
      state.failing = true;
      for (let i = 0; i < 5; i++) await (await app.request('/events')).text();
      state.failing = false;
      for (let i = 0; i < 4; i++) readers.push(await openEvents(app));
      log.restore();

      expect(await Promise.all(readers.map(endsSoon))).toEqual([false, false, false, false, false]);
      // A failed stream does not subscribe to the changes
      expect(subscribe).toHaveBeenCalledTimes(5);
      await Promise.all(readers.map(reader => reader.cancel()));
    });
  });
});
