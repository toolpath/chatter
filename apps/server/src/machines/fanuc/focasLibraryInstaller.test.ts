import { createHash } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FocasLibraryInstaller, LibraryFileError } from './focasLibraryInstaller.js';
import { FakeFocasLoader, X64_LIBRARY_NAME, x64Library } from './testSupport.js';

const sha256 = (file: Buffer) => createHash('sha256').update(file).digest('hex');

describe('FocasLibraryInstaller', () => {
  let folder: string;
  let loader: FakeFocasLoader;
  let onLoaded: () => void;
  let installer: FocasLibraryInstaller;

  beforeEach(() => {
    folder = mkdtempSync(path.join(os.tmpdir(), 'focas-'));
    loader = FakeFocasLoader.inFolder(folder);
    onLoaded = vi.fn();
    installer = new FocasLibraryInstaller(loader, onLoaded, 'linux', 'x64');
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('names the file that this computer needs, when there is none yet', async () => {
    expect(await installer.status()).toEqual({
      fileName: X64_LIBRARY_NAME, problem: null, source: null, sha256: null, restartNeeded: false,
    });
  });

  it('says that a computer with no FANUC library cannot read FANUC machines', async () => {
    loader.uploadPath = () => { throw new Error('FANUC FOCAS on ARM is 32-bit only.'); };

    expect(await installer.status()).toMatchObject({ fileName: null, problem: 'FANUC FOCAS on ARM is 32-bit only.' });
  });

  it('shows the file that comes with the server', async () => {
    mkdirSync(path.dirname(loader.bundled));
    writeFileSync(loader.bundled, x64Library());

    expect(await installer.status()).toMatchObject({ source: 'bundled', sha256: sha256(x64Library()) });
  });

  it('saves an uploaded file, loads it at once, and starts the FANUC machines', async () => {
    const status = await installer.install(x64Library());

    expect(existsSync(loader.uploaded)).toBe(true);
    expect(loader.loaded).toBe(true);
    expect(onLoaded).toHaveBeenCalledOnce();
    expect(status).toMatchObject({ source: 'uploaded', sha256: sha256(x64Library()), restartNeeded: false });
  });

  it('refuses a file for another processor, and saves nothing', async () => {
    const arm = x64Library();
    arm[4] = 1;
    arm.writeUInt16LE(0x28, 18);

    await expect(installer.install(arm)).rejects.toThrow(LibraryFileError);
    expect(existsSync(loader.uploaded)).toBe(false);
  });

  it('deletes a file that does not load, and gives the reason', async () => {
    loader.loadError = new Error('undefined symbol: cnc_statinfo');

    await expect(installer.install(x64Library())).rejects.toThrow(/cannot load this file.*cnc_statinfo/);
    expect(existsSync(loader.uploaded)).toBe(false);
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('puts back the uploaded file that was there before, when a new file does not load', async () => {
    mkdirSync(path.dirname(loader.uploaded));
    const working = Buffer.concat([x64Library(), Buffer.from('working')]);
    writeFileSync(loader.uploaded, working);
    loader.loadError = new Error('wrong file');

    await expect(installer.install(x64Library())).rejects.toThrow(LibraryFileError);

    expect(readFileSync(loader.uploaded)).toEqual(working);
    expect(readdirSync(path.dirname(loader.uploaded))).toEqual([X64_LIBRARY_NAME]);
  });

  it('accepts the upload even when a FANUC machine cannot start', async () => {
    installer = new FocasLibraryInstaller(loader, () => { throw new Error('bad machine'); }, 'linux', 'x64');

    expect(await installer.install(x64Library())).toMatchObject({ source: 'uploaded' });
  });

  it('loads a good file after a file that did not load', async () => {
    loader.loadError = new Error('wrong file');
    await expect(installer.install(x64Library())).rejects.toThrow();

    loader.loadError = null;
    await installer.install(x64Library());

    expect(loader.loaded).toBe(true);
    expect(onLoaded).toHaveBeenCalledOnce();
  });

  it('saves a new file for a library that is in memory, and asks for a restart', async () => {
    await installer.install(x64Library());
    const newer = Buffer.concat([x64Library(), Buffer.from('newer')]);

    const status = await installer.install(newer);

    expect(status).toMatchObject({ sha256: sha256(newer), restartNeeded: true });
    expect(onLoaded).toHaveBeenCalledOnce();
  });

  it('removes the uploaded file, and asks for a restart when the library is in memory', async () => {
    await installer.install(x64Library());

    const status = await installer.remove();

    expect(existsSync(loader.uploaded)).toBe(false);
    expect(status).toMatchObject({ source: null, restartNeeded: true });
  });

  it('asks for no restart when it removes nothing, and the library in memory came with the server', async () => {
    mkdirSync(path.dirname(loader.bundled));
    writeFileSync(loader.bundled, x64Library());
    loader.loaded = true;

    expect(await installer.remove()).toMatchObject({ source: 'bundled', restartNeeded: false });
  });

  it('removes an uploaded file that is not in memory, with no restart', async () => {
    mkdirSync(path.dirname(loader.uploaded));
    writeFileSync(loader.uploaded, x64Library());

    expect(await installer.remove()).toMatchObject({ source: null, restartNeeded: false });
  });
});
