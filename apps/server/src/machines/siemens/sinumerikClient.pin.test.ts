import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OPCUACertificateManager } from 'node-opcua-certificate-manager';
import { MessageSecurityMode, SecurityPolicy } from 'node-opcua-client';
import { OPCUAServer } from 'node-opcua-server';
import { certificateThumbprint, CertificateChangedError } from './certificatePin.js';
import { openSinumerikSession, useSinumerikCertificateFolder, type SinumerikConnectOptions } from './sinumerikClient.js';

/**
 * F-11 with a real OPC UA server (node-opcua-server) on a free port of this computer:
 * the first connect trusts the certificate, and a new certificate at the same address gets no login.
 * Each server makes its own certificate in its own new folder, as a new control (or a device in the middle) does.
 */

const USER = 'OpcUaClient';
const PASSWORD = 'secret-of-the-control';
// Each step answers in milliseconds on this computer. The limit is for a slow CI runner, not a wait.
const STEP_TIMEOUT_MS = 10_000;

interface FakeControl {
  server: OPCUAServer;
  port: number;
  thumbprint: string;
  /** Each username that came to the control with a password */
  logins: string[];
  sessions: number;
}

describe('the certificate pin with a real OPC UA server', () => {
  let folder: string;
  const running: OPCUAServer[] = [];

  beforeAll(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'chatter-opcua-pin-'));
    useSinumerikCertificateFolder(path.join(folder, 'chatter'));
  });

  afterEach(async () => {
    await Promise.all(running.splice(0).map(server => server.shutdown()));
  });

  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  async function startControl(name: string): Promise<FakeControl> {
    const logins: string[] = [];
    const server = new OPCUAServer({
      port: 0,
      serverCertificateManager: new OPCUACertificateManager({
        rootFolder: path.join(folder, name), automaticallyAcceptUnknownCertificate: true,
      }),
      securityModes: [MessageSecurityMode.None, MessageSecurityMode.SignAndEncrypt],
      securityPolicies: [SecurityPolicy.None, SecurityPolicy.Basic256Sha256],
      userManager: {
        isValidUser: (userName: string, password: string) => {
          logins.push(userName);
          return userName === USER && password === PASSWORD;
        },
      },
    });
    running.push(server);
    const control: FakeControl = { server, port: 0, thumbprint: '', logins, sessions: 0 };
    server.on('create_session', () => { control.sessions++; });
    await server.start();
    control.port = Number(new URL(server.getEndpointUrl().replace('opc.tcp:', 'http:')).port);
    control.thumbprint = certificateThumbprint(server.getCertificate());
    return control;
  }

  async function stopControl(control: FakeControl): Promise<void> {
    running.splice(running.indexOf(control.server), 1);
    await control.server.shutdown();
  }

  const options = (control: FakeControl, extra: Partial<SinumerikConnectOptions>): SinumerikConnectOptions => ({
    host: '127.0.0.1', port: control.port, user: USER, password: PASSWORD, security: 'signAndEncrypt',
    timeoutMs: STEP_TIMEOUT_MS, trustedThumbprint: null, ...extra,
  });

  it('trusts the certificate on the first connect, and sends no login to a new certificate at the same address', async () => {
    const first = await startControl('control');
    const session = await openSinumerikSession(options(first, {}));
    expect(session.serverThumbprint).toBe(first.thumbprint);
    expect(first.logins).toEqual([USER]);
    await session.close();
    await stopControl(first);

    // A different device answers: same address, new certificate
    const impostor = await startControl('impostor');
    expect(impostor.thumbprint).not.toBe(first.thumbprint);

    const opening = openSinumerikSession(options(impostor, { trustedThumbprint: first.thumbprint }));

    await expect(opening).rejects.toBeInstanceOf(CertificateChangedError);
    await expect(opening).rejects.toMatchObject({ presentedThumbprint: impostor.thumbprint });
    expect(impostor.logins).toEqual([]);
    expect(impostor.sessions).toBe(0);
  }, 4 * STEP_TIMEOUT_MS);

  it('logs in again with no security to the control that it trusts', async () => {
    const control = await startControl('plain');

    const first = await openSinumerikSession(options(control, { security: 'none' }));
    await first.close();
    const again = await openSinumerikSession(options(control, { security: 'none', trustedThumbprint: first.serverThumbprint }));
    await again.close();

    expect(first.serverThumbprint).toBe(control.thumbprint);
    expect(control.logins).toEqual([USER, USER]);
  }, 4 * STEP_TIMEOUT_MS);
});
