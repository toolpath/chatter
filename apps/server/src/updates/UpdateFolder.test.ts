import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HELPER_SILENCE_LIMIT_MS } from '@local-chatter/shared';
import { DEFAULT_UPDATE_FOLDER, REQUEST_FILE_NAME, UPDATE_FILE_NAME, UpdateFolder } from './UpdateFolder.js';

const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const secondsAgo = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe('UpdateFolder', () => {
  let root: string;
  let inbox: string;
  let folder: UpdateFolder;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'update-folder-'));
    inbox = path.join(root, 'inbox');
    mkdirSync(inbox);
    folder = new UpdateFolder(root, () => NOW);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const ARMV7_HELPER_INFO = '{"arch":"armv7"}';
  const writeHelperInfo = (text: string) => writeFileSync(path.join(root, 'helper.json'), text);
  const writeStatusText = (text: string) => writeFileSync(path.join(root, 'status.json'), text);
  const writeStatus = (status: object) => writeStatusText(JSON.stringify(status));
  const inboxNames = () => readdirSync(inbox).sort();

  describe('fromEnvironment', () => {
    it('uses CHATTER_UPDATE_FOLDER, or the folder that the Pi card mounts', () => {
      expect(UpdateFolder.fromEnvironment({ CHATTER_UPDATE_FOLDER: root }).inbox).toBe(inbox);
      expect(UpdateFolder.fromEnvironment({}).inbox).toBe(path.join(DEFAULT_UPDATE_FOLDER, 'inbox'));
    });
  });

  describe('helper', () => {
    it('reads the processor type that the helper wrote', async () => {
      writeHelperInfo(ARMV7_HELPER_INFO);
      expect(await folder.helper()).toEqual({ arch: 'armv7' });
    });

    it('finds no helper on a normal computer', async () => {
      expect(await folder.helper()).toBeNull();
      expect(await new UpdateFolder(path.join(root, 'missing')).helper()).toBeNull();
    });

    it('finds no helper when helper.json is not what the helper writes', async () => {
      writeHelperInfo('nonsense');
      expect(await folder.helper()).toBeNull();
    });

    it('finds no helper when the inbox is missing', async () => {
      writeHelperInfo(ARMV7_HELPER_INFO);
      rmSync(inbox, { recursive: true });
      expect(await folder.helper()).toBeNull();
    });
  });

  describe('status', () => {
    it('reads the status that the helper wrote', async () => {
      writeStatus({ state: 'ready', version: '1.2.0', heartbeat: secondsAgo(5), freeBytes: 1000 });
      expect(await folder.status()).toEqual({ state: 'ready', version: '1.2.0', heartbeat: secondsAgo(5), freeBytes: 1000 });
    });

    it('shows failed for a busy helper that is silent for too long', async () => {
      writeStatus({ state: 'installing', heartbeat: secondsAgo(HELPER_SILENCE_LIMIT_MS / 1000 + 1), freeBytes: 0 });
      expect((await folder.status())?.state).toBe('failed');
    });

    it('gives nothing before the first check, or for a status it cannot read', async () => {
      expect(await folder.status()).toBeNull();
      writeStatusText('{"state":"exploded"}');
      expect(await folder.status()).toBeNull();
    });
  });

  describe('writeRequest', () => {
    it('writes only the request text, under its final name', async () => {
      await folder.writeRequest('install');

      expect(inboxNames()).toEqual([REQUEST_FILE_NAME]);
      expect(readFileSync(path.join(inbox, REQUEST_FILE_NAME), 'utf8')).toBe('install');
    });

    it('leaves no temporary request when the rename fails', async () => {
      // A folder with the request name makes the rename fail
      mkdirSync(path.join(inbox, REQUEST_FILE_NAME));

      await expect(folder.writeRequest('check')).rejects.toThrow();

      expect(inboxNames()).toEqual([REQUEST_FILE_NAME]);
    });
  });

  describe('newPartialFile and keepFile', () => {
    it('gives a new hidden name each time, and renames a whole file to the update file', async () => {
      const first = folder.newPartialFile();
      const second = folder.newPartialFile();
      expect(first).not.toBe(second);
      expect(path.basename(first)).toMatch(/^\.partial-[0-9a-f]{16}$/);

      writeFileSync(first, 'update');
      await folder.keepFile(first);

      expect(inboxNames()).toEqual([UPDATE_FILE_NAME]);
    });
  });

  describe('removeLeftovers', () => {
    it('deletes half files and temporary requests, and keeps what the helper moves', async () => {
      for (const name of ['.partial-ab12', '.request-cd34', UPDATE_FILE_NAME, REQUEST_FILE_NAME]) {
        writeFileSync(path.join(inbox, name), 'x');
      }

      await folder.removeLeftovers();

      expect(inboxNames()).toEqual([UPDATE_FILE_NAME, REQUEST_FILE_NAME].sort());
    });

    it('does nothing on a normal computer with no inbox', async () => {
      await expect(new UpdateFolder(path.join(root, 'missing')).removeLeftovers()).resolves.toBeUndefined();
    });
  });

  describe('freeBytes', () => {
    it('gives the free space where the update file goes', async () => {
      expect(await folder.freeBytes()).toBeGreaterThan(0);
    });
  });
});
