import { randomUUID } from 'node:crypto';
import type { AlertSeverity, ChannelInput, ChannelValues, NotificationChannel } from '@local-chatter/shared';
import type Database from 'better-sqlite3';
import type { MachineRemovalListener } from '../polling/poller.js';
import type { ChannelType } from './channels/ChannelType.js';
import { findChannelType } from './channels/index.js';

export const MAX_CHANNEL_NAME_LENGTH = 100;

export type ChannelSaveResult = { ok: true; channel: NotificationChannel } | { ok: false; error: string };

/** A form that passed the checks. `values` has the saved secrets in place of the empty secrets. */
export type InputCheck = PassedInputCheck | { ok: false; error: string };
export interface PassedInputCheck { ok: true; type: ChannelType; values: ChannelValues }

/** What the sender needs: the channel, its type, and all its values with the secrets */
export interface ChannelForSending {
  channel: NotificationChannel;
  type: ChannelType;
  values: ChannelValues;
}

interface ChannelRow {
  id: string;
  type: string;
  name: string;
  settings: string;
  secrets: string;
  min_severity: AlertSeverity;
  machine_ids: string | null;
  enabled: number;
  created_at: number;
}

const NOT_THERE = 'The channel is not there. Maybe someone deleted it.';

/**
 * The notification channels, in the "notification_channels" table of the SQLite database.
 * The values of the secret fields are in their own column. They are plain text, like the FTP passwords,
 * but the API never shows them: a channel tells only which secrets are saved (`hasSecret`).
 */
