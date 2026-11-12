import path from 'path';
import { describe, expect, it } from 'vitest';
import { focasLibraryPath } from './focasLibraryPath.js';

const NATIVE_DIR = '/app/native/focas';

describe('focasLibraryPath', () => {
  it('uses the x64 file on 64-bit Intel or AMD Linux', () => {
    expect(focasLibraryPath('linux', 'x64', NATIVE_DIR))
      .toBe(path.join(NATIVE_DIR, 'linux-x64', 'libfwlib32-linux-x64.so.1.0.5'));
  });

  it('uses the ARMv7 file on 32-bit ARM Linux, such as 32-bit Raspberry Pi OS', () => {
    expect(focasLibraryPath('linux', 'arm', NATIVE_DIR))
      .toBe(path.join(NATIVE_DIR, 'linux-arm', 'libfwlib32-linux-armv7.so.1.0.5'));
  });

  it('refuses 64-bit ARM Linux, because a 64-bit program cannot load the 32-bit ARM file', () => {
    expect(() => focasLibraryPath('linux', 'arm64', NATIVE_DIR)).toThrow(/32-bit only.*linux\/arm\/v7/);
  });

  it('refuses other Linux processors', () => {
    expect(() => focasLibraryPath('linux', 'ia32', NATIVE_DIR)).toThrow(/linux\/ia32/);
  });

  it('uses the 64-bit DLL on 64-bit Windows', () => {
    expect(focasLibraryPath('win32', 'x64', NATIVE_DIR)).toBe(path.join(NATIVE_DIR, 'win32-x64', 'Fwlib64.dll'));
  });

  it('refuses other Windows processors', () => {
    expect(() => focasLibraryPath('win32', 'arm64', NATIVE_DIR)).toThrow(/win32\/arm64/);
  });

  it('refuses macOS, because FANUC makes no FOCAS library for it', () => {
    expect(() => focasLibraryPath('darwin', 'arm64', NATIVE_DIR)).toThrow(/macOS/);
  });

  it('refuses other operating systems', () => {
    expect(() => focasLibraryPath('freebsd', 'x64', NATIVE_DIR)).toThrow(/freebsd/);
  });
});
