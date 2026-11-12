import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import zlib from 'zlib';
import { promisify } from 'util';
import { recordUpload, getUploadFiles, getUploadEvents, getUploadEventById, closeDatabase, initDatabase, getDb } from './database.js';

const gunzip = promisify(zlib.gunzip);

function uploadFileId(fileName: string): number {
  const file = getDb().prepare('SELECT id FROM upload_files WHERE file_name = ?').get(fileName) as { id: number };
  return file.id;
}

async function decompress(storedContent: Buffer): Promise<string> {
  return (await gunzip(storedContent)).toString('utf-8');
}

describe('database', () => {
  beforeEach(async () => {
    process.env.DATABASE_PATH = ':memory:';
    await initDatabase();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  describe('recordUpload', () => {
    it('stores the file content gzip-compressed', async () => {
      const fileContent = 'G00 X0 Y0 Z0\nG01 X10 Y10 F100';

      await recordUpload('machine1', 'part.nc', 'O0100.NC', '/TEST/O0100.NC', fileContent);

      const event = getDb().prepare('SELECT file_content FROM upload_events WHERE id = 1').get() as { file_content: Buffer };
      expect(event).not.toBeNull();
      expect(Buffer.isBuffer(event.file_content)).toBe(true);
      expect(await decompress(event.file_content)).toBe(fileContent);
    });

    it('creates a file row and an upload event row', async () => {
      await recordUpload('machine1', 'part.nc', 'O0100.NC', '/PROGRAMS/O0100.NC', 'content');

      const db = getDb();
      const file = db.prepare('SELECT * FROM upload_files WHERE machine_id = ? AND file_name = ?').get('machine1', 'part.nc') as { id: number; file_name: string };
      expect(file).not.toBeNull();
      expect(file.file_name).toBe('part.nc');

      const event = db.prepare('SELECT * FROM upload_events WHERE file_id = ?').get(file.id) as { target_name: string; remote_path: string };
      expect(event).not.toBeNull();
      expect(event.target_name).toBe('O0100.NC');
      expect(event.remote_path).toBe('/PROGRAMS/O0100.NC');
    });

    it('keeps empty, large, unicode and Windows line-ending content unchanged', async () => {
      const testCases = [
        { content: '', description: 'empty content' },
        { content: 'A'.repeat(10000), description: 'large content' },
        { content: '日本語テスト', description: 'unicode content' },
        { content: 'line1\r\nline2\r\nline3', description: 'windows line endings' },
      ];

      for (const { content, description } of testCases) {
        const fileName = `test_${description}.nc`;
        await recordUpload('m1', fileName, 'O0001.NC', '/test', content);

        const event = getDb().prepare('SELECT file_content FROM upload_events WHERE file_id = ?').get(uploadFileId(fileName)) as { file_content: Buffer };
        expect(await decompress(event.file_content)).toBe(content);
      }
    });
  });

  describe('getUploadFiles', () => {
    it('returns each file with its number of uploads', async () => {
      await recordUpload('machine1', 'part1.nc', 'O0100.NC', '/TEST/O0100.NC', 'content1');
      await recordUpload('machine1', 'part1.nc', 'O0100.NC', '/TEST/O0100.NC', 'content2');
      await recordUpload('machine1', 'part2.nc', 'O0200.NC', '/TEST/O0200.NC', 'content3');

      const result = await getUploadFiles('machine1');

      expect(result).toHaveLength(2);
      const part1 = result.find(f => f.file_name === 'part1.nc');
      const part2 = result.find(f => f.file_name === 'part2.nc');

      expect(part1).toBeDefined();
      expect(part1!.event_count).toBe(2);
      expect(part2).toBeDefined();
      expect(part2!.event_count).toBe(1);
    });

    it('returns no more files than the limit', async () => {
      await recordUpload('machine1', 'part1.nc', 'O0100.NC', '/test', 'c1');
      await recordUpload('machine1', 'part2.nc', 'O0200.NC', '/test', 'c2');
      await recordUpload('machine1', 'part3.nc', 'O0300.NC', '/test', 'c3');

      const result = await getUploadFiles('machine1', 2);
      expect(result).toHaveLength(2);
    });
  });

  describe('getUploadEvents', () => {
    it('returns every upload of a file', async () => {
      await recordUpload('machine1', 'part.nc', 'O0100.NC', '/TEST/O0100.NC', 'v1');
      await recordUpload('machine1', 'part.nc', 'O0100.NC', '/PROD/O0100.NC', 'v2');

      const result = await getUploadEvents(uploadFileId('part.nc'));

      expect(result).toHaveLength(2);
      expect(result.map(e => e.remote_path)).toContain('/TEST/O0100.NC');
      expect(result.map(e => e.remote_path)).toContain('/PROD/O0100.NC');
    });

    it('accepts the file ID as a string', async () => {
      await recordUpload('machine1', 'part.nc', 'O0100.NC', '/test', 'content');

      const result = await getUploadEvents(String(uploadFileId('part.nc')));
      expect(result).toHaveLength(1);
    });
  });

  describe('getUploadEventById', () => {
    it('returns the upload with its content decompressed', async () => {
      const originalContent = 'G00 X0 Y0\nM30';
      await recordUpload('machine1', 'test.nc', 'O0100.NC', '/O0100.NC', originalContent);

      const result = await getUploadEventById(1);

      expect(result).not.toBeNull();
      expect(result!.file_content).toBe(originalContent);
    });

    it('returns null when there is no upload with that ID', async () => {
      const result = await getUploadEventById(999);
      expect(result).toBeNull();
    });
  });

  describe('old machine history', () => {
    it('drops the old history tables, because VictoriaMetrics keeps the machine history now', async () => {
      const db = getDb();
      db.exec('CREATE TABLE history_series (id INTEGER PRIMARY KEY)');
      db.exec('CREATE TABLE history_points (series_id INTEGER, minute_start INTEGER)');
      db.exec('CREATE TABLE history_averages (series_id INTEGER, minute_start INTEGER)');

      await initDatabase();

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'history_%'").all();
      expect(tables).toEqual([]);
    });
  });

  describe('getDb', () => {
    it('returns the same connection on every call', () => {
      expect(getDb()).toBe(getDb());
    });
  });
});
