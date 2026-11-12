import { isReleaseVersion } from '@local-chatter/shared';
import type { SettingsTable } from '../storage/settingsTable.js';
import { UPDATE_IDLE_LIMIT_MS, UPDATE_TIME_LIMIT_MS, wholeSeconds } from './timeLimits.js';

/** Where the Chatter releases are. A fork can set CHATTER_RELEASES_REPO. */
export const DEFAULT_RELEASES_REPO = 'toolpath/chatter';
const REPO_NAME_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_API = 'https://api.github.com';
const DAY_MS = 24 * 60 * 60 * 1000;
/** A check with no internet must not wait for long */
const CHECK_TIMEOUT_MS = 15_000;
/** GitHub refuses a request with no User-Agent */
const GITHUB_USER_AGENT = 'Chatter';
const RELEASE_JSON = 'application/vnd.github+json';
const RELEASE_FILE = 'application/octet-stream';
/** github.com sends a release file on to its file storage with one redirect */
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NOT_FOUND = 404;
const NO_INTERNET_MESSAGE = 'Could not check: no internet';

/** Where the "Check for updates on GitHub" switch is saved, as "on" or "off" */
export interface CheckSettingStore {
  read(): string | undefined;
  write(value: string): void;
}

const SETTING_KEY = 'update_check_github';
const CHECK_ON = 'on';
const CHECK_OFF = 'off';

export function sqliteCheckSettingStore(settings: SettingsTable): CheckSettingStore {
  return {
    read: () => settings.get(SETTING_KEY),
    write: value => settings.set({ [SETTING_KEY]: value }),
  };
}

/** The switch, kept only until Chatter stops. For tests, and for an app with no database. */
export function memoryCheckSettingStore(): CheckSettingStore {
  let saved: string | undefined;
  return {
    read: () => saved,
    write: value => void (saved = value),
  };
}

/** A file of a GitHub release */
export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
}

/** What Settings > Updates shows about the newest release on GitHub */
export interface NewestRelease {
  checkGitHub: boolean;
  /** From the last good check. Null before the first good check, or when the check is off. */
  version: string | null;
  /** Why the last check failed, or null when it worked */
  error: string | null;
  /** When the last check ended (ISO time) */
  checkedAt: string | null;
}

interface Release {
  version: string;
  assets: ReleaseAsset[];
}

interface CheckResult {
  version: string | null;
  assets: ReleaseAsset[];
  error: string | null;
  checkedAt: string;
}

/** The repo in CHATTER_RELEASES_REPO, or the Chatter repo. A bad name stops the start. */
export function releasesRepo(environment: NodeJS.ProcessEnv = process.env): string {
  const repo = environment.CHATTER_RELEASES_REPO?.trim() || DEFAULT_RELEASES_REPO;
  if (!REPO_NAME_PATTERN.test(repo)) throw new Error(`CHATTER_RELEASES_REPO must look like owner/repo, not "${repo}"`);
  return repo;
}

/** True when candidate is a higher release version than current. Compares the numbers part by part. */
export function isNewerVersion(candidate: string, current: string): boolean {
  if (!isReleaseVersion(candidate) || !isReleaseVersion(current)) return false;
  const [candidateParts, currentParts] = [candidate, current].map(version => version.split('.').map(Number));
  const firstDifference = candidateParts.findIndex((part, index) => part !== currentParts[index]);
  return firstDifference >= 0 && candidateParts[firstDifference] > currentParts[firstDifference];
}

/**
 * True for an https address on github.com or on the GitHub file storage (*.githubusercontent.com).
 * The helper checks the signature of the file, but Chatter must not download a large file from just any address.
 */
function isGitHubAddress(address: string): boolean {
  const url = URL.parse(address);
  if (url?.protocol !== 'https:') return false;
  return url.hostname === 'github.com' || url.hostname.endsWith('.githubusercontent.com');
}

/** A failed check. The message is what the Admin sees. */
class CheckError extends Error {}

interface ReleaseWatcherOptions {
  repo: string;
  store: CheckSettingStore;
  fetch?: typeof globalThis.fetch;
  /** The longest wait for each reply to a download, before its body comes */
  idleMs?: number;
}

/**
 * Asks GitHub once a day for the newest Chatter release, while the Admin has the check on (the default).
 * Release files come only from GitHub addresses. The update helper still checks the signature of each file.
 */
export class ReleaseWatcher {
  private readonly fetch: typeof globalThis.fetch;
  private lastCheck: CheckResult | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: ReleaseWatcherOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  get checkGitHub(): boolean {
    return this.options.store.read() !== CHECK_OFF;
  }

  /** Turn the check on or off, and save it. Turning it on checks at once. */
  async setCheckGitHub(isOn: boolean): Promise<void> {
    this.options.store.write(isOn ? CHECK_ON : CHECK_OFF);
    if (isOn) await this.checkNow();
    else this.lastCheck = null;
  }

