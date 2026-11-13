import { createServer, type IncomingMessage } from 'node:http';
import { parseArgs } from 'node:util';
import { answer } from './fakeNotify';

// npm run fake-notify -- [--port 4010] [--webhook-status 500]
const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '4010' },
    'webhook-status': { type: 'string', default: '200' },
  },
});
const port = numberOption('port', values.port, 1, 65535);
const webhookStatus = numberOption('webhook-status', values['webhook-status'], 200, 599);

/** A whole number from min to max. Another value stops the fake with a message, before it opens the port. */
function numberOption(name: string, text: string, min: number, max: number): number {
  const value = Number(text);
  if (Number.isInteger(value) && value >= min && value <= max) return value;
  console.error(`--${name} must be a whole number from ${min} to ${max}, not "${text}"`);
  process.exit(1);
}

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

const server = createServer(async (request, response) => {
  const reply = answer({
    method: request.method ?? 'GET',
    path: new URL(request.url ?? '/', 'http://localhost').pathname,
    headers: { authorization: request.headers.authorization },
    body: await bodyOf(request),
  }, { webhookStatus });
  console.log(`${new Date().toLocaleTimeString()}  ${reply.status}  ${reply.printed}`);
  response.writeHead(reply.status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(reply.body));
});

// Only this computer can reach the fake
server.listen(port, '127.0.0.1', () => {
  console.log(`Fake notifications at http://127.0.0.1:${port}`);
  console.log(`  Twilio:   start the Chatter server with TWILIO_API_URL=http://127.0.0.1:${port}`);
  console.log(`  Webhook:  use http://127.0.0.1:${port}/any-path as the web address of a webhook channel`);
  console.log(`  Webhooks answer ${webhookStatus}. Press Ctrl+C to stop.`);
});
