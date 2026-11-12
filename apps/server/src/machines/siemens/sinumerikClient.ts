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
  type UserIdentityInfo,
  type Variant,
} from 'node-opcua-client';
import { OPCUACertificateManager } from 'node-opcua-certificate-manager';
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
}

/** One value of a read. `value` is undefined when the control could not give it, and `status` tells why. */
export interface SinumerikValue {
  value: unknown;
  status: string;
}

/** A connection to the OPC UA server of one control */
export interface SinumerikSession {
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
  // A SINUMERIK server certificate is self-signed, so Chatter trusts the one it meets first
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

/** Open a session on the OPC UA server of a SINUMERIK control. Nothing stays open when it fails. */
export const openSinumerikSession: OpenSinumerikSession = async options => {
  const secure = options.security === 'signAndEncrypt';
  const client = OPCUAClient.create({
    applicationName: APPLICATION_NAME,
    applicationUri: APPLICATION_URI,
    clientCertificateManager: sharedCertificateManager(),
    securityMode: secure ? MessageSecurityMode.SignAndEncrypt : MessageSecurityMode.None,
    securityPolicy: secure ? SecurityPolicy.Basic256Sha256 : SecurityPolicy.None,
    endpointMustExist: false,
    requestedSessionTimeout: SESSION_TIMEOUT_MS,
    keepSessionAlive: true,
    transportTimeout: options.timeoutMs,
    defaultTransactionTimeout: options.timeoutMs,
    // The poller tries again with its own back-off, so the client must not
    connectionStrategy: { maxRetry: 0, initialDelay: 100, maxDelay: 200 },
  });

  try {
    await client.connect(`opc.tcp://${options.host}:${options.port}`);
    const session = await client.createSession(userIdentity(options));
    return new OpcUaSinumerikSession(client, session);
  } catch (error) {
    await client.disconnect().catch(() => undefined);
    throw error;
  }
};

class OpcUaSinumerikSession implements SinumerikSession {
  private subscription: ClientSubscription | null = null;

  constructor(private readonly client: OPCUAClient, private readonly session: ClientSession) {}

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
