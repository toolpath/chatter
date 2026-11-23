import { once } from 'node:events';
import type { Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { LoggedInEnv } from '../auth/authRoutes.js';
import { FTPClient } from '../ftp/FTPClient.js';
import { MachineBusyError } from '../ftp/sessionQueue.js';
import { HOST, startEndlessMachine, waitFor, type EndlessMachine } from '../ftp/testSupport.js';
import type { BaseMachineConnector } from '../machines/BaseMachineConnector.js';
import type { HardwarePoller } from '../polling/poller.js';
import { captureLog, type CapturedLog } from '../logging/testSupport.js';
import { startWebServer } from '../webServerOptions.js';
import { ProxySettings } from '../auth/proxySettings.js';
import { machineFileRoutes } from './machineFiles.js';

// The whole path of a cancel: the browser closes the connection, @hono/node-server cancels the reply,
// streamWithoutErrorText cancels the download stream, and the FTP client stops the transfer on the machine.

/** The uploads that the routes started, as the outcome of each: 'sent' or the error */
let uploadOutcomes: Array<Promise<unknown>> = [];

/**
 * The program routes, with one machine that downloads and uploads over a real FTP client, and a user that can read and
 * send files
 */
function appFor(machine: EndlessMachine) {
  const ftp = new FTPClient({ host: HOST, port: machine.port });
  const connector = {
    downloadFile: (path: string, output, signal) => ftp.downloadFile(path, output, signal),
    uploadFile: (path: string, source, allowOverwrite, signal) => {
      const upload = ftp.uploadFile(path, source, allowOverwrite, signal);
      uploadOutcomes.push(upload.then(() => 'sent', (err: unknown) => err));
      return upload;
    },
  } as Pick<BaseMachineConnector, 'downloadFile' | 'uploadFile'> as BaseMachineConnector;
  const poller = { getConnector: () => connector } as unknown as HardwarePoller;
  return new Hono<LoggedInEnv>()
    .use(async (c, next) => {
      c.set('user', { id: 1, username: 'operator', role: 'operator' });
      await next();
    })
    .route('/', machineFileRoutes(poller, ProxySettings.inMemory()));
}

describe('a program download that the browser cancels', () => {
  let machine: EndlessMachine | undefined;
  let server: Server | undefined;
  let browser: Socket | undefined;
  let log: CapturedLog | undefined;

  afterEach(async () => {
    log?.restore();
    browser?.destroy();
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve, reject) => server!.close(err => (err ? reject(err) : resolve())));
    await machine?.close();
    log = undefined;
    uploadOutcomes = [];
    browser = undefined;
    server = undefined;
    machine = undefined;
  });

  it('closes the data and control connections to the machine, and logs no error', async () => {
    log = captureLog();
    machine = await startEndlessMachine();
    server = startWebServer(appFor(machine), 0, { hostname: '127.0.0.1' });
    await once(server, 'listening');

    browser = connect((server.address() as AddressInfo).port, '127.0.0.1');
    browser.on('error', () => {});
    await once(browser, 'connect');
    browser.write('GET /machine/1/files/download?path=O1000 HTTP/1.1\r\nHost: localhost\r\n\r\n');
    let reply = '';
    await new Promise<void>(resolve => browser!.on('data', chunk => {
      reply += chunk.toString();
      if (reply.includes('G01 X1 Y1')) resolve();
    }));
    expect(machine.openDataConnections()).toBe(1);

    // The browser cancels the download
    browser.destroy();
    await waitFor(() => machine!.openDataConnections() === 0 && machine!.openControlConnections() === 0);

    expect(machine.openDataConnections()).toBe(0);
    expect(machine.openControlConnections()).toBe(0);
    expect(machine.commands.filter(command => command === 'RETR')).toHaveLength(1);
    expect(log.lines.filter(line => line.level === 'error')).toEqual([]);
  });

  // The machine has one FTP session at a time, so the second download waits. The cancel of the first must free the turn.
  it('starts a waiting download of a second browser when the first browser cancels its download', async () => {
    machine = await startEndlessMachine();
    server = startWebServer(appFor(machine), 0, { hostname: '127.0.0.1' });
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    let requestCount = 0;
    server.on('request', () => { requestCount += 1; });
    const first = startBrowserDownload(port);
    browser = first.socket;
    await first.gotData;
    const second = startBrowserDownload(port);

    try {
      await waitFor(() => requestCount === 2);
      expect(requestCount).toBe(2);
      first.socket.destroy();
      await second.gotData;

      expect(machine.commands.filter(command => command === 'USER')).toHaveLength(2);
      expect(machine.openControlConnections()).toBe(1);
    } finally {
      second.socket.destroy();
    }
  });

  // The upload waits for the download. A browser that leaves must not get its file on the machine minutes later.
  it('does not send a waiting upload to the machine when its browser leaves', async () => {
    log = captureLog();
    machine = await startEndlessMachine();
    server = startWebServer(appFor(machine), 0, { hostname: '127.0.0.1' });
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    const download = startBrowserDownload(port);
    browser = download.socket;
    await download.gotData;

    const upload = startBrowserUpload(port);
    await waitFor(() => uploadOutcomes.length === 1);
    upload.destroy();

    // The upload stopped because the browser left, not because the machine was busy
    const outcome = await uploadOutcomes[0];
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome).not.toBeInstanceOf(MachineBusyError);
    expect((outcome as Error).message).toBe('FTP upload error: Client connection prematurely closed.');
    download.socket.destroy();
    await waitFor(() => machine!.openControlConnections() === 0);
    expect(machine.commands).not.toContain('STOR');
    expect(machine.commands.filter(command => command === 'USER')).toHaveLength(1);
    expect(log.lines.filter(line => line.level === 'error')).toEqual([]);
  });
});

/** A browser that sends one program file. The route reads the whole body, then waits for the turn of the machine. */
function startBrowserUpload(port: number): Socket {
  const boundary = 'chatter-test';
  const part = (name: string, value: string, fileName?: string) => [
    `--${boundary}`,
    `Content-Disposition: form-data; name="${name}"${fileName ? `; filename="${fileName}"` : ''}`,
    ...(fileName ? ['Content-Type: application/octet-stream'] : []),
    '',
    value,
  ].join('\r\n');
  const body = [part('path', '/O9100'), part('overwrite', 'true'), part('file', 'O9100\nM30\n', 'O9100'), `--${boundary}--`, ''].join('\r\n');
  const socket = connect(port, '127.0.0.1');
  socket.on('error', () => {});
  socket.on('connect', () => socket.write([
    'POST /machine/1/files/upload HTTP/1.1',
    'Host: localhost',
    `Content-Type: multipart/form-data; boundary=${boundary}`,
    `Content-Length: ${Buffer.byteLength(body)}`,
    '',
    body,
  ].join('\r\n')));
  return socket;
}

/** A browser that asks for a program download. `gotData` resolves at the first line of the program. */
function startBrowserDownload(port: number): { socket: Socket; gotData: Promise<void> } {
  const socket = connect(port, '127.0.0.1');
  socket.on('error', () => {});
  socket.on('connect', () => socket.write('GET /machine/1/files/download?path=O1000 HTTP/1.1\r\nHost: localhost\r\n\r\n'));
  let reply = '';
  const gotData = new Promise<void>(resolve => socket.on('data', chunk => {
    reply += chunk.toString();
    if (reply.includes('G01 X1 Y1')) resolve();
  }));
  return { socket, gotData };
}
