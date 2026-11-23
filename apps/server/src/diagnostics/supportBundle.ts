import { statfs } from 'node:fs/promises';
import os from 'node:os';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import path from 'node:path';
import type { NotificationChannel, NotificationMessage } from '@local-chatter/shared';
import { isSecretKey, redactText } from '../logging/redact.js';
import type { ServerLog } from '../logging/ServerLog.js';
import type { ConnectionHealth } from '../logging/ConnectionLog.js';
import type { BaseMachineStatus } from '../types/index.js';
import type { UpdateService } from '../updates/UpdateService.js';
import { tarBytes, type TarEntry } from '../archive/tar.js';
import { webStreamOf } from '../archive/webStream.js';

/** The time limit for each health check of VictoriaMetrics and vmalert */
const HEALTH_TIMEOUT_MS = 2000;
/** A health reply is short. A longer one is cut. */
const HEALTH_REPLY_CHARACTERS = 200;
/** The newest notification messages in the bundle, without their text */
const BUNDLE_MESSAGES = 50;

/** What the support bundle reads. Each part is optional, so a part that fails does not stop the bundle. */
export interface BundleSources {
  version: string;
  serverLog: ServerLog;
  machines: () => BaseMachineStatus[];
  connections: { health(machineId: string): ConnectionHealth };
  updates: UpdateService;
  channels: () => NotificationChannel[];
  messages: () => NotificationMessage[];
  /** The health addresses of VictoriaMetrics and vmalert on the internal network "history" */
  historyHealthUrls: Record<string, string>;
  /** The folder of the database, for the free space */
  dataFolder: () => string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

/**
 * The support bundle: one .tar.gz file that an Admin sends to whoever helps, so nobody needs SSH to the Pi.
 * It has no password, token, secret, notification address or topic: the machine settings and channels lose each
 * secret field, and each line of the log has its secrets hidden already (logging/redact.ts).
 */
export async function supportBundle(sources: BundleSources): Promise<ReadableStream<Uint8Array>> {
  const now = sources.now?.() ?? new Date();
  const entries = await bundleEntries(sources, now);
  const gzip = Readable.from(tarBytes(entries, now)).pipe(createGzip());
  return webStreamOf(gzip);
}

async function bundleEntries(sources: BundleSources, now: Date): Promise<TarEntry[]> {
  const json = async (name: string, read: () => unknown) => ({ name, text: `${JSON.stringify(await orError(read), null, 2)}\n` });
  const { updates, serverLog } = sources;
  const helperLog = await updates.helperLog().catch(() => null);
  return [
    { name: 'README.txt', text: README },
    await json('system.json', () => systemFacts(sources, now)),
    await json('machines.json', () => machinesWithHealth(sources)),
    await json('notifications.json', () => notificationFacts(sources)),
    await json('history-health.json', () => historyHealth(sources)),
    await json('update/status.json', () => updates.status()),
    await json('update/helper.json', () => updates.helper()),
    await json('update/network.json', () => updates.network()),
    ...(helperLog === null ? [] : [{ name: 'update/helper.log', text: helperLog }]),
    { name: 'log/recent.log', text: serverLog.buffer.text() },
    ...serverLog.filePaths.map(filePath => ({ name: `log/${path.basename(filePath)}`, filePath })),
    ...(serverLog.audit?.filePaths ?? []).map(filePath => ({ name: `log/${path.basename(filePath)}`, filePath })),
  ];
}

const README = `Chatter support bundle

system.json           the version, the time since the start, the memory and the free space
machines.json         the settings and the status of each machine, and its last connection changes (no passwords)
notifications.json    the channels (no addresses, tokens or topics) and the status of the newest messages
history-health.json   the answers of VictoriaMetrics and vmalert
update/               the files of the update helper of the Pi card (if there is one)
log/                  the server log: the last lines in memory, and the log files (secrets are hidden)
log/audit.log         the audit log: each change, with the user, the route and the address, and each login try
`;

/** The value, or the reason why it could not be read */
async function orError(read: () => unknown): Promise<unknown> {
  try {
    return await read();
  } catch (error) {
    return { error: redactText(error instanceof Error ? error.message : String(error)) };
  }
}

async function systemFacts({ version, dataFolder }: BundleSources, now: Date) {
  const memory = process.memoryUsage();
  const disk = await statfs(dataFolder()).then(
    stats => ({ freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize }),
    error => ({ error: String((error as Error).message) }),
  );
  return {
    version,
    time: now.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
    computerUptimeSeconds: Math.round(os.uptime()),
    memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, totalBytes: os.totalmem(), freeBytes: os.freemem() },
    loadAverage: os.loadavg(),
    dataDisk: disk,
  };
}

function machinesWithHealth({ machines, connections }: BundleSources) {
  return machines().map(machine => ({ ...withoutSecrets(machine) as object, health: connections.health(machine.id) }));
}

/** The channels without their settings: a setting can be an address, a topic or a phone number */
function notificationFacts({ channels, messages }: BundleSources) {
  return {
    channels: channels().map(channel => ({
      id: channel.id,
      type: channel.type,
      name: channel.name,
      enabled: channel.enabled,
      minSeverity: channel.minSeverity,
      machineIds: channel.machineIds,
      ignorePatternCount: channel.ignorePatterns.length,
      savedSecrets: Object.keys(channel.hasSecret).filter(key => channel.hasSecret[key]),
      createdAt: channel.createdAt,
    })),
    newestMessages: messages().slice(0, BUNDLE_MESSAGES).map(message => ({
      channelId: message.channelId,
      kind: message.kind,
      status: message.status,
      attempts: message.attempts,
      lastError: message.lastError && redactText(message.lastError),
      createdAt: message.createdAt,
      sentAt: message.sentAt,
    })),
  };
}

async function historyHealth({ historyHealthUrls, fetch = globalThis.fetch }: BundleSources) {
  const results = await Promise.all(Object.entries(historyHealthUrls).map(async ([name, url]) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS), redirect: 'error' });
      const text = (await response.text()).slice(0, HEALTH_REPLY_CHARACTERS).trim();
      return [name, { url, status: response.status, reply: text }];
    } catch (error) {
      return [name, { url, error: error instanceof Error ? error.message : String(error) }];
    }
  }));
  return Object.fromEntries(results);
}

/** A copy with no secret field (a password, a token, a secret). A true/false field such as hasFtpPassword stays. */
function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (value === null || typeof value !== 'object') return typeof value === 'string' ? redactText(value) : value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => !isSecretKey(key) || typeof item === 'boolean')
    .map(([key, item]) => [key, withoutSecrets(item)]));
}
