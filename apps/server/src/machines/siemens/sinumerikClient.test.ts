import { describe, expect, it } from 'vitest';
import {
  MessageSecurityMode,
  SecurityPolicy,
  type ClientSession,
  type EndpointDescription,
  type OPCUAClientOptions,
  type UserIdentityInfo,
  type UserTokenPolicy,
  UserTokenType,
} from 'node-opcua-client';
import { certificateSha1Thumbprint, certificateThumbprint, CertificateChangedError } from './certificatePin.js';
import { limitedTransportFactory, OPCUA_TRANSPORT_LIMITS } from './opcuaTransport.js';
import {
  ClearTextPasswordError, sinumerikSessionOpener, type OpcUaClientLike, type SinumerikConnectOptions,
} from './sinumerikClient.js';

/** Two certificates as DER bytes. Only their bytes count here. */
const CONTROL_CERTIFICATE = Buffer.from([0x30, 0x03, 1, 2, 3]);
const OTHER_CERTIFICATE = Buffer.from([0x30, 0x03, 9, 9, 9]);
const CONTROL_THUMBPRINT = certificateThumbprint(CONTROL_CERTIFICATE);

/** A user token policy of an endpoint. A securityPolicyUri of None or null means: the password goes with no encryption. */
function policy(tokenType: UserTokenType, securityPolicyUri: string | null): UserTokenPolicy {
  return { policyId: `${tokenType}-${securityPolicyUri}`, tokenType, securityPolicyUri } as unknown as UserTokenPolicy;
}

/** The control encrypts the password with the key of its certificate, as a SINUMERIK does with security None */
const ENCRYPTED_PASSWORD = [policy(UserTokenType.Anonymous, null), policy(UserTokenType.UserName, SecurityPolicy.Basic256Sha256)];
/** The control asks for the password with no encryption */
const CLEAR_TEXT_PASSWORD = [policy(UserTokenType.Anonymous, null), policy(UserTokenType.UserName, SecurityPolicy.None)];

function endpoint(
  securityMode: MessageSecurityMode, securityPolicyUri: string, serverCertificate: Buffer | null,
  userIdentityTokens: UserTokenPolicy[] = ENCRYPTED_PASSWORD,
): EndpointDescription {
  return { securityMode, securityPolicyUri, serverCertificate, userIdentityTokens } as unknown as EndpointDescription;
}

