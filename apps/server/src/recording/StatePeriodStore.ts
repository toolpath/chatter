import Database from 'better-sqlite3';
import type { StatePeriodKind } from '@local-chatter/shared';

/** One time when a machine state had one value. `end` is undefined while the period still runs. */
export interface StatePeriod {
  kind: StatePeriodKind;
  value: string;
  start: number;
  end?: number;
}

export interface PeriodQuery {
  machineId: string;
  from: number;
  to: number;
  kind?: StatePeriodKind;
  limit: number;
}

interface StatePeriodRow {
  kind: StatePeriodKind;
  value: string;
  started_at: number;
  ended_at: number | null;
}

/**
 * The state periods, in the "state_periods" table of the SQLite database. Times are in milliseconds since 1970.
 * `seen_at` is the last time that ChatterBox saw an open period, so a period that a power cut left open
 * can end at that time when ChatterBox starts again.
 */
export class StatePeriodStore {
  constructor(private readonly db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS state_periods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        machine_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        seen_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS state_periods_machine_start ON state_periods (machine_id, started_at);
    `);
  }

  /** For tests: the periods are kept in memory only */
  static inMemory(): StatePeriodStore {
    return new StatePeriodStore(new Database(':memory:'));
  }

  inTransaction(work: () => void): void {
    this.db.transaction(work)();
  }

  open(machineId: string, kind: StatePeriodKind, value: string, time: number): void {
    this.db.prepare('INSERT INTO state_periods (machine_id, kind, value, started_at, seen_at) VALUES (?, ?, ?, ?, ?)')
      .run(machineId, kind, value, time, time);
  }

  close(machineId: string, kind: StatePeriodKind, time: number): void {
    this.db.prepare('UPDATE state_periods SET ended_at = ? WHERE machine_id = ? AND kind = ? AND ended_at IS NULL')
      .run(time, machineId, kind);
  }

  markSeen(machineId: string, time: number): void {
    this.db.prepare('UPDATE state_periods SET seen_at = ? WHERE machine_id = ? AND ended_at IS NULL').run(time, machineId);
  }

  /** End every open period now, for example when ChatterBox stops */
  closeAll(time: number): void {
    this.db.prepare('UPDATE state_periods SET ended_at = ? WHERE ended_at IS NULL').run(time);
  }

  /** End the periods that a sudden stop left open, at the last time ChatterBox saw them */
  closeLeftovers(): void {
    this.db.prepare('UPDATE state_periods SET ended_at = seen_at WHERE ended_at IS NULL').run();
  }

  /** The periods that overlap the time from `from` to `to`, newest first */
  read({ machineId, from, to, kind, limit }: PeriodQuery): StatePeriod[] {
    const rows = this.db.prepare(`
      SELECT kind, value, started_at, ended_at FROM state_periods
      WHERE machine_id = ? AND started_at < ? AND (ended_at IS NULL OR ended_at > ?) AND (? IS NULL OR kind = ?)
      ORDER BY started_at DESC, id DESC
      LIMIT ?
    `).all(machineId, to, from, kind ?? null, kind ?? null, limit) as StatePeriodRow[];
    return rows.map(toStatePeriod);
  }

  removeMachine(machineId: string): void {
    this.db.prepare('DELETE FROM state_periods WHERE machine_id = ?').run(machineId);
  }

  removeEndedBefore(time: number): void {
    this.db.prepare('DELETE FROM state_periods WHERE ended_at < ?').run(time);
  }
}

function toStatePeriod(row: StatePeriodRow): StatePeriod {
  return { kind: row.kind, value: row.value, start: row.started_at, end: row.ended_at ?? undefined };
}
