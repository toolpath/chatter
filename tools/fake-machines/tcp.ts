import net from 'net';

/**
 * Small helpers for fake controls that talk over plain TCP.
 * Bytes can arrive in pieces, so we keep a buffer and answer only whole messages.
 */

/**
 * Take every whole message out of the buffer.
 * The pattern must be global and put the message in its first capture group.
 */
export function takeWholeMessages(buffer: string, pattern: RegExp): { messages: string[]; rest: string } {
  const messages: string[] = [];
  let end = 0;
  for (const match of buffer.matchAll(pattern)) {
    messages.push(match[1]);
    end = (match.index ?? 0) + match[0].length;
  }
  return { messages, rest: buffer.slice(end) };
}

/** A control that is slow just after a client connects, like a real one, so Chatter shows "Connecting" for a while */
export interface SlowStart {
  /** How long after a client connects the control is slow. 0 means never slow. */
  forMs: number;
  /** How long each answer takes while it is slow */
  replyDelayMs: number;
}

/** About 8 answers in the first poll of a Brother, so its first poll takes about 6 seconds */
const SLOW_REPLY_MS = 700;

export function slowStartOf(seconds: number): SlowStart {
  return { forMs: seconds * 1000, replyDelayMs: SLOW_REPLY_MS };
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Start a TCP server that sends one reply for each whole message it receives.
 * During the slow start, it answers one message at a time, each after `replyDelayMs`.
 */
export function startRequestReplyServer(
  host: string,
  port: number,
  messagePattern: RegExp,
  reply: (message: string) => string,
  slowStart: SlowStart,
): net.Server {
  const server = net.createServer(socket => {
    const slowUntil = Date.now() + slowStart.forMs;
    // Each reply waits for the one before it, so the replies keep their order
    let replyQueue = Promise.resolve();
    const answer = (message: string) => {
      const delayMs = Date.now() < slowUntil ? slowStart.replyDelayMs : 0;
      replyQueue = replyQueue
        .then(() => wait(delayMs))
        // The reply is made at the time it is sent, so it has the newest machine state
        .then(() => { if (!socket.destroyed) socket.write(reply(message), 'ascii'); });
    };
    let buffer = '';
    socket.on('data', chunk => {
      const { messages, rest } = takeWholeMessages(buffer + chunk.toString('ascii'), messagePattern);
      buffer = rest;
      messages.forEach(answer);
    });
    socket.on('error', () => socket.destroy());
  });
  server.listen(port, host);
  return server;
}
