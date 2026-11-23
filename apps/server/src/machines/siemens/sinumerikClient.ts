import {
  AttributeIds,
  callConditionRefresh,
  ClientSubscription,
  constructEventFilter,
  MessageSecurityMode,
  OPCUAClient,
  resolveNodeId,
  SecurityPolicy,
  TimestampsToReturn,
  UserTokenType,
  type ClientSession,
  type EndpointDescription,
  type OPCUAClientOptions,
  type UserIdentityInfo,
  type Variant,
} from 'node-opcua-client';
import { OPCUACertificateManager } from 'node-opcua-certificate-manager';
import { certificateSha1Thumbprint, certificateThumbprint, CertificateChangedError, checkPin } from './certificatePin.js';
import { limitedTransportFactory, OPCUA_TRANSPORT_LIMITS } from './opcuaTransport.js';
import type { AlarmEvent } from './sinumerikAlarms.js';
import { sinumerikNodeId } from './sinumerikValues.js';

/** How Chatter talks to the control: no security, or signed and encrypted with Basic256Sha256 */
export type SinumerikSecurity = 'none' | 'signAndEncrypt';

export const SINUMERIK_SECURITY_MODES: readonly SinumerikSecurity[] = ['none', 'signAndEncrypt'];

export interface SinumerikConnectOptions {
  host: string;
  port: number;
  /** No user means an anonymous login */
  user?: string;
  password?: string;
  security: SinumerikSecurity;
  timeoutMs: number;
  /**
   * The thumbprint of the certificate of the control that Chatter trusts, or null before the first connect.
   * When the control shows a different certificate, the session does not open and the login is not sent.
   */
  trustedThumbprint: string | null;
}

/** One value of a read. `value` is undefined when the control could not give it, and `status` tells why. */
export interface SinumerikValue {
  value: unknown;
  status: string;
}

/** A connection to the OPC UA server of one control */
export interface SinumerikSession {
  /** The thumbprint of the certificate that the control showed, or null when it showed none (only with no security) */
  readonly serverThumbprint: string | null;
  read(paths: string[]): Promise<SinumerikValue[]>;
  /**
   * Get the alarm events of the control, the alarms that are active already first.
   * Throws when the control sends no alarm events. Gives a warning when the events come, but the
   * control did not send the alarms that were active already.
   */
  watchAlarms(onEvent: (event: AlarmEvent) => void): Promise<string | null>;
  close(): Promise<void>;
}

export type OpenSinumerikSession = (options: SinumerikConnectOptions) => Promise<SinumerikSession>;

/**
 * SINUMERIK allows only a few OPC UA sessions. A session that Chatter leaves (for example when the network
 * drops) stays on the control until it times out, so the timeout is short. The node-opcua default is 20 minutes.
 */
const SESSION_TIMEOUT_MS = 60_000;
const ALARM_PUBLISHING_INTERVAL_MS = 1000;

/** The name in the client certificate. A fixed one, because the host name changes with each Docker container. */
const APPLICATION_NAME = 'Chatter';
const APPLICATION_URI = 'urn:chatter:opcua-client';

/** The event fields, in the order that the values of an event come */
const ALARM_FIELDS = ['ConditionId', 'ConditionName', 'SourceName', 'Message', 'ActiveState.Id', 'Retain'] as const;

let certificateFolder: string | null = null;
let certificateManager: OPCUACertificateManager | null = null;

/**
 * Keep the client certificate in this folder, which must survive updates (the data folder).
 * The operator trusts this certificate on the control once, so it must not change.
 */
export function useSinumerikCertificateFolder(folder: string): void {
  certificateFolder = folder;
  certificateManager = null;
}

/** One certificate store for every Siemens machine, so they all use the same client certificate */
function sharedCertificateManager(): OPCUACertificateManager | undefined {
  if (!certificateFolder) return undefined;
  // A SINUMERIK server certificate is self-signed, so the store of node-opcua would refuse it. The store accepts each
  // certificate, and Chatter does its own check: the certificate must be the trusted one (certificatePin.ts), and
  // Chatter checks it before it opens the session. See docs/security.md.
  certificateManager ??= new OPCUACertificateManager({
    rootFolder: certificateFolder,
    automaticallyAcceptUnknownCertificate: true,
  });
  return certificateManager;
}

function userIdentity(options: SinumerikConnectOptions): UserIdentityInfo {
  if (!options.user) return { type: UserTokenType.Anonymous };
  return { type: UserTokenType.UserName, userName: options.user, password: options.password ?? '' };
}

/** The parts of an OPCUAClient that Chatter uses. A test gives a fake one. */
export interface OpcUaClientLike {
  connect(endpointUrl: string): Promise<void>;
  getEndpoints(): Promise<EndpointDescription[]>;
  createSession(userIdentity: UserIdentityInfo): Promise<ClientSession>;
  disconnect(): Promise<void>;
}

export type CreateOpcUaClient = (options: OPCUAClientOptions) => OpcUaClientLike;

