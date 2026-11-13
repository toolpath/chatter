import type Database from 'better-sqlite3';
import { createLogger } from '../logging/logger.js';
import type { MachineRemovalListener } from '../polling/poller.js';
import type { SettingsTable } from '../storage/settingsTable.js';
import { AlertChangeFinder } from './AlertChangeFinder.js';
import { AlertNotifier } from './AlertNotifier.js';
import { ChannelStore } from './ChannelStore.js';
import type { TextOptions } from './messageText.js';
import { Outbox } from './Outbox.js';
import { OutboxSender } from './OutboxSender.js';
import { moreAlertsMessage } from './outgoingMessages.js';
import { NotificationSettingsStore } from './NotificationSettingsStore.js';

const log = createLogger('notifications');

/** An alert that vmalert stops sending ends with no new request, so Chatter also looks for changes this often */
export const FIND_CHANGES_INTERVAL_MS = 60_000;
export const CLEAN_UP_INTERVAL_MS = 60 * 60_000;

export interface NotificationsOptions {
  /** Make the AlertStore first, because the finder reads its "alerts" table */
  db: Database.Database;
  settingsTable: SettingsTable;
  /** null when the machine is not there any more */
  machineName: (machineId: string) => string | null;
  now?: () => number;
  /** Tests give a fake fetch, so no test sends a real message */
  fetch?: typeof globalThis.fetch;
}

/**
 * All the parts of the notifications together: alert changes → the messages of each channel → the outbox → the services.
 * The routes use `channels`, `outbox` and `settings`.
 */
export class Notifications implements MachineRemovalListener {
  readonly channels: ChannelStore;
  readonly outbox: Outbox;
  readonly settings: NotificationSettingsStore;
  private readonly finder: AlertChangeFinder;
  private readonly sender: OutboxSender;
  private readonly now: () => number;
  private timers: NodeJS.Timeout[] = [];

  constructor({ db, settingsTable, machineName, now = Date.now, fetch }: NotificationsOptions) {
    this.now = now;
    this.settings = new NotificationSettingsStore(settingsTable);
    this.channels = new ChannelStore(db);
    this.outbox = new Outbox(db, count => moreAlertsMessage(count, this.textOptions()));
    const notifier = new AlertNotifier({
      channels: this.channels, outbox: this.outbox, machineName, textOptions: () => this.textOptions(), now,
    });
    this.finder = new AlertChangeFinder(db, notifier, now());
    this.sender = new OutboxSender(this.outbox, this.channels, { now, fetch });
  }

  start(): void {
    if (this.timers.length > 0) return;
    this.findAlertChanges();
    this.cleanUp();
    this.sender.start();
    this.timers = [
      setInterval(() => this.findAlertChanges(), FIND_CHANGES_INTERVAL_MS),
      setInterval(() => this.cleanUp(), CLEAN_UP_INTERVAL_MS),
    ];
  }

  /** Waits for the messages that are being sent, so their results are saved before the database closes */
  async stop(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    await this.sender.stop();
  }

  /** Queues the messages of the alerts that started or ended. Call it after each save of the alerts. */
  findAlertChanges(): void {
    try {
      this.finder.findChanges(this.now());
    } catch (error) {
      log.error('Could not find the alert changes. Chatter tries again in one minute', { error });
    }
  }

  /** Sends the due messages now. The timer does this every 5 seconds. */
  sendDue(): Promise<void> {
    return this.sender.sendDue();
  }

  /** Also deletes the messages of the channel that still wait */
  removeChannel(id: string): boolean {
    this.outbox.removeChannel(id);
    return this.channels.remove(id);
  }

  removeMachine(machineId: string): void {
    this.channels.removeMachine(machineId);
    this.outbox.removeMachine(machineId);
  }

  textOptions(): TextOptions {
    return this.settings.get();
  }

  private cleanUp(): void {
    try {
      this.outbox.cleanUp(this.now());
    } catch (error) {
      log.error('Could not delete the old notification messages', { error });
    }
  }
}