  /** Check now, and then once a day */
  start(): void {
    void this.checkNow();
    this.timer = setInterval(() => void this.checkNow(), DAY_MS);
    // The timer must not keep Node running at the end
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Ask GitHub for the newest release. Does nothing while the check is off. Never throws.
   * A failed check keeps the release of the last good check, so a short break in the internet does not stop a download.
   */
  async checkNow(): Promise<void> {
    if (!this.checkGitHub) return;
    try {
      const { version, assets } = await this.latestRelease();
      this.lastCheck = { version, assets, error: null, checkedAt: nowAsIsoTime() };
    } catch (error) {
      this.lastCheck = {
        version: this.lastCheck?.version ?? null,
        assets: this.lastCheck?.assets ?? [],
        error: error instanceof CheckError ? error.message : NO_INTERNET_MESSAGE,
        checkedAt: nowAsIsoTime(),
      };
    }
  }

  newest(): NewestRelease {
    const shownCheck = this.checkGitHub ? this.lastCheck : null;
    return {
      checkGitHub: this.checkGitHub,
      version: shownCheck?.version ?? null,
      error: shownCheck?.error ?? null,
      checkedAt: shownCheck?.checkedAt ?? null,
    };
  }

  /** A file of the newest release, found by its name */
  assetNamed(name: string): ReleaseAsset | undefined {
    return this.lastCheck?.assets.find(asset => asset.name === name);
  }

  /**
   * Start the download of a release file. Gives its body as a stream.
   * Follows each redirect only to another GitHub address.
   */
  async openAsset(asset: ReleaseAsset): Promise<ReadableStream<Uint8Array>> {
    // A connection that hangs must not block the next upload or download for ever
    const totalSignal = AbortSignal.timeout(UPDATE_TIME_LIMIT_MS);
    let address = asset.url;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const reply = await this.fetchFromGitHub(address, totalSignal);
      const location = reply.headers.get('Location');
      if (!REDIRECT_STATUSES.has(reply.status) || location === null) return bodyOf(reply);
      await reply.body?.cancel();
      address = new URL(location, address).href;
    }
    throw new Error(`GitHub sent too many redirects for ${asset.name}`);
  }

  /**
   * One step of a download. A reply that does not come within the idle time stops it.
   * The idle timer stops when the reply comes: from then on, the idle limit of the stream counts.
   */
  private async fetchFromGitHub(address: string, totalSignal: AbortSignal): Promise<Response> {
    if (!isGitHubAddress(address)) throw new Error(`the address ${URL.parse(address)?.hostname ?? address} is not GitHub`);
    const idleMs = this.options.idleMs ?? UPDATE_IDLE_LIMIT_MS;
    const noReply = new AbortController();
    const noReplyTimer = setTimeout(() => noReply.abort(new Error(`GitHub sent no reply for ${wholeSeconds(idleMs)} seconds`)), idleMs);
    try {
      return await this.fetch(address, {
        headers: githubHeaders(RELEASE_FILE),
        redirect: 'manual',
        signal: AbortSignal.any([totalSignal, noReply.signal]),
      });
    } finally {
      clearTimeout(noReplyTimer);
    }
  }

  private async latestRelease(): Promise<Release> {
    const { repo } = this.options;
    const reply = await this.fetch(`${GITHUB_API}/repos/${repo}/releases/latest`, {
      headers: githubHeaders(RELEASE_JSON),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (reply.status === NOT_FOUND) throw new CheckError(`Could not check: GitHub has no release of ${repo} (HTTP 404)`);
    if (!reply.ok) throw new CheckError(`Could not check: GitHub replied with HTTP ${reply.status}`);
    return parseRelease(await reply.json().catch(() => null));
  }
}

function nowAsIsoTime(): string {
  return new Date().toISOString();
}

function githubHeaders(accept: string): Record<string, string> {
  return { Accept: accept, 'User-Agent': GITHUB_USER_AGENT };
}

/** The version and the files of a GitHub release. The tag "v1.2.0" is the version "1.2.0". */
function parseRelease(json: unknown): Release {
  const release = (json ?? {}) as { tag_name?: unknown; assets?: unknown };
  const version = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : null;
  if (!isReleaseVersion(version)) throw new CheckError('Could not check: the newest release has no version number');
  const assets = Array.isArray(release.assets) ? release.assets.flatMap(parseAsset) : [];
  return { version, assets };
}

/** One release file, or none when it is not whole or not on GitHub */
function parseAsset(json: unknown): ReleaseAsset[] {
  const { name, size, browser_download_url: url } = (json ?? {}) as Record<string, unknown>;
  const isAsset = typeof name === 'string' && Number.isSafeInteger(size) && typeof url === 'string' && isGitHubAddress(url);
  return isAsset ? [{ name, size: size as number, url }] : [];
}

/** The body of a release file, or why GitHub did not give it */
function bodyOf(reply: Response): ReadableStream<Uint8Array> {
  if (!reply.ok || !reply.body) throw new Error(`GitHub replied with HTTP ${reply.status}`);
  return reply.body;
}