/** The settings of each connection to a control: the one that reads the certificate, and the one with the session */
function clientOptions(options: SinumerikConnectOptions): OPCUAClientOptions {
  return {
    applicationName: APPLICATION_NAME,
    applicationUri: APPLICATION_URI,
    clientCertificateManager: sharedCertificateManager(),
    endpointMustExist: false,
    transportTimeout: options.timeoutMs,
    defaultTransactionTimeout: options.timeoutMs,
    transportFactory: limitedTransportFactory,
    transportSettings: OPCUA_TRANSPORT_LIMITS,
    // The poller tries again with its own back-off, so the client must not. It also keeps the pin: with a retry,
    // node-opcua connects again by itself after a break, and it takes a new certificate of the control with no check.
    connectionStrategy: { maxRetry: 0, initialDelay: 100, maxDelay: 200 },
  };
}

function certificateOf(endpoint: EndpointDescription | undefined): Buffer | null {
  const certificate = endpoint?.serverCertificate;
  return certificate && certificate.length > 0 ? certificate : null;
}

/**
 * The certificate that the control shows for the security that is set.
 * Sign and encrypt uses the certificate of its endpoint, and the session cannot open without the private key of it.
 * With no security, a control may give no certificate in its None endpoint, so the certificate of any endpoint counts.
 */
function serverCertificateFor(endpoints: EndpointDescription[], security: SinumerikSecurity): Buffer | null {
  if (security === 'signAndEncrypt') {
    const secure = endpoints.find(endpoint =>
      endpoint.securityMode === MessageSecurityMode.SignAndEncrypt && endpoint.securityPolicyUri === SecurityPolicy.Basic256Sha256);
    if (!secure) throw new Error('The control has no OPC UA endpoint for Sign and encrypt (Basic256Sha256). Turn it on at the control.');
    const certificate = certificateOf(secure);
    if (!certificate) throw new Error('The Sign and encrypt endpoint of the control has no certificate');
    return certificate;
  }
  const plain = endpoints.find(endpoint => endpoint.securityMode === MessageSecurityMode.None);
  return certificateOf(plain) ?? endpoints.map(certificateOf).find(certificate => certificate !== null) ?? null;
}

/** Ask the control for its endpoints on a connection with no security and no login, then close that connection */
async function readServerCertificate(
  createClient: CreateOpcUaClient, endpointUrl: string, options: SinumerikConnectOptions,
): Promise<Buffer | null> {
  const discovery = createClient({ ...clientOptions(options), securityMode: MessageSecurityMode.None, securityPolicy: SecurityPolicy.None });
  try {
    await discovery.connect(endpointUrl);
    return serverCertificateFor(await discovery.getEndpoints(), options.security);
  } finally {
    await discovery.disconnect().catch(() => undefined);
  }
}

/** With security None, the control asks for the OPC UA password with no encryption. Chatter did not send it. */
export class ClearTextPasswordError extends Error {
  constructor(reason: string) {
    super(`${reason} Chatter did not send the OPC UA password. Set Security to Sign and encrypt.`);
    this.name = 'ClearTextPasswordError';
  }
}

/** The security policies that encrypt a password. None, an empty one and an unknown one do not. */
const ENCRYPTING_POLICIES = new Set<string>(
  Object.values(SecurityPolicy).filter(uri => uri !== SecurityPolicy.None && uri !== SecurityPolicy.Invalid),
);

/**
 * With security None, the channel does not encrypt. So the password is safe only when its user token policy encrypts it
 * with the certificate of the control. node-opcua takes the password policy of a None endpoint, and with no policy of
 * its own the policy of the channel (None). It encrypts with the trusted certificate, because the session client has
 * it as serverCertificate. Each None endpoint and each password policy of it must encrypt, so the choice of node-opcua
 * does not matter. These are the endpoints that the session connection got last, and node-opcua uses them for the session.
 * Sign and encrypt needs no check: the channel encrypts each message.
 * Chatter does not use requireTrustedServerForUserName of node-opcua: it also refuses a password policy with no
 * encryption with Sign and encrypt, and it checks the certificate in the store, which can refuse an expired control certificate.
 */
function refuseClearTextPassword(endpoints: EndpointDescription[], certificate: Buffer | null): void {
  if (!certificate) {
    throw new ClearTextPasswordError('The control shows no OPC UA certificate, so Chatter cannot encrypt the password.');
  }
  const passwordPolicies = endpoints
    .filter(endpoint => endpoint.securityMode === MessageSecurityMode.None)
    .flatMap(endpoint => endpoint.userIdentityTokens ?? [])
    .filter(policy => policy.tokenType === UserTokenType.UserName);
  if (passwordPolicies.some(policy => !ENCRYPTING_POLICIES.has(policy.securityPolicyUri ?? ''))) {
    throw new ClearTextPasswordError('The control asks for the OPC UA password with no encryption.');
  }
}

