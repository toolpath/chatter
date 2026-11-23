import { once } from 'node:events';
import type { Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { LoggedInEnv } from '../auth/authRoutes.js';
import { FTPClient } from '../ftp/FTPClient.js';
import { HOST, startEndlessMachine, waitFor, type EndlessMachine } from '../ftp/testSupport.js';
import type { BaseMachineConnector } from '../machines/BaseMachineConnector.js';
import type { HardwarePoller } from '../polling/poller.js';
import { captureLog, type CapturedLog } from '../logging/testSupport.js';
import { startWebServer } from '../webServerOptions.js';
import { ProxySettings } from '../auth/proxySettings.js';
import { machineFileRoutes } from './machineFiles.js';

// The browser leaves while the route still waits for the first bytes of the machine. Then the reply has no stream
// yet, so no stream cancel can stop the download. The signal of the request must stop it.

/** The program routes, with one machine that downloads over a real FTP client, and a user that can read files.
 * Each reply status goes to `statuses`, because the browser that left cannot read it. */
function appFor(machine: EndlessMachine, statuses: number[]) {
  const ftp = new FTPClient({ host: HOST, port: machine.port });
  const connector = {
    downloadFile: (path: string, output, signal) => ftp.downloadFile(path, output, signal),
  } as Pick<BaseMachineConnector, 'downloadFile'> as BaseMachineConnector;
  const poller = { getConnector: () => connector } as unknown as HardwarePoller;
  return new Hono<LoggedInEnv>()
    .use(async (c, next) => {
      c.set('user', { id: 1, username: 'operator', role: 'operator' });
      await next();
      statuses.push(c.res.status);
    })
    .route('/', machineFileRoutes(poller, ProxySettings.inMemory()));
}

describe('a program download that the browser leaves before the first byte', () => {
  let machine: EndlessMachine;
  let server: Server;
  let browser: Socket | undefined;
  let log: CapturedLog;

  afterEach(async () => {
    log.restore();
    browser?.destroy();
    server.closeAllConnections();
    server.close();
    await machine.close();
  });

  it('closes the data and control connections to the machine, replies 499, and logs the stop with its error at debug level', async () => {
    log = captureLog();
    // The machine opens the data connection for RETR, and then sends nothing
    machine = await startEndlessMachine({ holdData: true });
    const statuses: number[] = [];
    server = startWebServer(appFor(machine, statuses), 0, { hostname: '127.0.0.1' });
    await once(server, 'listening');

    browser = connect((server.address() as AddressInfo).port, '127.0.0.1');
    browser.on('error', () => {});
    await once(browser, 'connect');
    browser.write('GET /machine/1/files/download?path=O1000 HTTP/1.1\r\nHost: localhost\r\n\r\n');
    await waitFor(() => machine.openDataConnections() === 1 && machine.commands.includes('RETR'));
    expect(machine.openDataConnections()).toBe(1);

    // The browser leaves. The machine has sent no byte of the file.
    browser.destroy();
    await waitFor(() => machine.openDataConnections() === 0 && machine.openControlConnections() === 0);

    expect(machine.openDataConnections()).toBe(0);
    expect(machine.openControlConnections()).toBe(0);
    expect(machine.commands.filter(command => command === 'RETR')).toHaveLength(1);
    await waitFor(() => statuses.length === 1);
    expect(statuses).toEqual([499]);
    const downloadLines = log.lines.filter(line => line.text.includes('The program download'));
    expect(downloadLines).toHaveLength(1);
    expect(downloadLines[0].level).toBe('debug');
    expect(downloadLines[0].text).toMatch(/ error=\S/);
    expect(log.lines.filter(line => line.level === 'error')).toEqual([]);
  });
});
