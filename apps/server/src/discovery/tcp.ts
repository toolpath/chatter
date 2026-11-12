import net from 'node:net';

/** True when something at `host` accepts a connection on `port` before the time runs out */
export function isPortOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const finish = (isOpen: boolean) => {
      socket.destroy();
      resolve(isOpen);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/** A machine answer is short. A longer reply is not one of the machines Chatter knows. */
const MAX_REPLY_LENGTH = 4096;

export interface TcpQuestion {
  host: string;
  port: number;
  request: string;
  /** True when the reply so far is the full answer */
  isComplete: (reply: string) => boolean;
  /** The time limit for the whole answer */
  timeoutMs: number;
}

/**
 * Send `request`, then collect the reply until `isComplete` says it is all there.
 * Null when there is no connection, an error, a reply that is too long, or no full reply in time.
 * The time limit is for the whole answer, so a device that sends a little at a time cannot hold the scan.
 */
export function askOverTcp({ host, port, request, isComplete, timeoutMs }: TcpQuestion): Promise<string | null> {
  return new Promise(resolve => {
    let reply = '';
    const socket = net.connect({ host, port }, () => socket.write(request, 'ascii'));
    // finish() runs only on a socket event or the timer, so `deadline` is always set by then
    const finish = (answer: string | null) => {
      clearTimeout(deadline);
      socket.destroy();
      resolve(answer);
    };
    const deadline = setTimeout(() => finish(null), timeoutMs);
    socket.on('data', data => {
      reply += data.toString('ascii');
      if (reply.length > MAX_REPLY_LENGTH) finish(null);
      else if (isComplete(reply)) finish(reply);
    });
    socket.once('error', () => finish(null));
    socket.once('close', () => finish(null));
  });
}

/** Run `work` on each item, with at most `limit` at the same time. The results keep the order of the items. */
export async function mapWithLimit<Item, Result>(
  items: Item[],
  limit: number,
  work: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await work(items[index]);
    }
  };
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
