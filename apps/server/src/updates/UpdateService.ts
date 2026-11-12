import {
  isBusy,
  isReleaseVersion,
  UPDATE_FILE_LIMIT_BYTES,
  type HelperInfo,
  type UpdateArch,
  type UpdateRequest,
  type UpdateStatus,
} from '@local-chatter/shared';
import { errorMessage } from '../routes/responses.js';
import { isNewerVersion, type NewestRelease, type ReleaseAsset, type ReleaseWatcher } from './ReleaseWatcher.js';
import { FileTooLargeError, StreamIdleError, streamToFile } from './streamToFile.js';
import { UPDATE_IDLE_LIMIT_MS } from './timeLimits.js';
import type { UpdateFolder } from './UpdateFolder.js';
import { createLogger } from '../logging/logger.js';

const log = createLogger('updates');

/** What Settings > Updates shows */
export interface UpdatesReport {
  /** The version of this Chatter */
  version: string;
  /** Only a release version can update from the web app. "edge-<commit>" and "development" cannot. */
  canUpdate: boolean;
  /** Null on a normal computer: there, the Admin updates with docker compose */
  helper: HelperInfo | null;
  /** The last check or install, or null before the first one */
  status: UpdateStatus | null;
  /** The free space where the update file goes, or null with no helper */
  freeBytes: number | null;
  /** An update file is coming in now (an upload or a download) */
  isReceiving: boolean;
  /** A whole update file waits in the inbox for a check */
  hasUpdateFile: boolean;
  /** A check or install request waits for the helper to start */
  isRequestPending: boolean;
  /** The newest release on GitHub, and whether it is newer than this Chatter */
  newest: NewestRelease & { isNewer: boolean };
  /** Why the last download failed, until the next download starts */
  downloadError: string | null;
}

const REQUEST_TIMEOUT = 408;
const CONFLICT = 409;
const PAYLOAD_TOO_LARGE = 413;
const INSUFFICIENT_STORAGE = 507;

/** Chatter cannot do this now. The status is the HTTP status of the reply. */
export class UpdateRefusedError extends Error {
  constructor(message: string, readonly status: 408 | 409 | 413 | 507) {
    super(message);
  }
}

const MEGABYTE = 1024 * 1024;

const NO_HELPER_MESSAGE =
  'This computer has no update helper. Update Chatter with "docker compose pull", then "docker compose up -d".';
const DEVELOPMENT_BUILD_MESSAGE = 'Development build: it cannot update from here.';
const RECEIVING_MESSAGE = 'An update file is coming in now. Wait until it is done.';
const PENDING_REQUEST_MESSAGE = 'A request already waits for the update helper. Wait until it starts.';
const BUSY_MESSAGE = 'The update helper is busy now. Wait until it is done.';
const NO_FILE_TO_CHECK_MESSAGE = 'Upload or download an update file first.';
const NOT_CHECKED_MESSAGE = 'Check an update file first.';
const NEW_FILE_NOT_CHECKED_MESSAGE = 'A new update file is here. Check it before you install it.';
const NO_NEWER_VERSION_MESSAGE = 'No newer version is on GitHub.';
export const LIMIT_MESSAGE = `The update file must be at most ${UPDATE_FILE_LIMIT_BYTES / MEGABYTE} MB.`;

/**
 * The free space that an update must leave on the card. The helper unpacks the update file next to it,
 * so an update needs two times the file, and this much more, so Chatter and the machine data still have room.
 */
const SPARE_BYTES = 200 * MEGABYTE;
const neededBytes = (fileBytes: number) => 2 * fileBytes + SPARE_BYTES;
// The need rounds up and the free space rounds down, so the message never says "needs 201 MB, and the card has 201 MB"
const megabytesUp = (bytes: number) => `${Math.ceil(bytes / MEGABYTE)} MB`;
const megabytesDown = (bytes: number) => `${Math.floor(bytes / MEGABYTE)} MB`;

/** The name of the update file in a release, as the release job makes it */
const updateFileName = (version: string, arch: UpdateArch) => `chatter-update-${version}-${arch}.tar`;

