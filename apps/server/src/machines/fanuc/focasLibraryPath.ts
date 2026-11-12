import path from 'path';

/**
 * Where the FANUC FOCAS2 library file for this computer must be.
 * The library must match the processor of the Node.js program that loads it:
 * a 64-bit program cannot load a 32-bit library.
 * Throws an error that says why, when FANUC makes no library for this computer.
 */
export function focasLibraryPath(platform: NodeJS.Platform, arch: string, nativeDir: string): string {
  const target = `${platform}/${arch}`;
  switch (target) {
    case 'linux/x64':
      return path.join(nativeDir, 'linux-x64', 'libfwlib32-linux-x64.so.1.0.5');
    case 'linux/arm':
      return path.join(nativeDir, 'linux-arm', 'libfwlib32-linux-armv7.so.1.0.5');
    case 'linux/arm64':
      throw new Error(
        'FANUC FOCAS on ARM is 32-bit only. Use 32-bit Raspberry Pi OS, or run the linux/arm/v7 image.',
      );
    case 'win32/x64':
      return path.join(nativeDir, 'win32-x64', 'Fwlib64.dll');
  }
  if (platform === 'darwin') {
    throw new Error('FOCAS is not available on macOS. Use Linux or Windows, or Docker with a Linux container.');
  }
  throw new Error(`FANUC makes no FOCAS library for ${target}.`);
}
