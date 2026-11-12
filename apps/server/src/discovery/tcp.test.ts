import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { askOverTcp, isPortOpen, mapWithLimit } from './tcp.js';

const LOCALHOST = '127.0.0.1';
const hasNewline = (text: string) => text.includes('\n');

/** Start `server` on a free port, and give that port */
async function listenOnFreePort(server: net.Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, LOCALHOST, resolve));
  return (server.address() as net.AddressInfo).port;
}

const closeServer = (server: net.Server) => new Promise<void>(resolve => server.close(() => resolve()));

describe('mapWithLimit', () => {
  it('keeps the order, and never runs more than the limit at once', async () => {
    let running = 0;
    let mostAtOnce = 0;
    const results = await mapWithLimit([5, 1, 3, 2], 2, async value => {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      await new Promise(resolve => setTimeout(resolve, value));
      running -= 1;
      return value * 10;
    });
    expect(results).toEqual([50, 10, 30, 20]);
    expect(mostAtOnce).toBe(2);
  });
});

describe('isPortOpen and askOverTcp', () => {
  let server: net.Server;
  let port: number;

  beforeAll(async () => {
    server = net.createServer(socket => socket.on('data', data => socket.write(`>${data.toString().trim()} OK\n`)));
    port = await listenOnFreePort(server);
  });

  afterAll(() => closeServer(server));

  it('sees an open port and a closed port', async () => {
    expect(await isPortOpen(LOCALHOST, port, 500)).toBe(true);
    const closedPortServer = net.createServer();
    const closedPort = await listenOnFreePort(closedPortServer);
    await closeServer(closedPortServer);
    expect(await isPortOpen(LOCALHOST, closedPort, 500)).toBe(false);
  });

  it('stops at the time limit, even when the device keeps sending a little', async () => {
    const dripServer = net.createServer(socket => {
      const drip = setInterval(() => socket.write('x'), 20);
      socket.on('close', () => clearInterval(drip));
      // The client hangs up at the time limit. A write after that gives EPIPE, and the test expects it.
      socket.on('error', () => socket.destroy());
    });
    const dripPort = await listenOnFreePort(dripServer);
    const started = Date.now();
    const question = { host: LOCALHOST, port: dripPort, request: 'Q100\n', isComplete: hasNewline, timeoutMs: 200 };
    expect(await askOverTcp(question)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    await closeServer(dripServer);
  });

  it('gives the full reply, or null when the reply never completes', async () => {
    const question = { host: LOCALHOST, port, request: 'Q100\n' };
    expect(await askOverTcp({ ...question, isComplete: hasNewline, timeoutMs: 500 })).toBe('>Q100 OK\n');
    expect(await askOverTcp({ ...question, isComplete: text => text.includes('%'), timeoutMs: 200 })).toBeNull();
  });
});
