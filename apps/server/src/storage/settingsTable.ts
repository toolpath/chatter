import type Database from 'better-sqlite3';

/** Saved settings as key and value text, in the "settings" table of the SQLite database */
export class SettingsTable {
  constructor(private readonly db: Database.Database) {
    db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  /** Save all the values together: either each one is saved, or none is */
  set(values: Record<string, string>): void {
    const save = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(values)) save.run(key, value);
    })();
  }

  delete(keys: string[]): void {
    const remove = this.db.prepare('DELETE FROM settings WHERE key = ?');
    this.db.transaction(() => {
      for (const key of keys) remove.run(key);
    })();
  }
}
