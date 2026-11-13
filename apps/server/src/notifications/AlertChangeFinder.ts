import type Database from 'better-sqlite3';
import { type Alert, type AlertRow, toAlert } from '../alerts/AlertStore.js';

/** A change older than this sends no message, for example after Chatter was off for a long time */
export const SILENT_AFTER_MS = 24 * 60 * 60_000;

export type AlertChangeKind = 'started' | 'ended';

export interface AlertChange {
  kind: AlertChangeKind;
  /** The id of the alert in the "alerts" table */
  alertId: number;
  alert: Alert;
  /** When the alert started or ended, in milliseconds since 1970 */
  at: number;
}

/** Gets each change one time. It runs in the same database transaction as the note of the change. */
export interface AlertChangeListener {
  alertChanged(change: AlertChange): void;
}

interface StoredAlertRow extends AlertRow {
  id: number;
}

/**
 * Finds the alerts that started or ended, and tells the listener one time for each change.
 * vmalert sends a firing alert again and again, and Chatter can restart at any time.
 * So the finder does not compare requests. It keeps a note for each change that it reported, in the
 * "alert_notices" table, and each look reports only the changes that have no note.
 */
export class AlertChangeFinder {
  constructor(
    private readonly db: Database.Database,
    private readonly listener: AlertChangeListener,
  ) {
    this.db.transaction(() => this.createNoticeTable())();
  }

  /** Reports the new changes, in time order. If the listener fails, no note is kept, and the next look tries again. */
  findChanges(now: number): void {
    this.db.transaction(() => {
      for (const change of this.unreportedChanges(now)) {
        this.keepNote(change);
        if (now - change.at <= SILENT_AFTER_MS) this.listener.alertChanged(change);
      }
      this.forgetDeletedAlerts();
    })();
  }

  /**
   * At the first start after the update that adds notifications, the alerts that are already saved get both
   * notes. So the update sends no messages about old alerts.
   */
  private createNoticeTable(): void {
    const isFirstStart = !this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'alert_notices'").get();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alert_notices (
        alert_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        PRIMARY KEY (alert_id, kind)
      ) WITHOUT ROWID
    `);
    if (isFirstStart) {
      this.db.exec(`
        INSERT INTO alert_notices (alert_id, kind)
        SELECT id, 'started' FROM alerts UNION ALL SELECT id, 'ended' FROM alerts
      `);
    }
  }

  private unreportedChanges(now: number): AlertChange[] {
    const starts = this.alertsWithoutNote('started', now).map(row => toChange('started', row, row.starts_at));
    const ends = this.alertsWithoutNote('ended', now).map(row => toChange('ended', row, row.ends_at));
    return [...starts, ...ends].sort(byTimeThenStartFirst);
  }

  /** Each alert has a start. Only an alert with its end time in the past has an end. */
  private alertsWithoutNote(kind: AlertChangeKind, now: number): StoredAlertRow[] {
    return this.db.prepare(`
      SELECT a.id, a.name, a.machine_id, a.labels, a.annotations, a.starts_at, a.ends_at FROM alerts a
      WHERE (@kind = 'started' OR a.ends_at <= @now)
        AND NOT EXISTS (SELECT 1 FROM alert_notices n WHERE n.alert_id = a.id AND n.kind = @kind)
    `).all({ kind, now }) as StoredAlertRow[];
  }

  private keepNote(change: AlertChange): void {
    this.db.prepare('INSERT INTO alert_notices (alert_id, kind) VALUES (?, ?)').run(change.alertId, change.kind);
  }

  /** The alert store deletes old alerts and the alerts of a removed machine. Their notes are not necessary. */
  private forgetDeletedAlerts(): void {
    this.db.exec('DELETE FROM alert_notices WHERE alert_id NOT IN (SELECT id FROM alerts)');
  }
}

function toChange(kind: AlertChangeKind, row: StoredAlertRow, at: number): AlertChange {
  return { kind, alertId: row.id, alert: toAlert(row), at };
}

function byTimeThenStartFirst(first: AlertChange, second: AlertChange): number {
  if (first.at !== second.at) return first.at - second.at;
  return first.kind === second.kind ? 0 : first.kind === 'started' ? -1 : 1;
}
