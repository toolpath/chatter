import type { NotificationSettings } from '@local-chatter/shared';
import type { SettingsTable } from '../storage/settingsTable.js';

const LINK_KEY = 'notifications.link_base_url';
const TIME_ZONE_KEY = 'notifications.time_zone';

/** The settings of all the notifications, in the "settings" table. A setting that is not saved is null. */
export class NotificationSettingsStore {
  constructor(private readonly table: SettingsTable) {}

  get(): NotificationSettings {
    return { linkBaseUrl: this.table.get(LINK_KEY) ?? null, timeZone: this.table.get(TIME_ZONE_KEY) ?? null };
  }

  save({ linkBaseUrl, timeZone }: NotificationSettings): void {
    const saved: Record<string, string> = {};
    const deleted: string[] = [];
    for (const [key, value] of [[LINK_KEY, linkBaseUrl], [TIME_ZONE_KEY, timeZone]] as const) {
      if (value === null) deleted.push(key);
      else saved[key] = value;
    }
    this.table.set(saved);
    this.table.delete(deleted);
  }
}
