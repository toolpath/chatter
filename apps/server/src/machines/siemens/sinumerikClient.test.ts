import { describe, expect, it } from 'vitest';
import {
  MessageSecurityMode,
  SecurityPolicy,
  type ClientSession,
  type EndpointDescription,
  type OPCUAClientOptions,
  type UserIdentityInfo,
} from 'node-opcua-client';
import { certificateThumbprint, CertificateChangedError } from './certificatePin.js';
import { limitedTransportFactory, OPCUA_TRANSPORT_LIMITS } from './opcuaTransport.js';
import { sinumerikSessionOpener, type OpcUaClientLike, type SinumerikConnectOptions } from './sinumerikClient.js';

/** Two certificates as DER bytes. Only their bytes count here. */
const CONTROL_CERTIFICATE = Buffer.from([0x30, 0x03, 1, 2, 3]);
const OTHER_CERTIFICATE = Buffer.from([0x30, 0x03, 9, 9, 9]);
const CONTROL_THUMBPRINT = certificateThumbprint(CONTROL_CERTIFICATE);

function endpoint(securityMode: MessageSecurityMode, securityPolicyUri: string, serverCertificate: Buffer | null): EndpointDescription {
  return { securityMode, securityPolicyUri, serverCertificate } as unknown as EndpointDescription;
}

/** The endpoints of a control that has the two modes that Chatter uses, each with the same certificate */
function endpointsWith(certificate: Buffer | null): EndpointDescription[] {
  return [
    endpoint(MessageSecurityMode.None, SecurityPolicy.None, certificate),
    endpoint(MessageSecurityMode.SignAndEncrypt, SecurityPolicy.Basic256Sha256, certificate),
  ];
}

class FakeClient implements OpcUaClientLike {
  connectedTo: string | null = null;
  disconnected = false;
  readonly logins: UserIdentityInfo[] = [];
  sessionError: Error | null = null;

  constructor(readonly options: OPCUAClientOptions, private readonly endpoints: EndpointDescription[]) {}

  async connect(endpointUrl: string): Promise<void> {
    this.connectedTo = endpointUrl;
  }

  async getEndpoints(): Promise<EndpointDescription[]> {
    return this.endpoints;
  }

  async createSession(identity: UserIdentityInfo): Promise<ClientSession> {
    this.logins.push(identity);
    if (this.sessionError) throw this.sessionError;
    return { close: async () => undefined } as unknown as ClientSession;
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
  }
}

/** The control, as the clients that Chatter makes see it */
function fakeControl(endpoints: EndpointDescription[]) {
  const clients: FakeClient[] = [];
  const open = sinumerikSessionOpener(options => {
    const client = new FakeClient(options, endpoints);
    clients.push(client);
    return client;
  });
  return { clients, open, logins: () => clients.flatMap(client => client.logins) };
}

const LOGIN: SinumerikConnectOptions = {
  host: '10.0.0.5', port: 4840, user: 'OpcUaClient', password: 'secret', security: 'none', timeoutMs: 5000, trustedThumbprint: null,
};