/**
 * Updates of Chatter on the Pi card. Chatter only puts the update file and a request in the inbox.
 * The update helper (root, outside Docker) checks the file and installs it.
 */
export class UpdateService {
  private isReceiving = false;
  private downloadError: string | null = null;

  constructor(
    private readonly folder: UpdateFolder,
    private readonly version: string,
    private readonly releases: ReleaseWatcher,
    private readonly idleMs = UPDATE_IDLE_LIMIT_MS,
  ) {}

  async report(): Promise<UpdatesReport> {
    const helper = await this.folder.helper();
    const newest = this.releases.newest();
    return {
      version: this.version,
      canUpdate: isReleaseVersion(this.version),
      helper,
      status: await this.folder.status(),
      freeBytes: helper && (await this.folder.freeBytes()),
      isReceiving: this.isReceiving,
      hasUpdateFile: await this.folder.hasUpdateFile(),
      isRequestPending: await this.folder.hasRequest(),
      newest: { ...newest, isNewer: newest.version !== null && isNewerVersion(newest.version, this.version) },
      downloadError: this.downloadError,
    };
  }

  /**
   * Save an update file from a stream, piece by piece, under a hidden name.
   * Only the whole file gets the name that the helper looks for. A stopped stream leaves nothing.
   * One file at a time. sizeBytes is the size that the sender gave.
   */
  async receiveFile(body: ReadableStream<Uint8Array>, sizeBytes: number, username: string): Promise<UpdatesReport> {
    await this.whileReceiving(async () => {
      await this.requireHelper();
      await this.requireIdleHelper();
      await this.requireSpace(sizeBytes);
      await this.saveFile(body);
      log.info('Update file added', { user: username, sizeBytes });
    });
    return this.report();
  }

  /**
   * Start to download the update file of the newest release into the inbox, the same way as an upload.
   * The reply comes at once. The report shows when the download ends, or why it failed.
   */
  async download(username: string): Promise<UpdatesReport> {
    const helper = await this.requireHelper();
    await this.requireIdleHelper();
    const asset = this.newestAsset(helper.arch);
    await this.requireSpace(asset.size);
    void this.whileReceiving(() => this.downloadInBackground(asset, username));
    return this.report();
  }

  /** Turn the daily check on GitHub on or off */
  async setCheckGitHub(isOn: boolean): Promise<UpdatesReport> {
    await this.releases.setCheckGitHub(isOn);
    return this.report();
  }

  /**
   * Ask the helper to check the update file, or to install the file that passed the check.
   * The helper has its own guards. These checks only give the Admin a clear reason at once.
   */
  async request(request: UpdateRequest, username: string): Promise<UpdatesReport> {
    await this.requireHelper();
    this.refuseWhileReceiving();
    if (await this.folder.hasRequest()) throw new UpdateRefusedError(PENDING_REQUEST_MESSAGE, CONFLICT);
    const status = await this.requireIdleHelper();
    if (request === 'check') await this.requireFileToCheck();
    else await this.requireCheckedFile(status);
    await this.folder.writeRequest(request);
    log.info('Update helper asked', { user: username, request });
    return this.report();
  }

  /** Refuses while the helper checks or installs. Gives the status. */
  private async requireIdleHelper(): Promise<UpdateStatus | null> {
    const status = await this.folder.status();
    if (status && isBusy(status.state)) throw new UpdateRefusedError(BUSY_MESSAGE, CONFLICT);
    return status;
  }

  private async requireFileToCheck(): Promise<void> {
    if (!(await this.folder.hasUpdateFile())) throw new UpdateRefusedError(NO_FILE_TO_CHECK_MESSAGE, CONFLICT);
  }

  /** The helper installs the file that passed the check. A new file in the inbox must have its own check first. */
  private async requireCheckedFile(status: UpdateStatus | null): Promise<void> {
    if (status?.state !== 'ready') throw new UpdateRefusedError(NOT_CHECKED_MESSAGE, CONFLICT);
    if (await this.folder.hasUpdateFile()) throw new UpdateRefusedError(NEW_FILE_NOT_CHECKED_MESSAGE, CONFLICT);
  }

