import Database from 'better-sqlite3';
import zlib from 'zlib';
import fs from 'fs';
import { promisify } from 'util';
import path from 'path';
import type { UploadFileRow, UploadEventRow } from '../types/index.js';
import { applySchema } from './schema.js';
import { createLogger } from '../logging/logger.js';

const log = createLogger('database');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const IN_MEMORY_DATABASE = ':memory:';
const DATABASE_FILE_NAME = 'chatter.db';
const DEFAULT_DATA_FOLDER = path.join(process.cwd(), 'data');
const DEFAULT_UPLOAD_FILE_LIMIT = 50;
const STORED_TEXT_ENCODING = 'utf-8';

let openDatabase: Database.Database | null = null;

function databasePath(): string {
  return process.env.DATABASE_PATH || path.join(DEFAULT_DATA_FOLDER, DATABASE_FILE_NAME);
}

/** The folder of chatter.db. Other files that must survive an update go here too. */
export function dataFolder(): string {
  const dbPath = databasePath();
  return dbPath === IN_MEMORY_DATABASE ? DEFAULT_DATA_FOLDER : path.dirname(dbPath);
}

export function getDb(): Database.Database {
  if (!openDatabase) {
    const dbPath = databasePath();
    if (dbPath !== IN_MEMORY_DATABASE) ensureFolderExists(path.dirname(dbPath));
    openDatabase = new Database(dbPath);
    openDatabase.pragma('journal_mode = WAL');
  }
  return openDatabase;
}

function ensureFolderExists(folder: string): void {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
}

export async function initDatabase(): Promise<void> {
  applySchema(getDb());
  log.info('Database tables initialized', { path: databasePath() });
}

/**
 * Save one upload of a file to a machine. The content is stored gzip-compressed.
 * Uploads are grouped by the original file name; the target name is the name on the machine.
 */
export async function recordUpload(
  machineId: string,
  originalName: string,
  targetName: string,
  remotePath: string,
  fileContent: string
): Promise<void> {
  const compressedContent = await gzip(Buffer.from(fileContent, STORED_TEXT_ENCODING));
  const fileId = saveUploadFile(machineId, originalName);
  getDb().prepare(`
    INSERT INTO upload_events (file_id, target_name, remote_path, file_content)
    VALUES (?, ?, ?, ?)
  `).run(fileId, targetName, remotePath, compressedContent);
}

/** Add the file to the upload history, or mark it as updated now. Returns the file ID. */
function saveUploadFile(machineId: string, fileName: string): number {
  const db = getDb();
  db.prepare(`
    INSERT INTO upload_files (machine_id, file_name, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (machine_id, file_name)
    DO UPDATE SET updated_at = CURRENT_TIMESTAMP
  `).run(machineId, fileName);
  const file = db.prepare(
    'SELECT id FROM upload_files WHERE machine_id = ? AND file_name = ?'
  ).get(machineId, fileName) as { id: number };
  return file.id;
}

/** The uploaded files of a machine, most recently updated first, with their upload count and last path. */
export async function getUploadFiles(machineId: string, limit = DEFAULT_UPLOAD_FILE_LIMIT): Promise<UploadFileRow[]> {
  return getDb().prepare(`
    SELECT
      uf.id,
      uf.file_name,
      uf.created_at,
      uf.updated_at,
      COUNT(ue.id) as event_count,
      (SELECT remote_path FROM upload_events WHERE file_id = uf.id ORDER BY uploaded_at DESC LIMIT 1) as last_path
    FROM upload_files uf
    LEFT JOIN upload_events ue ON ue.file_id = uf.id
    WHERE uf.machine_id = ?
    GROUP BY uf.id
    ORDER BY uf.updated_at DESC
    LIMIT ?
  `).all(machineId, limit) as UploadFileRow[];
}

/** The uploads of one file, newest first, without their content. */
export async function getUploadEvents(fileId: string | number): Promise<UploadEventRow[]> {
  return getDb().prepare(`
    SELECT id, target_name, remote_path, uploaded_at
    FROM upload_events
    WHERE file_id = ?
    ORDER BY uploaded_at DESC
  `).all(fileId) as UploadEventRow[];
}

/** One upload with its decompressed content, or null when there is no upload with this ID. */
export async function getUploadEventById(eventId: string | number): Promise<UploadEventRow | null> {
  const event = getDb().prepare(`
    SELECT ue.*, uf.file_name, uf.machine_id
    FROM upload_events ue
    JOIN upload_files uf ON uf.id = ue.file_id
    WHERE ue.id = ?
  `).get(eventId) as UploadEventRow | undefined;
  if (!event) return null;

  if (event.file_content && Buffer.isBuffer(event.file_content)) {
    const decompressedContent = await gunzip(event.file_content);
    event.file_content = decompressedContent.toString(STORED_TEXT_ENCODING);
  }
  return event;
}

export async function closeDatabase(): Promise<void> {
  if (openDatabase) {
    openDatabase.close();
    openDatabase = null;
  }
}
