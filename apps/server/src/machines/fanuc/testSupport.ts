import { existsSync } from 'fs';
import path from 'path';
import type { FocasLoader } from './focasLibraryInstaller.js';

/** The FOCAS file that 64-bit Intel or AMD Linux needs */
export const X64_LIBRARY_NAME = 'libfwlib32-linux-x64.so.1.0.5';

/** The first bytes of a 64-bit x86 Linux library */
export function x64Library(): Buffer {
  const file = Buffer.alloc(64);
  file.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0);
  file.writeUInt16LE(0x3e, 18);
  return file;
}

/** Acts like FocasThread for 64-bit Intel or AMD Linux, on files in a folder */
export class FakeFocasLoader implements FocasLoader {
  loaded = false;
  loadError: Error | null = null;

  constructor(readonly uploaded: string, readonly bundled: string) {}

  static inFolder(folder: string): FakeFocasLoader {
    return new FakeFocasLoader(path.join(folder, 'data', X64_LIBRARY_NAME), path.join(folder, 'bundled', X64_LIBRARY_NAME));
  }

  uploadPath(): string {
    return this.uploaded;
  }

  libraryPath(): string {
    return existsSync(this.uploaded) ? this.uploaded : this.bundled;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  async initialize(): Promise<void> {
    if (this.loadError) throw this.loadError;
    this.loaded = true;
  }
}
