import { describe, expect, it } from 'vitest';
import { MAX_LIBRARY_BYTES, libraryFileProblem } from './focasLibraryFile.js';

const ELF_CLASS_32 = 1;
const ELF_CLASS_64 = 2;
const MACHINE_X86_64 = 0x3e;
const MACHINE_ARM = 0x28;
const MACHINE_AARCH64 = 0xb7;

/** The first bytes of a Linux library (an ELF file) */
function elf(elfClass: number, machine: number): Buffer {
  const file = Buffer.alloc(64);
  file.set([0x7f, 0x45, 0x4c, 0x46, elfClass, 1], 0);
  file.writeUInt16LE(machine, 18);
  return file;
}

/** The first bytes of a Windows library (a PE file) */
function pe(machine: number): Buffer {
  const peStart = 0x80;
  const file = Buffer.alloc(peStart + 24);
  file.write('MZ', 0, 'latin1');
  file.writeUInt32LE(peStart, 0x3c);
  file.write('PE\0\0', peStart, 'latin1');
  file.writeUInt16LE(machine, peStart + 4);
  return file;
}

describe('libraryFileProblem', () => {
  it('accepts a 64-bit x86 Linux library on 64-bit Intel or AMD Linux', () => {
    expect(libraryFileProblem(elf(ELF_CLASS_64, MACHINE_X86_64), 'linux', 'x64')).toBeNull();
  });

  it('accepts a 32-bit ARM Linux library on 32-bit ARM Linux', () => {
    expect(libraryFileProblem(elf(ELF_CLASS_32, MACHINE_ARM), 'linux', 'arm')).toBeNull();
  });

  it('accepts a 64-bit Windows library on 64-bit Windows', () => {
    expect(libraryFileProblem(pe(0x8664), 'win32', 'x64')).toBeNull();
  });

  it('refuses a 32-bit ARM library on 64-bit Intel or AMD Linux, and names the file to use', () => {
    expect(libraryFileProblem(elf(ELF_CLASS_32, MACHINE_ARM), 'linux', 'x64'))
      .toMatch(/32-bit ARM.*libfwlib32-linux-x64\.so\.1\.0\.5/);
  });

  it('refuses a 64-bit ARM library on 32-bit ARM Linux', () => {
    expect(libraryFileProblem(elf(ELF_CLASS_64, MACHINE_AARCH64), 'linux', 'arm'))
      .toMatch(/64-bit ARM.*libfwlib32-linux-armv7\.so\.1\.0\.5/);
  });

  it('refuses a Windows library on Linux', () => {
    expect(libraryFileProblem(pe(0x8664), 'linux', 'x64')).toMatch(/Windows/);
  });

  it('refuses a Linux library on Windows', () => {
    expect(libraryFileProblem(elf(ELF_CLASS_64, MACHINE_X86_64), 'win32', 'x64')).toMatch(/Linux/);
  });

  it('refuses a file that is not a library', () => {
    expect(libraryFileProblem(Buffer.from('O1000 (A PROGRAM)'), 'linux', 'x64')).toMatch(/not a library/);
  });

  it('refuses an empty file', () => {
    expect(libraryFileProblem(Buffer.alloc(0), 'linux', 'x64')).toMatch(/empty/);
  });

  it('refuses a file that is too large', () => {
    const file = Buffer.alloc(MAX_LIBRARY_BYTES + 1);
    elf(ELF_CLASS_64, MACHINE_X86_64).copy(file);
    expect(libraryFileProblem(file, 'linux', 'x64')).toMatch(/too large/);
  });

  it('refuses every file on a computer that FANUC makes no library for', () => {
    expect(libraryFileProblem(elf(ELF_CLASS_64, MACHINE_AARCH64), 'linux', 'arm64')).toMatch(/32-bit only/);
  });
});
