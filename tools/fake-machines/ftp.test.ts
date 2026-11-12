import * as net from 'net';
import { once } from 'events';
import { afterEach, describe, expect, it } from 'vitest';
import { startFtpServer } from './ftp.js';

let server: net.Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

/** Connects to the FTP server, sends one command, and gives the reply to it */
async function replyTo(command: string, port: number): Promise<string> {
  const socket = net.connect(port, '127.0.0.1');
  let received = '';
  socket.on('data', chunk => { received += chunk.toString(); });
  await once(socket, 'connect');
  await waitFor(() => received.includes('220 '));
  received = '';
  socket.write(`${command}\r\n`);
  await waitFor(() => received.includes('\r\n'));
  socket.destroy();
  return received.trim();
}

async function waitFor(isDone: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100 && !isDone(); tries++) await new Promise(resolve => setTimeout(resolve, 10));
}

async function startOn(listenHost: string): Promise<number> {
  server = startFtpServer('/nonexistent-ftp-root', listenHost, 0);
  await once(server, 'listening');
  return (server.address() as net.AddressInfo).port;
}

describe('FTP passive mode', () => {
  it('gives the address that the client connected to', async () => {
    const port = await startOn('127.0.0.1');
    expect(await replyTo('PASV', port)).toMatch(/^227 Entering Passive Mode \(127,0,0,1,\d+,\d+\)$/);
  });

  it('gives the address that the client connected to when the server listens on all addresses', async () => {
    const port = await startOn('0.0.0.0');
    expect(await replyTo('PASV', port)).toMatch(/^227 Entering Passive Mode \(127,0,0,1,\d+,\d+\)$/);
  });
});
