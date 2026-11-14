import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsTable } from '../storage/settingsTable.js';
import { NotificationSettingsStore } from './NotificationSettingsStore.js';

describe('NotificationSettingsStore', () => {
  let table: SettingsTable;
  let store: NotificationSettingsStore;

  beforeEach(() => {
    table = new SettingsTable(new Database(':memory:'));
    store = new NotificationSettingsStore(table);
  });

  it('has no link address and no time zone before the first save', () => {
    expect(store.get()).toEqual({ linkBaseUrl: null, timeZone: null });
  });

  it('keeps the saved settings', () => {
    store.save({ linkBaseUrl: 'http://chatter.local:3001', timeZone: 'America/Chicago' });

    expect(new NotificationSettingsStore(table).get()).toEqual({ linkBaseUrl: 'http://chatter.local:3001', timeZone: 'America/Chicago' });
  });

  it('deletes a setting that is saved as null', () => {
    store.save({ linkBaseUrl: 'http://chatter.local:3001', timeZone: 'America/Chicago' });

    store.save({ linkBaseUrl: null, timeZone: 'America/Chicago' });

    expect(store.get()).toEqual({ linkBaseUrl: null, timeZone: 'America/Chicago' });
  });
});