/** The endpoint, at this address */
function at(endpointUrl: string, description: EndpointDescription): EndpointDescription {
  return { ...description, endpointUrl } as EndpointDescription;
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

/**
 * The control, as the clients that Chatter makes see it.
 * `sessionEndpoints` are the endpoints on the session connection, when they are not the same as on the first one.
 */
function fakeControl(endpoints: EndpointDescription[], sessionEndpoints = endpoints) {
  const clients: FakeClient[] = [];
  const open = sinumerikSessionOpener(options => {
    const client = new FakeClient(options, clients.length === 0 ? endpoints : sessionEndpoints);
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
      presentedThumbprint: certificateThumbprint(OTHER_CERTIFICATE),
      presentedSha1Thumbprint: certificateSha1Thumbprint(OTHER_CERTIFICATE),
      trustedThumbprint: CONTROL_THUMBPRINT,
    });
    expect(control.logins()).toEqual([]);
    expect(control.clients).toHaveLength(1);
    expect(control.clients[0].disconnected).toBe(true);
  });

  it('never sends the login when the control shows no certificate and a certificate is trusted', async () => {
    const control = fakeControl(endpointsWith(null));
    await expect(control.open({ ...LOGIN, trustedThumbprint: CONTROL_THUMBPRINT }))
      .rejects.toMatchObject({ presentedThumbprint: null, presentedSha1Thumbprint: null });
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

  it('with no security, uses the certificate of the None endpoint when the endpoints have different certificates', async () => {
    const control = fakeControl([
      endpoint(MessageSecurityMode.SignAndEncrypt, SecurityPolicy.Basic256Sha256, OTHER_CERTIFICATE),
      endpoint(MessageSecurityMode.None, SecurityPolicy.None, CONTROL_CERTIFICATE),
    ]);
    const session = await control.open(LOGIN);
    expect(session.serverThumbprint).toBe(CONTROL_THUMBPRINT);
  });

  it.each(['none', 'signAndEncrypt'] as const)(
    'with %s, uses the certificate of the endpoint at the address that Chatter uses, when the control lists more than one',
    async security => {
      const [mode, securityPolicy] = security === 'none'
        ? [MessageSecurityMode.None, SecurityPolicy.None]
        : [MessageSecurityMode.SignAndEncrypt, SecurityPolicy.Basic256Sha256];
      const control = fakeControl([
        at('opc.tcp://192.168.200.1:4840', endpoint(mode, securityPolicy, OTHER_CERTIFICATE)),
        at('opc.tcp://10.0.0.5:4840/', endpoint(mode, securityPolicy, CONTROL_CERTIFICATE)),
      ]);
      const session = await control.open({ ...LOGIN, security });
      expect(session.serverThumbprint).toBe(CONTROL_THUMBPRINT);
    },
  );

  it('uses the first endpoint for the security when no endpoint has the address that Chatter uses', async () => {
    const control = fakeControl([
      at('opc.tcp://SINUMERIK-828D:4840', endpoint(MessageSecurityMode.None, SecurityPolicy.None, CONTROL_CERTIFICATE)),
      at('opc.tcp://192.168.200.1:4840', endpoint(MessageSecurityMode.None, SecurityPolicy.None, OTHER_CERTIFICATE)),
    ]);
    const session = await control.open(LOGIN);
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

  it('with no security, connects with no login to a control that shows no certificate when none is trusted, and saves nothing', async () => {
    const control = fakeControl(endpointsWith(null));
    const session = await control.open({ ...LOGIN, user: undefined, password: undefined });
    expect(session.serverThumbprint).toBeNull();
    expect(control.clients[1].options.serverCertificate).toBeUndefined();
    expect(control.logins()).toEqual([{ type: UserTokenType.Anonymous }]);
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

describe('openSinumerikSession never sends the password in clear text', () => {
  const noneEndpoint = (tokens: UserTokenPolicy[], certificate: Buffer | null = CONTROL_CERTIFICATE) =>
    [endpoint(MessageSecurityMode.None, SecurityPolicy.None, certificate, tokens)];

  async function expectRefused(control: ReturnType<typeof fakeControl>, options: SinumerikConnectOptions = LOGIN): Promise<void> {
    const opening = control.open(options);
    await expect(opening).rejects.toBeInstanceOf(ClearTextPasswordError);
    await expect(opening).rejects.toThrow('Sign and encrypt');
    expect(control.logins()).toEqual([]);
    expect(control.clients.every(client => client.disconnected)).toBe(true);
  }

  it('with no security, sends the password when the control asks for it encrypted with its certificate', async () => {
    const control = fakeControl(noneEndpoint(ENCRYPTED_PASSWORD));
    await control.open(LOGIN);
    expect(control.logins()).toEqual([expect.objectContaining({ userName: 'OpcUaClient', password: 'secret' })]);
  });

  it('with no security, refuses a control that asks for the password with no encryption', async () => {
    await expectRefused(fakeControl(noneEndpoint(CLEAR_TEXT_PASSWORD)));
  });

  it('with no security, refuses a password policy that names no security policy (it takes None from the channel)', async () => {
    await expectRefused(fakeControl(noneEndpoint([policy(UserTokenType.UserName, null)])));
    await expectRefused(fakeControl(noneEndpoint([policy(UserTokenType.UserName, '')])));
  });

  it('with no security, refuses a password policy with a security policy that node-opcua does not know', async () => {
    await expectRefused(fakeControl(noneEndpoint([policy(UserTokenType.UserName, 'http://example.com/UA/SecurityPolicy#Unknown')])));
  });

  it('with no security, refuses a control that offers a clear-text password next to an encrypted one', async () => {
    await expectRefused(fakeControl(noneEndpoint([...ENCRYPTED_PASSWORD, policy(UserTokenType.UserName, SecurityPolicy.None)])));
  });

  it('with no security, refuses when any None endpoint asks for the password with no encryption', async () => {
    await expectRefused(fakeControl([
      endpoint(MessageSecurityMode.None, SecurityPolicy.None, CONTROL_CERTIFICATE, ENCRYPTED_PASSWORD),
      endpoint(MessageSecurityMode.None, SecurityPolicy.None, CONTROL_CERTIFICATE, CLEAR_TEXT_PASSWORD),
    ]));
  });

  it('with no security, refuses a password to a control that shows no certificate, because nothing can encrypt it', async () => {
    await expectRefused(fakeControl(noneEndpoint(ENCRYPTED_PASSWORD, null)));
  });

  it('checks the endpoints of the session connection, not only the ones of the first connection', async () => {
    await expectRefused(fakeControl(noneEndpoint(ENCRYPTED_PASSWORD), noneEndpoint(CLEAR_TEXT_PASSWORD)));
  });

  it('with no security and no login, connects to a control that asks for the password with no encryption', async () => {
    const control = fakeControl(noneEndpoint(CLEAR_TEXT_PASSWORD));
    await control.open({ ...LOGIN, user: undefined, password: undefined });
    expect(control.logins()).toEqual([{ type: UserTokenType.Anonymous }]);
  });

  it('with no security, logs in with no login for a username of only spaces, also with a password', async () => {
    const control = fakeControl(noneEndpoint(CLEAR_TEXT_PASSWORD));
    await control.open({ ...LOGIN, user: '   ' });
    expect(control.logins()).toEqual([{ type: UserTokenType.Anonymous }]);
  });

  it('with no security, logs in with no login for a password with no username', async () => {
    const control = fakeControl(noneEndpoint(CLEAR_TEXT_PASSWORD));
    await control.open({ ...LOGIN, user: '' });
    expect(control.logins()).toEqual([{ type: UserTokenType.Anonymous }]);
  });

  it('with Sign and encrypt, sends the password in a policy with no encryption of its own, because the channel encrypts it', async () => {
    const control = fakeControl([
      endpoint(MessageSecurityMode.SignAndEncrypt, SecurityPolicy.Basic256Sha256, CONTROL_CERTIFICATE, CLEAR_TEXT_PASSWORD),
    ]);
    await control.open({ ...LOGIN, security: 'signAndEncrypt' });
    expect(control.logins()).toEqual([expect.objectContaining({ password: 'secret' })]);
  });
});
