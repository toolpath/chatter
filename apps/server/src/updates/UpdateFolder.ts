import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import {
  parseHelperInfo,
  parseUpdateStatus,
  shownUpdateStatus,
  type HelperInfo,
  type UpdateRequest,
  type UpdateStatus,
} from '@local-chatter/shared';

/** Where the Pi card mounts the update folder in the Chatter container */
export const DEFAULT_UPDATE_FOLDER = '/app/update';
/** The helper moves these two out of the inbox. Chatter never deletes them. */
export const UPDATE_FILE_NAME = 'chatter-update.tar';
export const REQUEST_FILE_NAME = 'request.json';

/** The helper writes these two next to the inbox */
const HELPER_INFO_FILE_NAME = 'helper.json';
const STATUS_FILE_NAME = 'status.json';
const INBOX_FOLDER_NAME = 'inbox';

/** Names that Chatter writes first, and renames when they are whole. The helper never reads them. */
const PARTIAL_PREFIX = '.partial-';
const REQUEST_PREFIX = '.request-';
const HIDDEN_NAME_RANDOM_BYTES = 8;

/** Open a file only when it is not there yet, so a write never replaces a file */
const CREATE_NEW_FILE_ONLY = 'wx';

/**
 * The folder that Chatter shares with the update helper on the Pi card.
 * The helper (root, outside Docker) writes status.json and helper.json. Chatter can only read them.
 * Chatter writes the update file and the request into inbox/. On a normal computer the folder is missing.
 */
export class UpdateFolder {
  readonly inbox: string;

  constructor(private readonly folder: string, private readonly now: () => number = Date.now) {
    this.inbox = path.join(folder, INBOX_FOLDER_NAME);
  }

  /** The folder in CHATTER_UPDATE_FOLDER, or the folder that the Pi card mounts */
  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): UpdateFolder {
    return new UpdateFolder(environment.CHATTER_UPDATE_FOLDER?.trim() || DEFAULT_UPDATE_FOLDER);
  }

  /** What the helper wrote about this Pi, or null when there is no helper (a normal computer) */
  async helper(): Promise<HelperInfo | null> {
    const text = await this.readHelperFile(HELPER_INFO_FILE_NAME);
    if (text === null || !(await isFolder(this.inbox))) return null;
    return parseHelperInfo(text);
  }

  /** The status of the last check or install, or null before the first one */
  async status(): Promise<UpdateStatus | null> {
    const text = await this.readHelperFile(STATUS_FILE_NAME);
    const status = text === null ? null : parseUpdateStatus(text);
    return status && shownUpdateStatus(status, this.now());
  }

  /** Ask the helper to check or install. The helper sees the request only when it is whole. */
  async writeRequest(request: UpdateRequest): Promise<void> {
    const temporaryFile = this.hiddenName(REQUEST_PREFIX);
    try {
      await fs.writeFile(temporaryFile, request, { flag: CREATE_NEW_FILE_ONLY });
      await fs.rename(temporaryFile, path.join(this.inbox, REQUEST_FILE_NAME));
    } catch (error) {
      await this.discard(temporaryFile);
      throw error;
    }
  }

  /** A new hidden name in the inbox, for an update file that is not whole yet */
  newPartialFile(): string {
    return this.hiddenName(PARTIAL_PREFIX);
  }

  /** The whole file came: give it the name that the helper looks for */
  async keepFile(partialFile: string): Promise<void> {
    await fs.rename(partialFile, path.join(this.inbox, UPDATE_FILE_NAME));
  }

  /** A whole update file waits in the inbox for a check */
  async hasUpdateFile(): Promise<boolean> {
    return this.isInInbox(UPDATE_FILE_NAME);
  }

  /** A request waits for the helper. The helper moves it out of the inbox first, when it starts. */
  async hasRequest(): Promise<boolean> {
    return this.isInInbox(REQUEST_FILE_NAME);
  }

  /** Delete a hidden file that is not whole: a half update file, or a request that was not renamed */
  async discard(hiddenFile: string): Promise<void> {
    await fs.rm(hiddenFile, { force: true });
  }

  /** Delete the half files and temporary requests that a stop or a crash left in the inbox */
  async removeLeftovers(): Promise<void> {
    // A normal computer has no inbox, so there is nothing to delete
    const names = await fs.readdir(this.inbox).catch(() => [] as string[]);
    const leftovers = names.filter(isHiddenName);
    await Promise.all(leftovers.map(name => this.discard(path.join(this.inbox, name))));
  }

  /** The free space where the update file goes */
  async freeBytes(): Promise<number> {
    const stats = await fs.statfs(this.inbox);
    return stats.bavail * stats.bsize;
  }

  /** True for a file, not a folder or a link, with this name in the inbox */
  private async isInInbox(name: string): Promise<boolean> {
    return fs.lstat(path.join(this.inbox, name)).then(stats => stats.isFile(), () => false);
  }

  private hiddenName(prefix: string): string {
    return path.join(this.inbox, prefix + randomBytes(HIDDEN_NAME_RANDOM_BYTES).toString('hex'));
  }

  /** The text of a file that the helper wrote, or null when it is not there */
  private async readHelperFile(name: string): Promise<string | null> {
    return fs.readFile(path.join(this.folder, name), 'utf8').catch(() => null);
  }
}

/** A name that Chatter writes first: a half update file, or a request that is not renamed yet */
function isHiddenName(name: string): boolean {
  return name.startsWith(PARTIAL_PREFIX) || name.startsWith(REQUEST_PREFIX);
}

async function isFolder(folder: string): Promise<boolean> {
  return fs.stat(folder).then(stats => stats.isDirectory(), () => false);
}