  /**
   * Throws at once (not in a promise), so that download() fails at once too,
   * and does not leave a rejected promise that nobody waits for.
   */
  private refuseWhileReceiving(): void {
    if (this.isReceiving) throw new UpdateRefusedError(RECEIVING_MESSAGE, CONFLICT);
  }

  /**
   * One upload or download at a time. Takes the place at once, or throws when it is taken.
   * Runs the work, and frees the place when the work ends, also when it fails.
   */
  private whileReceiving(work: () => Promise<void>): Promise<void> {
    this.refuseWhileReceiving();
    this.isReceiving = true;
    return Promise.resolve().then(work).finally(() => {
      this.isReceiving = false;
    });
  }

  /** The update file of the newest release for this processor */
  private newestAsset(arch: UpdateArch): ReleaseAsset {
    const { version } = this.releases.newest();
    if (version === null || !isNewerVersion(version, this.version)) throw new UpdateRefusedError(NO_NEWER_VERSION_MESSAGE, CONFLICT);
    const asset = this.releases.assetNamed(updateFileName(version, arch));
    if (!asset) throw new UpdateRefusedError(`The release ${version} has no update file for ${arch} processors.`, CONFLICT);
    if (asset.size > UPDATE_FILE_LIMIT_BYTES) throw new UpdateRefusedError(LIMIT_MESSAGE, PAYLOAD_TOO_LARGE);
    return asset;
  }

  /** Never throws: the report shows why the download failed */
  private async downloadInBackground(asset: ReleaseAsset, username: string): Promise<void> {
    this.downloadError = null;
    try {
      await this.saveFile(await this.releases.openAsset(asset));
      log.info('Update downloaded', { user: username, file: asset.name });
    } catch (error) {
      this.downloadError = `The download failed: ${errorMessage(error)}`;
      log.error('Update download failed', { file: asset.name, error });
    }
  }

  private async saveFile(body: ReadableStream<Uint8Array>): Promise<void> {
    const partialFile = this.folder.newPartialFile();
    try {
      await streamToFile(body, partialFile, { maxBytes: UPDATE_FILE_LIMIT_BYTES, idleMs: this.idleMs });
      await this.folder.keepFile(partialFile);
    } catch (error) {
      await this.folder.discard(partialFile);
      throw asRefusal(error);
    }
  }

  /** Refuses when this Chatter cannot update from the web app. Gives what the helper wrote about this Pi. */
  private async requireHelper(): Promise<HelperInfo> {
    const helper = await this.folder.helper();
    if (!helper) throw new UpdateRefusedError(NO_HELPER_MESSAGE, CONFLICT);
    if (!isReleaseVersion(this.version)) throw new UpdateRefusedError(DEVELOPMENT_BUILD_MESSAGE, CONFLICT);
    return helper;
  }

  /** Refuses when the card has no room to unpack the update file and keep some space free */
  private async requireSpace(fileBytes: number): Promise<void> {
    const freeBytes = await this.folder.freeBytes();
    const needed = neededBytes(fileBytes);
    if (freeBytes < needed) {
      throw new UpdateRefusedError(
        `Not enough free space: the update needs ${megabytesUp(needed)} (two times the file, and ${megabytesUp(SPARE_BYTES)} to spare), ` +
          `and the card has ${megabytesDown(freeBytes)}.`,
        INSUFFICIENT_STORAGE,
      );
    }
  }
}

/** A stream that was too large or went quiet is a clear refusal. Any other error stays as it is. */
function asRefusal(error: unknown): unknown {
  if (error instanceof FileTooLargeError) return new UpdateRefusedError(LIMIT_MESSAGE, PAYLOAD_TOO_LARGE);
  if (error instanceof StreamIdleError) return new UpdateRefusedError(`The update file stopped coming in: ${error.message}.`, REQUEST_TIMEOUT);
  return error;
}
