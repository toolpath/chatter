/**
 * The contract between Chatter and the update helper on the Pi card.
 * Chatter writes one request text into the inbox. The helper (a root script outside Docker) writes
 * status.json and helper.json. Chatter only reads them. See Work item 8 in the plan.
 */

/** The only texts that the helper accepts in request.json. It compares the whole text. */
export const UPDATE_REQUESTS = ['check', 'install'] as const;
export type UpdateRequest = typeof UPDATE_REQUESTS[number];

/**
 * checking, installing: the helper works now.
 * ready: the update file passed the check, and an Admin can install it.
 * refused: the update file did not pass the check (the reason says why).
 * done: the new version runs.
 * failed: the old version runs, and nothing changed.
 * rolled-back: the new version did not start, so the helper put back the old version and its data.
 */
export const UPDATE_STATES = ['checking', 'ready', 'refused', 'installing', 'done', 'failed', 'rolled-back'] as const;
export type UpdateState = typeof UPDATE_STATES[number];

/** The helper works now, so Chatter refuses a new request */
export function isBusy(state: UpdateState): boolean {
  return state === 'checking' || state === 'installing';
}

/** The processor types that an update file can be for */
export const UPDATE_ARCHES = ['amd64', 'arm64', 'armv7'] as const;
export type UpdateArch = typeof UPDATE_ARCHES[number];

/** A release version, such as "1.2.0". Edge builds ("edge-<commit>") cannot update. */
export const RELEASE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;

/** The largest update file: 600 MiB, which is 629145600 bytes. The bash helper uses the same number. */
export const UPDATE_FILE_LIMIT_BYTES = 600 * 1024 * 1024;

/** A busy helper writes a new heartbeat this often */
export const HELPER_HEARTBEAT_MS = 30_000;

/** A busy helper with no heartbeat for this long has died, so it counts as failed */
export const HELPER_SILENCE_LIMIT_MS = 2 * 60_000;

/**
 * The contents of /opt/chatter/update/status.json.
 * The helper writes `version` only after the version passed the RELEASE_VERSION check.
 */
export interface UpdateStatus {
  state: UpdateState;
  /** The version of the update file, when the helper knows it */
  version?: string;
  /** Why the helper refused, failed, or rolled back. It never holds text from the update file. */
  reason?: string;
  /** UTC time, as `date -u +%Y-%m-%dT%H:%M:%SZ` writes it. The helper updates it while it works. */
  heartbeat: string;
  /** The free space on the card. The helper writes it in each status. */
  freeBytes: number;
  /** After done: the space that the clean up gave back */
  freedBytes?: number;
}

/**
 * The contents of /opt/chatter/update/helper.json. The helper writes it at each start of the Pi.
 * When the file is there, Chatter knows that it runs on a card with the helper.
 */
export interface HelperInfo {
  /** The processor type of the Pi, so Chatter downloads the right update file */
  arch: UpdateArch;
}

/** Reads status.json. Gives null if the text is not a status that the helper could write. */
export function parseUpdateStatus(text: string): UpdateStatus | null {
  const data = parseObject(text);
  if (!data) return null;
  const { state, version, reason, heartbeat, freeBytes, freedBytes } = data;
  if (!isOneOf(state, UPDATE_STATES) || !isTime(heartbeat) || !isByteCount(freeBytes)) return null;
  if (reason !== undefined && typeof reason !== 'string') return null;
  if (freedBytes !== undefined && !isByteCount(freedBytes)) return null;
  return {
    state,
    heartbeat,
    freeBytes,
    ...(isReleaseVersion(version) && { version }),
    ...(reason !== undefined && { reason }),
    ...(freedBytes !== undefined && { freedBytes }),
  };
}

/** Reads helper.json. Gives null if the text is not what the helper writes. */
export function parseHelperInfo(text: string): HelperInfo | null {
  const data = parseObject(text);
  if (!data) return null;
  const { arch } = data;
  return isOneOf(arch, UPDATE_ARCHES) ? { arch } : null;
}

/** The status to show: a busy helper that is silent for too long has died, so it counts as failed */
export function shownUpdateStatus(status: UpdateStatus, now: number): UpdateStatus {
  const silentMs = now - Date.parse(status.heartbeat);
  if (isBusy(status.state) && silentMs > HELPER_SILENCE_LIMIT_MS) {
    return { ...status, state: 'failed', reason: 'The update helper stopped. See the log: journalctl -u chatter-update' };
  }
  return status;
}

export function isReleaseVersion(value: unknown): value is string {
  return typeof value === 'string' && RELEASE_VERSION.test(value);
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const data: unknown = JSON.parse(text);
    return typeof data === 'object' && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isByteCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
