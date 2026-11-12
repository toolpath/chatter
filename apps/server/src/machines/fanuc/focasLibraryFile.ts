import path from 'path';
import { focasLibraryPath } from './focasLibraryPath.js';

/** A FOCAS2 library is much smaller than this */
export const MAX_LIBRARY_BYTES = 20 * 1024 * 1024;

/** What the first bytes of a library file say about it */
interface LibraryKind {
  os: 'Linux' | 'Windows';
  processor: string;
}

const UNKNOWN_PROCESSOR = 'an unknown processor';

/** ELF class (byte 4) and machine (bytes 18-19) of Linux libraries */
const ELF_PROCESSORS: Record<string, string> = {
  '1/40': '32-bit ARM',
  '2/62': '64-bit x86',
  '2/183': '64-bit ARM',
  '1/3': '32-bit x86',
};

/** Machine field of the PE header of Windows libraries */
const PE_PROCESSORS: Record<number, string> = {
  0x8664: '64-bit x86',
  0x14c: '32-bit x86',
  0xaa64: '64-bit ARM',
};

/** The library that each computer with a FANUC library needs */
const NEEDED_KINDS: Record<string, LibraryKind> = {
  'linux/x64': { os: 'Linux', processor: '64-bit x86' },
  'linux/arm': { os: 'Linux', processor: '32-bit ARM' },
  'win32/x64': { os: 'Windows', processor: '64-bit x86' },
};

/**
 * Why this file cannot be the FOCAS2 library of this computer, or null when it can.
 * It checks only the size and the first bytes: the operating system and the processor that the file is for.
 */
export function libraryFileProblem(file: Buffer, platform: NodeJS.Platform, arch: string): string | null {
  let fileName: string;
  try {
    fileName = path.basename(focasLibraryPath(platform, arch, ''));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (file.length === 0) return 'The file is empty.';
  if (file.length > MAX_LIBRARY_BYTES) return 'The file is too large for a FOCAS2 library.';

  const kind = libraryKindOf(file);
  if (!kind) return `This file is not a library. This computer needs ${fileName}.`;
  const needed = NEEDED_KINDS[`${platform}/${arch}`];
  if (kind.os === needed.os && kind.processor === needed.processor) return null;
  return `This is a ${kind.os} library for ${kind.processor}. This computer needs ${fileName}.`;
}

function libraryKindOf(file: Buffer): LibraryKind | null {
  return elfKindOf(file) ?? peKindOf(file);
}

function elfKindOf(file: Buffer): LibraryKind | null {
  const isElf = file.length >= 20 && file.readUInt32BE(0) === 0x7f454c46;
  if (!isElf) return null;
  const processor = ELF_PROCESSORS[`${file[4]}/${file.readUInt16LE(18)}`];
  return { os: 'Linux', processor: processor ?? UNKNOWN_PROCESSOR };
}

function peKindOf(file: Buffer): LibraryKind | null {
  const isMz = file.length >= 0x40 && file.toString('latin1', 0, 2) === 'MZ';
  if (!isMz) return null;
  const peStart = file.readUInt32LE(0x3c);
  const isPe = peStart + 6 <= file.length && file.toString('latin1', peStart, peStart + 4) === 'PE\0\0';
  if (!isPe) return null;
  const processor = PE_PROCESSORS[file.readUInt16LE(peStart + 4)];
  return { os: 'Windows', processor: processor ?? UNKNOWN_PROCESSOR };
}
