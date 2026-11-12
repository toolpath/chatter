import type Database from 'better-sqlite3';

/**
 * The tables in chatter.db for machines and uploads, and the steps that bring a
 * database made by an older version up to date. Features with their own tables
 * (users, sessions, alerts, state periods) create them next to the code that uses them.
 */

const CREATE_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'ping',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS brother_machines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    data_port INTEGER DEFAULT 10000,
    ftp_port INTEGER DEFAULT 21,
    ftp_user TEXT DEFAULT 'anonymous',
    ftp_password TEXT DEFAULT '',
    default_unit TEXT DEFAULT 'in',
    macros TEXT DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS haas_machines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    data_port INTEGER DEFAULT 9998,
    query_port INTEGER DEFAULT 5051,
    ftp_port INTEGER DEFAULT 21,
    ftp_user TEXT DEFAULT 'anonymous',
    ftp_password TEXT DEFAULT '',
    macros TEXT DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS mtconnect_machines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    mtconnect_port INTEGER DEFAULT 5000,
    mtconnect_device_id TEXT,
    agent_type TEXT DEFAULT 'generic',
    macros TEXT DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS fanuc_machines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    focas_port INTEGER DEFAULT 8193,
    ftp_port INTEGER DEFAULT 21,
    ftp_user TEXT DEFAULT 'anonymous',
    ftp_password TEXT DEFAULT '',
    macros TEXT DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS siemens_machines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    opcua_port INTEGER DEFAULT 4840,
    opcua_user TEXT DEFAULT '',
    opcua_password TEXT DEFAULT '',
    opcua_security TEXT DEFAULT 'none',
    ftp_port INTEGER DEFAULT 21,
    ftp_user TEXT DEFAULT 'anonymous',
    ftp_password TEXT DEFAULT '',
    macros TEXT DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  // One row per file name and machine, so the upload history groups uploads of the same file.
  `CREATE TABLE IF NOT EXISTS upload_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(machine_id, file_name)
  )`,
  `CREATE TABLE IF NOT EXISTS upload_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES upload_files(id) ON DELETE CASCADE,
    target_name TEXT,
    remote_path TEXT NOT NULL,
    file_content BLOB,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
];

interface AddedColumn {
  table: string;
  column: string;
  definition: string;
}

/**
 * Columns that came after the first release of a table. A database made by an older
 * version does not have them, so they are added when they are missing.
 */
const ADDED_COLUMNS: AddedColumn[] = [
  { table: 'brother_machines', column: 'ftp_port', definition: 'INTEGER DEFAULT 21' },
  { table: 'brother_machines', column: 'ftp_user', definition: "TEXT DEFAULT 'anonymous'" },
  { table: 'brother_machines', column: 'ftp_password', definition: "TEXT DEFAULT ''" },
  { table: 'fanuc_machines', column: 'tool_number_variable', definition: 'INTEGER' },
  { table: 'fanuc_machines', column: 'part_counter_variable', definition: 'INTEGER' },
  { table: 'fanuc_machines', column: 'ignored_message_types', definition: "TEXT DEFAULT '[]'" },
  { table: 'mtconnect_machines', column: 'ftp_port', definition: 'INTEGER DEFAULT 21' },
  { table: 'mtconnect_machines', column: 'ftp_user', definition: "TEXT DEFAULT 'anonymous'" },
  { table: 'mtconnect_machines', column: 'ftp_password', definition: "TEXT DEFAULT ''" },
  { table: 'upload_events', column: 'target_name', definition: 'TEXT' },
];

/** The tables of the old machine history. VictoriaMetrics keeps the machine history now. */
const OLD_HISTORY_TABLES = ['history_points', 'history_averages', 'history_series'];

/** Create the tables, and bring a database made by an older version up to date. */
export function applySchema(db: Database.Database): void {
  createTables(db);
  addMissingColumns(db);
  moveOldUploadHistory(db);
  dropOldHistoryTables(db);
}

function createTables(db: Database.Database): void {
  for (const statement of CREATE_TABLE_STATEMENTS) db.exec(statement);
}

function addMissingColumns(db: Database.Database): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    if (!columnExists(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** Move the old upload_history table, from before uploads were grouped by file name, into the new tables. */
function moveOldUploadHistory(db: Database.Database): void {
  if (!tableExists(db, 'upload_history')) return;
  db.exec(`
    INSERT OR IGNORE INTO upload_files (machine_id, file_name, created_at, updated_at)
    SELECT DISTINCT machine_id, file_name, MIN(uploaded_at), MAX(uploaded_at)
    FROM upload_history
    GROUP BY machine_id, file_name
  `);
  db.exec(`
    INSERT INTO upload_events (file_id, remote_path, file_content, uploaded_at)
    SELECT uf.id, uh.remote_path, uh.file_content, uh.uploaded_at
    FROM upload_history uh
    JOIN upload_files uf ON uf.machine_id = uh.machine_id AND uf.file_name = uh.file_name
    WHERE NOT EXISTS (
      SELECT 1 FROM upload_events ue WHERE ue.file_id = uf.id AND ue.uploaded_at = uh.uploaded_at
    )
  `);
  db.exec('DROP TABLE upload_history');
}

function dropOldHistoryTables(db: Database.Database): void {
  const oldTables = OLD_HISTORY_TABLES.filter(table => tableExists(db, table));
  if (oldTables.length === 0) return;
  for (const table of oldTables) db.exec(`DROP TABLE ${table}`);
  // Give the free space back to the disk. It runs one time only, because the tables are gone after it.
  db.exec('VACUUM');
}

function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.pragma(`table_info(${tableName})`) as { name: string }[];
  return columns.some(column => column.name === columnName);
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(tableName);
  return !!table;
}
