import { createHash, randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { libraryFileProblem } from './focasLibraryFile.js';
import { createLogger } from '../../logging/logger.js';

const log = createLogger('fanuc');

/** The parts of the FOCAS library loader (FocasThread) that the installer uses */
export interface FocasLoader {
  /** Where an uploaded file goes. Throws when FANUC makes no library for this computer. */
  uploadPath(): string;
  /** The file that Chatter uses: the uploaded one when it exists */
  libraryPath(): string;
  isLoaded(): boolean;
  /** Rejects when the file does not load */
  initialize(): Promise<void>;
}

export interface FocasLibraryStatus {
  /** The name of the FOCAS file that this computer needs, or null when FANUC makes none for it */
  fileName: string | null;
  /** Why this computer cannot read FANUC machines, or null */
  problem: string | null;
  /** Where the file that Chatter uses comes from, or null when there is no file */
  source: 'uploaded' | 'bundled' | null;
  /** The SHA-256 fingerprint of the file that Chatter uses */
  sha256: string | null;
  /** True when Chatter must restart to use a replaced or removed file */
  restartNeeded: boolean;
}

/** The uploaded file cannot be the FOCAS library of this computer */
export class LibraryFileError extends Error {}

/**
 * Saves the FOCAS2 library that an admin uploads, in the data folder, and loads it at once.
 * A library that is in memory cannot be swapped safely, so replacing or removing it takes effect after a restart.
 */
export class FocasLibraryInstaller {
  private restartNeeded = false;

  constructor(
    private readonly loader: FocasLoader,
    /** Runs when an uploaded file is loaded, so the saved FANUC machines can start */
    private readonly onLoaded: () => void,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly arch: string = process.arch,
  ) {}

  async status(): Promise<FocasLibraryStatus> {
    let uploadPath: string;
    try {
      uploadPath = this.loader.uploadPath();
    } catch (error) {
      return { fileName: null, problem: messageOf(error), source: null, sha256: null, restartNeeded: false };
    }
    const libraryPath = this.loader.libraryPath();
    const sha256 = await sha256OfFile(libraryPath);
    return {
      fileName: path.basename(uploadPath),
      problem: null,
      source: sha256 === null ? null : libraryPath === uploadPath ? 'uploaded' : 'bundled',
      sha256,
      restartNeeded: this.restartNeeded,
    };
  }

  /** Throws LibraryFileError when the file is wrong for this computer, or when it does not load */
  async install(file: Buffer): Promise<FocasLibraryStatus> {
    const problem = libraryFileProblem(file, this.platform, this.arch);
    if (problem) throw new LibraryFileError(problem);

    const target = this.loader.uploadPath();
    if (this.loader.isLoaded()) {
      await writeInPlaceOf(target, file);
      this.restartNeeded = true;
    } else {
      await this.saveAndLoad(target, file);
    }
    log.info('FANUC FOCAS library uploaded', { path: target, sha256: sha256Of(file) });
    return this.status();
  }

  async remove(): Promise<FocasLibraryStatus> {
    const uploadPath = this.loader.uploadPath();
    const wasInUse = this.loader.isLoaded() && this.loader.libraryPath() === uploadPath;
    await fs.rm(uploadPath, { force: true });
    if (wasInUse) this.restartNeeded = true;
    return this.status();
  }

  /** When the new file does not load, delete it and put back the file that was there before */
  private async saveAndLoad(target: string, file: Buffer): Promise<void> {
    const previous = `${target}.previous`;
    const hadPrevious = await moveIfThere(target, previous);
    await writeInPlaceOf(target, file);
    try {
      await this.loader.initialize();
    } catch (error) {
      await fs.rm(target, { force: true });
      if (hadPrevious) await fs.rename(previous, target);
      throw new LibraryFileError(`Chatter cannot load this file. ${messageOf(error)}`);
    }
    await fs.rm(previous, { force: true });
    this.startMachines();
  }

  /** The library is loaded, so a machine that cannot start must not fail the upload */
  private startMachines(): void {
    try {
      this.onLoaded();
    } catch (error) {
      log.error('Could not start the FANUC machines', { error });
    }
  }
}

/** Write to a temporary file first, so a failed write never leaves half a library */
async function writeInPlaceOf(target: string, file: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.uploading`;
  await fs.writeFile(temporary, file);
  await fs.rename(temporary, target);
}

/** Returns false when there is no file to move */
async function moveIfThere(from: string, to: string): Promise<boolean> {
  try {
    await fs.rename(from, to);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function sha256OfFile(file: string): Promise<string | null> {
  try {
    return sha256Of(await fs.readFile(file));
  } catch {
    return null;
  }
}

function sha256Of(file: Buffer): string {
  return createHash('sha256').update(file).digest('hex');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