describe('openSinumerikSession and the certificate of the control', () => {
  it('reads the certificate first, on a connection with no login, and closes that connection', async () => {
    const control = fakeControl(endpointsWith(CONTROL_CERTIFICATE));
    await control.open(LOGIN);

    const [discovery] = control.clients;
    expect(discovery.options.securityMode).toBe(MessageSecurityMode.None);
    expect(discovery.connectedTo).toBe('opc.tcp://10.0.0.5:4840');
    expect(discovery.logins).toEqual([]);
    expect(discovery.disconnected).toBe(true);
  });

  it('logs in on the first connect, and gives the thumbprint to save', async () => {
    const control = fakeControl(endpointsWith(CONTROL_CERTIFICATE));
    const session = await control.open(LOGIN);

    expect(session.serverThumbprint).toBe(CONTROL_THUMBPRINT);
    expect(control.logins()).toEqual([expect.objectContaining({ userName: 'OpcUaClient', password: 'secret' })]);
  });

  it('logs in when the control shows the trusted certificate', async () => {
    const control = fakeControl(endpointsWith(CONTROL_CERTIFICATE));
    const session = await control.open({ ...LOGIN, trustedThumbprint: CONTROL_THUMBPRINT });

    expect(session.serverThumbprint).toBe(CONTROL_THUMBPRINT);
    expect(control.logins()).toHaveLength(1);
  });

  it('opens the session with the certificate that it checked, not with one that comes later', async () => {
    const control = fakeControl(endpointsWith(CONTROL_CERTIFICATE));
    await control.open({ ...LOGIN, security: 'signAndEncrypt', trustedThumbprint: CONTROL_THUMBPRINT });

    const [, main] = control.clients;
    expect(main.options).toMatchObject({
      securityMode: MessageSecurityMode.SignAndEncrypt,
      securityPolicy: SecurityPolicy.Basic256Sha256,
      serverCertificate: CONTROL_CERTIFICATE,
    });
  });

  it('never sends the login when the certificate changed, and makes no second connection', async () => {
    const control = fakeControl(endpointsWith(OTHER_CERTIFICATE));

    const opening = control.open({ ...LOGIN, trustedThumbprint: CONTROL_THUMBPRINT });

    await expect(opening).rejects.toBeInstanceOf(CertificateChangedError);
    await expect(opening).rejects.toMatchObject({
      presentedThumbprint: certificateThumbprint(OTHER_CERTIFICATE), trustedThumbprint: CONTROL_THUMBPRINT,
    });
    expect(control.logins()).toEqual([]);
    expect(control.clients).toHaveLength(1);
    expect(control.clients[0].disconnected).toBe(true);
  });

  it('never sends the login when the control shows no certificate and a certificate is trusted', async () => {
    const control = fakeControl(endpointsWith(null));
    await expect(control.open({ ...LOGIN, trustedThumbprint: CONTROL_THUMBPRINT }))
      .rejects.toMatchObject({ presentedThumbprint: null });
    expect(control.logins()).toEqual([]);
  });

  it('uses the certificate of the Sign and encrypt endpoint for that mode', async () => {
    const control = fakeControl([
      endpoint(MessageSecurityMode.None, SecurityPolicy.None, OTHER_CERTIFICATE),
      endpoint(MessageSecurityMode.SignAndEncrypt, SecurityPolicy.Basic256Sha256, CONTROL_CERTIFICATE),
    ]);
    const session = await control.open({ ...LOGIN, security: 'signAndEncrypt' });
    expect(session.serverThumbprint).toBe(CONTROL_THUMBPRINT);
  });

  it('refuses Sign and encrypt when the control has no endpoint for it, before the login', async () => {
    const control = fakeControl([endpoint(MessageSecurityMode.None, SecurityPolicy.None, CONTROL_CERTIFICATE)]);
    await expect(control.open({ ...LOGIN, security: 'signAndEncrypt' })).rejects.toThrow('Sign and encrypt');
    expect(control.logins()).toEqual([]);
  });

  it('with no security, uses a certificate of any endpoint when the None endpoint has none', async () => {
    const control = fakeControl([
      endpoint(MessageSecurityMode.None, SecurityPolicy.None, null),
      endpoint(MessageSecurityMode.SignAndEncrypt, SecurityPolicy.Basic256Sha256, CONTROL_CERTIFICATE),
    ]);
    const session = await control.open(LOGIN);
    expect(session.serverThumbprint).toBe(CONTROL_THUMBPRINT);
    expect(control.clients[1].options.serverCertificate).toEqual(CONTROL_CERTIFICATE);
  });

  it('with no security, logs in to a control that shows no certificate when none is trusted, and saves nothing', async () => {
    const control = fakeControl(endpointsWith(null));
    const session = await control.open(LOGIN);
    expect(session.serverThumbprint).toBeNull();
    expect(control.clients[1].options.serverCertificate).toBeUndefined();
  });

  it('closes the connection when the login fails', async () => {
    const clients: FakeClient[] = [];
    const open = sinumerikSessionOpener(options => {
      const client = new FakeClient(options, endpointsWith(CONTROL_CERTIFICATE));
      client.sessionError = new Error('BadUserAccessDenied');
      clients.push(client);
      return client;
    });
    await expect(open(LOGIN)).rejects.toThrow('BadUserAccessDenied');
    expect(clients.every(client => client.disconnected)).toBe(true);
  });

  it('gives each connection the reply limits, and no retry of its own', async () => {
    const control = fakeControl(endpointsWith(CONTROL_CERTIFICATE));
    await control.open(LOGIN);
    for (const client of control.clients) {
      expect(client.options).toMatchObject({
        transportFactory: limitedTransportFactory,
        transportSettings: OPCUA_TRANSPORT_LIMITS,
        connectionStrategy: expect.objectContaining({ maxRetry: 0 }),
      });
    }
  });
});