/**
 * Open a session on the OPC UA server of a SINUMERIK control. Nothing stays open when it fails.
 *
 * First, Chatter reads the certificate of the control, and compares it with the trusted one (F-11). When it is not the
 * trusted one, Chatter throws CertificateChangedError: it does not open the session and does not send the login.
 * Then the session connection uses that certificate (serverCertificate), so node-opcua does not get a new one:
 * - Sign and encrypt: the secure channel opens only with the control that has the private key of that certificate.
 * - No security: the control proves nothing. A device in the middle can show a copy of the certificate of the control.
 *   The pin finds a new control, but not that. Chatter (node-opcua) encrypts the password with the public key of the
 *   trusted certificate, so only the holder of its private key can read the password. node-opcua uses that key because
 *   it puts serverCertificate into the session before ActivateSession (#refreshSessionServerCertificate, node-opcua
 *   2.187). The test with a proxy in sinumerikClient.pin.test.ts fails if a new version stops this.
 *   A control that asks for the password with no encryption gets no password (ClearTextPasswordError).
 */
export function sinumerikSessionOpener(createClient: CreateOpcUaClient): OpenSinumerikSession {
  return async options => {
    const endpointUrl = `opc.tcp://${options.host}:${options.port}`;
    const certificate = await readServerCertificate(createClient, endpointUrl, options);
    const thumbprint = certificate ? certificateThumbprint(certificate) : null;
    const pin = checkPin(options.trustedThumbprint, thumbprint);
    if (pin.outcome === 'changed' && options.trustedThumbprint !== null) {
      throw new CertificateChangedError(pin.presented, options.trustedThumbprint, certificate && certificateSha1Thumbprint(certificate));
    }

    const secure = options.security === 'signAndEncrypt';
    const client = createClient({
      ...clientOptions(options),
      securityMode: secure ? MessageSecurityMode.SignAndEncrypt : MessageSecurityMode.None,
      securityPolicy: secure ? SecurityPolicy.Basic256Sha256 : SecurityPolicy.None,
      serverCertificate: certificate ?? undefined,
      requestedSessionTimeout: SESSION_TIMEOUT_MS,
      keepSessionAlive: true,
    });
    try {
      await client.connect(endpointUrl);
      if (!secure && options.user) refuseClearTextPassword(await client.getEndpoints(), certificate);
      const session = await client.createSession(userIdentity(options));
      return new OpcUaSinumerikSession(client, session, thumbprint);
    } catch (error) {
      await client.disconnect().catch(() => undefined);
      throw error;
    }
  };
}

export const openSinumerikSession: OpenSinumerikSession = sinumerikSessionOpener(options => OPCUAClient.create(options));

class OpcUaSinumerikSession implements SinumerikSession {
  private subscription: ClientSubscription | null = null;

  constructor(
    private readonly client: OpcUaClientLike,
    private readonly session: ClientSession,
    readonly serverThumbprint: string | null,
  ) {}

  async read(paths: string[]): Promise<SinumerikValue[]> {
    const results = await this.session.read(
      paths.map(path => ({ nodeId: sinumerikNodeId(path), attributeId: AttributeIds.Value })),
    );
    return results.map(result => ({
      value: result.statusCode.isGood() ? result.value.value : undefined,
      status: result.statusCode.name,
    }));
  }

  async watchAlarms(onEvent: (event: AlarmEvent) => void): Promise<string | null> {
    const subscription = ClientSubscription.create(this.session, {
      requestedPublishingInterval: ALARM_PUBLISHING_INTERVAL_MS,
      requestedLifetimeCount: 60,
      requestedMaxKeepAliveCount: 10,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    });
    this.subscription = subscription;

    const monitoredItem = await subscription.monitor(
      { nodeId: resolveNodeId('Server'), attributeId: AttributeIds.EventNotifier },
      { samplingInterval: 0, queueSize: 100, discardOldest: true, filter: constructEventFilter([...ALARM_FIELDS]) },
      TimestampsToReturn.Neither,
    );
    monitoredItem.on('changed', (values: Variant[]) => {
      try {
        onEvent(toAlarmEvent(values));
      } catch {
        // A strange event must not stop the subscription
      }
    });
    // Ask for the alarms that are active already. Without it, Chatter sees only the alarms that come later.
    const refresh = await callConditionRefresh(this.session, subscription.subscriptionId);
    return refresh.isGood() ? null : `Alarms that were active before Chatter connected may be missing (ConditionRefresh: ${refresh.name})`;
  }

  async close(): Promise<void> {
    await this.subscription?.terminate().catch(() => undefined);
    this.subscription = null;
    await this.session.close().catch(() => undefined);
    await this.client.disconnect().catch(() => undefined);
  }
}

function toAlarmEvent(values: Variant[]): AlarmEvent {
  const [conditionId, conditionName, sourceName, message, active, retain] = values.map(variant => variant?.value);
  return {
    conditionId: conditionId ? String(conditionId) : undefined,
    conditionName: textOf(conditionName),
    sourceName: textOf(sourceName),
    message: textOf(message),
    active: typeof active === 'boolean' ? active : undefined,
    retain: typeof retain === 'boolean' ? retain : undefined,
  };
}

/** A string, or the text of a LocalizedText */
function textOf(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object' && 'text' in value) return (value as { text?: string | null }).text ?? undefined;
  return String(value);
}
