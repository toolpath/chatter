import net from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { startRequestReplyServer, type SlowStart } from './tcp.js';

/** Each message ends with a new line, and the reply is the message in capitals */
const LINE_PATTERN = /([^\n]*)\n/g;

let server: net.Server | null = null;

afterEach(() => new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve())));

async function startServer(slowStart: SlowStart): Promise<number> {
  server = startRequestReplyServer('127.0.0.1', 0, LINE_PATTERN, message => `${message.toUpperCase()}\n`, slowStart);
  await new Promise(resolve => server!.once('listening', resolve));
  return (server!.address() as net.AddressInfo).port;
}

/** Connect, send each message after the time given, and give each reply with the time it came */
function talk(port: number, messages: { text: string; afterMs: number }[]): Promise<{ text: string; atMs: number }[]> {
  return new Promise((resolve, reject) => {
    const replies: { text: string; atMs: number }[] = [];
    const start = Date.now();
    const socket = net.connect(port, '127.0.0.1', () => {
      for (const { text, afterMs } of messages) setTimeout(() => socket.write(`${text}\n`), afterMs);
    });
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString('ascii');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) replies.push({ text: line, atMs: Date.now() - start });
      if (replies.length === messages.length) {
        socket.destroy();
        resolve(replies);
      }
    });
    socket.on('error', reject);
  });
}

describe('startRequestReplyServer with a slow start', () => {
  it('answers each message slowly, one after the other, just after a client connects', async () => {
    const port = await startServer({ forMs: 1000, replyDelayMs: 100 });

    const replies = await talk(port, [{ text: 'mem', afterMs: 0 }, { text: 'panel', afterMs: 0 }]);

    expect(replies.map(reply => reply.text)).toEqual(['MEM', 'PANEL']);
    expect(replies[0].atMs).toBeGreaterThanOrEqual(90);
    expect(replies[1].atMs).toBeGreaterThanOrEqual(190);
  });

  it('answers at once when the slow time is over', async () => {
    const port = await startServer({ forMs: 50, replyDelayMs: 1000 });

    const [reply] = await talk(port, [{ text: 'mem', afterMs: 200 }]);

    expect(reply.atMs).toBeLessThan(800);
  });

  it('answers at once with no slow start', async () => {
    const port = await startServer({ forMs: 0, replyDelayMs: 1000 });

    const [reply] = await talk(port, [{ text: 'mem', afterMs: 0 }]);

    expect(reply.atMs).toBeLessThan(600);
  });
});
