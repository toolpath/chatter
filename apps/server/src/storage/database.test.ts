import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import zlib from 'zlib';
import { promisify } from 'util';
import Database from 'better-sqlite3';
import { recordUpload, getUploadFiles, getUploadEvents, getUploadEventById, closeDatabase, initDatabase, getDb } from './database.js';
import { applySchema } from './schema.js';

const gunzip = promisify(zlib.gunzip);

/** The user who sends a file in most tests, and the address of the computer */
const ANN = { username: 'ann', address: '192.168.1.20' };

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

      await recordUpload('machine1', 'part.nc', 'O0100.NC', '/TEST/O0100.NC', fileContent, ANN);

      const event = getDb().prepare('SELECT file_content FROM upload_events WHERE id = 1').get() as { file_content: Buffer };
      expect(event).not.toBeNull();
      expect(Buffer.isBuffer(event.file_content)).toBe(true);
      expect(await decompress(event.file_content)).toBe(fileContent);
    });

    it('creates a file row and an upload event row', async () => {
      await recordUpload('machine1', 'part.nc', 'O0100.NC', '/PROGRAMS/O0100.NC', 'content', ANN);

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
        await recordUpload('m1', fileName, 'O0001.NC', '/test', content, ANN);

        const event = getDb().prepare('SELECT file_content FROM upload_events WHERE file_id = ?').get(uploadFileId(fileName)) as { file_content: Buffer };
        expect(await decompress(event.file_content)).toBe(content);
      }
    });
    it('records who sent the file, and the address of the computer', async () => {
      await recordUpload('machine1', 'part.nc', 'O0100.NC', '/PRG/O0100.NC', 'content', ANN);

      const event = getDb().prepare('SELECT uploaded_by, address, action FROM upload_events').get();
      expect(event).toEqual({ uploaded_by: 'ann', address: '192.168.1.20', action: 'sent' });
    });
  });

  describe('a database of an older version', () => {
    it('gets the new columns of upload_events, and an old row keeps no user and no address and is a send', () => {
      const db = new Database(':memory:');
      db.exec(`CREATE TABLE upload_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT, machine_id TEXT NOT NULL, file_name TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(machine_id, file_name))`);
      db.exec(`CREATE TABLE upload_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, file_id INTEGER NOT NULL REFERENCES upload_files(id) ON DELETE CASCADE,
        target_name TEXT, remote_path TEXT NOT NULL, file_content BLOB, uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
      db.exec("INSERT INTO upload_files (machine_id, file_name) VALUES ('machine1', 'part.nc')");
      db.exec("INSERT INTO upload_events (file_id, target_name, remote_path) VALUES (1, 'O0100.NC', '/O0100.NC')");

      applySchema(db);
      applySchema(db);

      expect(db.prepare('SELECT target_name, uploaded_by, address, action FROM upload_events').all()).toEqual([
        { target_name: 'O0100.NC', uploaded_by: null, address: null, action: 'sent' },
      ]);
      db.close();
    });
  });

  describe('getUploadFiles', () => {
    it('returns each file with its number of uploads', async () => {
      await recordUpload('machine1', 'part1.nc', 'O0100.NC', '/TEST/O0100.NC', 'content1', ANN);
      await recordUpload('machine1', 'part1.nc', 'O0100.NC', '/TEST/O0100.NC', 'content2', ANN);
      await recordUpload('machine1', 'part2.nc', 'O0200.NC', '/TEST/O0200.NC', 'content3', ANN);

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
      await recordUpload('machine1', 'part1.nc', 'O0100.NC', '/test', 'c1', ANN);
      await recordUpload('machine1', 'part2.nc', 'O0200.NC', '/test', 'c2', ANN);
      await recordUpload('machine1', 'part3.nc', 'O0300.NC', '/test', 'c3', ANN);

      const result = await getUploadFiles('machine1', 2);
      expect(result).toHaveLength(2);
    });
  });

  describe('getUploadEvents', () => {
    it('returns every upload of a file', async () => {
      await recordUpload('machine1', 'part.nc', 'O0100.NC', '/TEST/O0100.NC', 'v1', ANN);
      await recordUpload('machine1', 'part.nc', 'O0100.NC', '/PROD/O0100.NC', 'v2', ANN);

      const result = await getUploadEvents('machine1', uploadFileId('part.nc'));

      expect(result).toHaveLength(2);
      expect(result.map(e => e.remote_path)).toContain('/TEST/O0100.NC');
      expect(result.map(e => e.remote_path)).toContain('/PROD/O0100.NC');
    });

    it('returns nothing for a file of another machine', async () => {
      await recordUpload('machine1', 'part.nc', 'O0100.NC', '/O0100.NC', 'content', ANN);

      expect(await getUploadEvents('machine2', uploadFileId('part.nc'))).toEqual([]);
    });
  });

  // A Viewer can read both lists. Only getUploadEventById gives the text of a program.
  describe('the lists of uploads, without the program text', () => {
    beforeEach(async () => {
      await recordUpload('machine1', 'part.nc', 'O0100.NC', '/PRG/O0100.NC', 'G00 X0', ANN);
    });

    it('gives only the name, the dates, the count and the last path of each file', async () => {
      const [file] = await getUploadFiles('machine1');
      expect(Object.keys(file).sort()).toEqual(['created_at', 'event_count', 'file_name', 'id', 'last_path', 'updated_at']);
      expect(JSON.stringify(file)).not.toContain('G00 X0');
    });

    it('gives only the name, the path, the date, the action and who sent it, for each upload', async () => {
      const [event] = await getUploadEvents('machine1', uploadFileId('part.nc'));
      expect(Object.keys(event).sort()).toEqual(['action', 'address', 'id', 'remote_path', 'target_name', 'uploaded_at', 'uploaded_by']);
      expect(JSON.stringify(event)).not.toContain('G00 X0');
    });
  });

  describe('getUploadEventById', () => {
    it('returns the upload with its content decompressed', async () => {
      const originalContent = 'G00 X0 Y0\nM30';
      await recordUpload('machine1', 'test.nc', 'O0100.NC', '/O0100.NC', originalContent, ANN);

      const result = await getUploadEventById('machine1', 1);

      expect(result).not.toBeNull();
      expect(result!.file_content).toBe(originalContent);
    });

    it('returns null when there is no upload with that ID', async () => {
      expect(await getUploadEventById('machine1', 999)).toBeNull();
    });

    it('returns null for an upload to another machine', async () => {
      await recordUpload('machine1', 'test.nc', 'O0100.NC', '/O0100.NC', 'content', ANN);

      expect(await getUploadEventById('machine2', 1)).toBeNull();
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