export class ChannelStore implements MachineRemovalListener {
  constructor(
    private readonly db: Database.Database,
    private readonly findType: (id: string) => ChannelType | undefined = findChannelType,
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notification_channels (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        settings TEXT NOT NULL,
        secrets TEXT NOT NULL,
        min_severity TEXT NOT NULL,
        machine_ids TEXT,
        enabled INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  }

  /** In the order they were added */
  list(): NotificationChannel[] {
    const rows = this.db.prepare('SELECT * FROM notification_channels ORDER BY created_at, rowid').all() as ChannelRow[];
    return rows.map(row => this.toChannel(row));
  }

  get(id: string): NotificationChannel | null {
    const row = this.row(id);
    return row ? this.toChannel(row) : null;
  }

  add(input: ChannelInput, now: number): ChannelSaveResult {
    const check = this.checkInput(input);
    if (!check.ok) return check;
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO notification_channels (id, type, name, settings, secrets, min_severity, machine_ids, enabled, created_at)
      VALUES (@id, @type, @name, @settings, @secrets, @minSeverity, @machineIds, @enabled, @createdAt)
    `).run({ id, ...toSqlParameters(input, check), createdAt: now });
    return { ok: true, channel: this.savedChannel(id) };
  }

  /** An empty secret keeps the saved secret, so the form does not need to show it. `clearSecrets` deletes secrets. */
  update(id: string, input: ChannelInput): ChannelSaveResult {
    if (!this.row(id)) return { ok: false, error: NOT_THERE };
    const check = this.checkInput(input, id);
    if (!check.ok) return check;
    this.db.prepare(`
      UPDATE notification_channels
      SET type = @type, name = @name, settings = @settings, secrets = @secrets,
          min_severity = @minSeverity, machine_ids = @machineIds, enabled = @enabled
      WHERE id = @id
    `).run({ id, ...toSqlParameters(input, check) });
    return { ok: true, channel: this.savedChannel(id) };
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM notification_channels WHERE id = ?').run(id).changes > 0;
  }

  /** Takes the machine out of each machine list. A list that becomes empty gets no alerts. */
  removeMachine(machineId: string): void {
    const update = this.db.prepare('UPDATE notification_channels SET machine_ids = ? WHERE id = ?');
    this.db.transaction(() => {
      const rows = this.db.prepare('SELECT id, machine_ids FROM notification_channels WHERE machine_ids IS NOT NULL')
        .all() as { id: string; machine_ids: string }[];
      for (const row of rows) {
        const machineIds = parseList(row.machine_ids);
        if (machineIds.includes(machineId)) update.run(JSON.stringify(machineIds.filter(id => id !== machineId)), row.id);
      }
    })();
  }

  /**
   * Checks a form, for a save or for "Send test". With `savedId`, an empty secret gets the saved secret
   * of that channel, if the type did not change.
   */
  checkInput(input: ChannelInput, savedId?: string): InputCheck {
    const type = this.findType(input.type);
    if (!type) return { ok: false, error: `Chatter does not know the channel type "${input.type}"` };
    const nameProblem = problemWithName(input.name);
    if (nameProblem) return { ok: false, error: nameProblem };
    const savedSecrets = withoutKeys(this.savedSecretsOfType(savedId, type.id), input.clearSecrets ?? []);
    const values = valuesOfType(type, input.values, savedSecrets);
    const check = type.checkSettings(values);
    return check.ok ? { ok: true, type, values } : check;
  }

  forSending(id: string): ChannelForSending | null {
    const row = this.row(id);
    const type = row && this.findType(row.type);
    if (!row || !type) return null;
    return { channel: this.toChannel(row), type, values: { ...parseValues(row.settings), ...parseValues(row.secrets) } };
  }

  /** Only right after a save, when the row is surely there */
  private savedChannel(id: string): NotificationChannel {
    const row = this.row(id);
    if (!row) throw new Error(`Channel ${id} is not in the database after the save`);
    return this.toChannel(row);
  }

  private row(id: string): ChannelRow | undefined {
    return this.db.prepare('SELECT * FROM notification_channels WHERE id = ?').get(id) as ChannelRow | undefined;
  }

  private savedSecretsOfType(savedId: string | undefined, typeId: string): ChannelValues {
    const row = savedId === undefined ? undefined : this.row(savedId);
    return row?.type === typeId ? parseValues(row.secrets) : {};
  }

  private toChannel(row: ChannelRow): NotificationChannel {
    const secrets = parseValues(row.secrets);
    const secretKeys = this.findType(row.type)?.fields.filter(field => field.kind === 'secret').map(field => field.key)
      ?? Object.keys(secrets);
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      settings: parseValues(row.settings),
      hasSecret: Object.fromEntries(secretKeys.map(key => [key, key in secrets])),
      minSeverity: row.min_severity,
      machineIds: row.machine_ids === null ? null : parseList(row.machine_ids),
      enabled: row.enabled === 1,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}

function problemWithName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Name is necessary';
  if (trimmed.length > MAX_CHANNEL_NAME_LENGTH) return `Name can have at most ${MAX_CHANNEL_NAME_LENGTH} characters`;
  return null;
}

/** Only the fields of the type. An empty secret, or one with only spaces, gets the saved secret, or else it is left out. */
function valuesOfType(type: ChannelType, values: ChannelValues, savedSecrets: ChannelValues): ChannelValues {
  const kept: ChannelValues = {};
  for (const field of type.fields) {
    const value = values[field.key];
    const isEmptySecret = field.kind === 'secret' && (value === undefined || (typeof value === 'string' && value.trim() === ''));
    if (isEmptySecret && savedSecrets[field.key] !== undefined) kept[field.key] = savedSecrets[field.key];
    else if (!isEmptySecret && value !== undefined) kept[field.key] = value;
  }
  return kept;
}

function withoutKeys(values: ChannelValues, keys: string[]): ChannelValues {
  return Object.fromEntries(Object.entries(values).filter(([key]) => !keys.includes(key)));
}

/** The secret values go in their own column */
function splitSecrets(type: ChannelType, values: ChannelValues): { settings: ChannelValues; secrets: ChannelValues } {
  const settings: ChannelValues = {};
  const secrets: ChannelValues = {};
  for (const field of type.fields) {
    if (values[field.key] === undefined) continue;
    (field.kind === 'secret' ? secrets : settings)[field.key] = values[field.key];
  }
  return { settings, secrets };
}

function toSqlParameters(input: ChannelInput, { type, values }: PassedInputCheck) {
  const { settings, secrets } = splitSecrets(type, values);
  return {
    type: type.id,
    name: input.name.trim(),
    settings: JSON.stringify(settings),
    secrets: JSON.stringify(secrets),
    minSeverity: input.minSeverity,
    machineIds: input.machineIds === null ? null : JSON.stringify([...new Set(input.machineIds)]),
    enabled: input.enabled ? 1 : 0,
  };
}

function parseValues(json: string): ChannelValues {
  return JSON.parse(json) as ChannelValues;
}

function parseList(json: string): string[] {
  return JSON.parse(json) as string[];
}
