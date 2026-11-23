import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OPCUACertificateManager } from 'node-opcua-certificate-manager';
import { MessageSecurityMode, SecurityPolicy, StatusCodes } from 'node-opcua-client';
import { OPCUAServer, type OPCUAServerOptions } from 'node-opcua-server';
import { certificateThumbprint, CertificateChangedError } from './certificatePin.js';
import {
  ClearTextPasswordError, openSinumerikSession, useSinumerikCertificateFolder, type SinumerikConnectOptions,
} from './sinumerikClient.js';

/**
 * F-11 with a real OPC UA server (node-opcua-server) on a free port of this computer:
 * the first connect trusts the certificate, and a new certificate at the same address gets no login.
 * Each server makes its own certificate in its own new folder, as a new control (or a device in the middle) does.
 */

const MB = 1024 * 1024;

/** A TCP proxy on a free port: the first connection goes to `first`, each later one to `later`, as a device in the middle can do */
async function startSwitchingProxy(first: number, later: number): Promise<{ port: number; close(): Promise<void> }> {
  let connections = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer(client => {
    const upstream = net.connect(connections++ === 0 ? first : later, '127.0.0.1');
    for (const [socket, other] of [[client, upstream], [upstream, client]]) {
      sockets.add(socket);
      socket.pipe(other);
      socket.on('error', () => other.destroy());
      socket.on('close', () => other.destroy());
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    close: () => {
      sockets.forEach(socket => socket.destroy());
      return new Promise(resolve => server.close(() => resolve()));
    },
  };
}

/**
 * A device that accepts the connection with no limits (0) and very large buffers, then starts a reply of 1 MB in one part.
 * It never sends the bytes of the reply. It keeps what Chatter sends to it.
 */
async function startDeviceWithHugeReply(): Promise<{ port: number; received: Promise<Buffer>; close(): Promise<void> }> {
  let closed: (bytes: Buffer) => void = () => {};
  const received = new Promise<Buffer>(resolve => { closed = resolve; });
  const server = net.createServer(socket => {
    const bytes: Buffer[] = [];
    socket.on('error', () => undefined);
    socket.on('close', () => closed(Buffer.concat(bytes)));
    socket.once('data', () => {
      // The Acknowledge message: protocol version, receive and send buffer, max message size, max chunk count
      const acknowledge = Buffer.alloc(28);
      acknowledge.write('ACKF', 0, 'ascii');
      [28, 0, 16 * MB, 16 * MB, 0, 0].forEach((value, i) => acknowledge.writeUInt32LE(value, 4 + 4 * i));
      const replyHeader = Buffer.alloc(8);
      replyHeader.write('MSGF', 0, 'ascii');
      replyHeader.writeUInt32LE(MB, 4);
      socket.write(Buffer.concat([acknowledge, replyHeader]));
      socket.on('data', data => bytes.push(data));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    received,
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}

/** The status code in the Error message that Chatter sent, or null when it sent none */
function errorMessageStatus(bytes: Buffer): number | null {
  const start = bytes.indexOf('ERRF', 0, 'ascii');
  return start < 0 ? null : bytes.readUInt32LE(start + 8);
}


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
    useSinumerikCertificateFolder(null);
    rmSync(folder, { recursive: true, force: true });
  });

  async function startControl(name: string, settings: Partial<OPCUAServerOptions> = {}): Promise<FakeControl> {
    const logins: string[] = [];
    const server = new OPCUAServer({
      port: 0,
      // The address that Chatter uses, so the endpoints match it
      hostname: '127.0.0.1',
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
      ...settings,
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

  it.each(['signAndEncrypt', 'none'] as const)(
    'with %s, trusts the certificate on the first connect, and sends no login to a new certificate at the same address',
    async security => {
      const first = await startControl(`control-${security}`);
      const session = await openSinumerikSession(options(first, { security }));
      expect(session.serverThumbprint).toBe(first.thumbprint);
      expect(first.logins).toEqual([USER]);
      await session.close();
      await stopControl(first);

      // A different device answers: same address, new certificate
      const impostor = await startControl(`impostor-${security}`);
      expect(impostor.thumbprint).not.toBe(first.thumbprint);

      const opening = openSinumerikSession(options(impostor, { security, trustedThumbprint: first.thumbprint }));

      await expect(opening).rejects.toBeInstanceOf(CertificateChangedError);
      await expect(opening).rejects.toMatchObject({ presentedThumbprint: impostor.thumbprint });
      expect(impostor.logins).toEqual([]);
      expect(impostor.sessions).toBe(0);

      // An Admin trusts the thumbprint of the error: the same hash of the same bytes, so the next connect logs in
      const trusted = await openSinumerikSession(options(impostor, { security, trustedThumbprint: impostor.thumbprint }));
      await trusted.close();
      expect(impostor.logins).toEqual([USER]);
    },
    4 * STEP_TIMEOUT_MS,
  );

  it.each(['signAndEncrypt', 'none'] as const)(
    'with %s, sends no password to a device that takes the session connection after the check of the certificate',
    async security => {
      const control = await startControl(`checked-${security}`);
      const device = await startControl(`device-${security}`);
      const proxy = await startSwitchingProxy(control.port, device.port);
      try {
        const opening = openSinumerikSession({
          ...options(control, { security, trustedThumbprint: control.thumbprint }), port: proxy.port,
        });

        // The device does not have the private key of the trusted certificate. With Sign and encrypt, it cannot open the
        // channel. With None, it cannot read the password, because Chatter encrypts it with the trusted certificate.
        await expect(opening).rejects.toThrow();
        expect(device.logins).toEqual([]);
        expect(control.logins).toEqual([]);
        if (security === 'signAndEncrypt') expect(device.sessions).toBe(0);
      } finally {
        await proxy.close();
      }
    },
    4 * STEP_TIMEOUT_MS,
  );

  it('stops at a reply part that is larger than the limit, also when the device asked for no limits', async () => {
    const device = await startDeviceWithHugeReply();
    try {
      const opening = openSinumerikSession({ ...options({ port: device.port } as FakeControl, {}), port: device.port });

      await expect(opening).rejects.toThrow();
      // Chatter does not wait for the 1 MB: it tells the device that the part is too large, and closes the connection
      expect(errorMessageStatus(await device.received)).toBe(StatusCodes.BadTcpMessageTooLarge.value);
    } finally {
      await device.close();
    }
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

  it('with no security, sends no password to a control that asks for it with no encryption', async () => {
    // Only a None endpoint, and its only password policy is "no encryption", as a device in the middle can ask
    const control = await startControl('clear-text', {
      securityModes: [MessageSecurityMode.None], securityPolicies: [SecurityPolicy.None], allowUnsecurePassword: true,
    });

    const opening = openSinumerikSession(options(control, { security: 'none' }));

    await expect(opening).rejects.toBeInstanceOf(ClearTextPasswordError);
    expect(control.logins).toEqual([]);
    expect(control.sessions).toBe(0);
  }, 4 * STEP_TIMEOUT_MS);
});
