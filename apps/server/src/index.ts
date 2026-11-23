import 'dotenv/config';
import path from 'path';
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { createApp, historyBackupFolder } from './app.js';
import { HistoryBackup } from './history-backup/HistoryBackup.js';
import { VictoriaHistory } from './history-backup/victoriaHistory.js';
import { startWebServer } from './webServerOptions.js';
import { webAppRoutes } from './webApp.js';
import { HardwarePoller } from './polling/poller.js';
import { MetricsWriter } from './recording/MetricsWriter.js';
import { MetricsReader } from './recording/MetricsReader.js';
import { StatePeriodStore } from './recording/StatePeriodStore.js';
import { StatePeriodRecorder } from './recording/StatePeriodRecorder.js';
import { AlertRuleService } from './alert-rules/AlertRuleService.js';
import { AlertRuleStore } from './alert-rules/AlertRuleStore.js';
import { RulesFileWriter } from './alert-rules/rulesFile.js';
import { VmalertClient } from './alert-rules/VmalertClient.js';
import { VictoriaQueryChecker } from './alert-rules/QueryChecker.js';
import { AlertStore } from './alerts/AlertStore.js';
import { alertReceiverApp } from './alerts/alertReceiverApp.js';
import { VmalertAlertSync } from './alerts/VmalertAlertSync.js';
import { Notifications } from './notifications/Notifications.js';
import { TWILIO_ADDRESS } from './notifications/channels/index.js';
import { getDb, initDatabase, closeDatabase, dataFolder } from './storage/database.js';
import { Focas } from './machines/fanuc/focas.js';
import { focasThreads } from './machines/fanuc/focasThread.js';
import { useSinumerikCertificateFolder } from './machines/siemens/sinumerikClient.js';
import { Auth } from './auth/Auth.js';
import { SessionStore } from './auth/sessionStore.js';
import { UserAccounts } from './auth/userAccounts.js';
import { UserStore } from './auth/userStore.js';
import { ProxySettings, sqliteProxySettingStore } from './auth/proxySettings.js';
import { LoginLog } from './auth/loginLog.js';
import { DEVICE_KEY_FILE, loadDeviceKey } from './auth/deviceCookie.js';
import { SettingsTable } from './storage/settingsTable.js';
import { UpdateFolder } from './updates/UpdateFolder.js';
import { UpdateService } from './updates/UpdateService.js';
import { chatterVersion } from './updates/chatterVersion.js';
import { ReleaseWatcher, releasesRepo, sqliteCheckSettingStore } from './updates/ReleaseWatcher.js';
import { createLogger } from './logging/logger.js';
import { ConnectionLog } from './logging/ConnectionLog.js';
import { startServerLog } from './logging/startServerLog.js';
import { writeAudit } from './logging/audit.js';

const log = createLogger('server');

const PORT = Number(process.env.PORT) || 3001;
/** The built web app. The Docker image sets it. In development, Vite serves the web app instead. */
const WEB_DIR = process.env.WEB_DIR;
/**
 * The reverse proxies whose X-Forwarded-For and X-Forwarded-Proto headers count, for example "127.0.0.1".
 * When it is set, it wins over the list in Settings.
 */
const TRUST_PROXY = process.env.TRUST_PROXY;
/** Where the machine history is saved. docker-compose.yml sets it. "npm run dev:history" starts one on this address. */
const VICTORIA_METRICS_URL = process.env.VICTORIA_METRICS_URL || 'http://localhost:8428';
/**
 * vmalert sends its alerts to this port. It has no login, so only vmalert must reach it.
 * By default only this computer can reach it. docker-compose.yml sets ALERT_HOST to 0.0.0.0 and does not publish the port.
 */
const ALERT_PORT = Number(process.env.ALERT_PORT) || 3002;
const ALERT_HOST = process.env.ALERT_HOST || '127.0.0.1';
/** Chatter writes the vmalert file of the alert rules in this folder. vmalert reads every .yml file in it. */
const ALERT_RULES_DIR = process.env.ALERT_RULES_DIR || path.join(dataFolder(), 'alert-rules');
/** Chatter asks vmalert here to read the rules file again. vmalert has no login, so it must stay on the inside network. */
const VMALERT_URL = process.env.VMALERT_URL || 'http://localhost:8880';

/**
 * The last lines of the log, in memory and in data/logs, for Settings > Diagnostics.
 * An error that nothing caught is logged. Then Chatter stops, and Docker starts it again.
 */
const { serverLog } = startServerLog(dataFolder());

async function start(): Promise<void> {
  try {
    await initDatabase();

    // An admin can upload the FANUC FOCAS2 library in the web app. It is kept with the database.
    Focas.useUploadFolder(path.join(dataFolder(), 'focas'));
    // The client certificate for Siemens controls. The operator trusts it on each control, so it must survive updates.
    useSinumerikCertificateFolder(path.join(dataFolder(), 'opcua-pki'));
    const poller = new HardwarePoller(getDb());
    await poller.loadFromDatabase();

    // The machine values over time (for the charts)
    const metrics = new MetricsWriter({ url: VICTORIA_METRICS_URL });
    poller.addRecorder(metrics);
    metrics.start();
    log.info('Machine history saved in VictoriaMetrics', { url: VICTORIA_METRICS_URL });
    // One log line when a machine connects, goes offline, comes back, or reports a new problem
    const connections = new ConnectionLog(undefined, undefined, id => poller.isConnecting(id));
    poller.addRecorder(connections);
    // The program, alarm, mode, run state and tool are text, so they are saved in SQLite
    const statePeriods = new StatePeriodStore(getDb());
    const stateRecorder = new StatePeriodRecorder(statePeriods);
    poller.addRecorder(stateRecorder);
    // The alerts of vmalert
    const alerts = new AlertStore(getDb(), Date.now());
    poller.addRemovalListener(alerts);
    const settings = new SettingsTable(getDb());
    // The messages that go out when an alert starts or ends, for example a text message or a Slack post
    const notifications = new Notifications({
      db: getDb(), settingsTable: settings, machineName: machineId => poller.getMachine(machineId)?.name ?? null,
    });
    poller.addRemovalListener(notifications);
    notifications.start();
    // vmalert does not send again a resolve that Chatter could not get, for example during a restart
    const alertSync = new VmalertAlertSync({ url: VMALERT_URL, store: alerts, afterSync: () => notifications.findAlertChanges() });
    alertSync.start();
    // The alert rules of each machine. Chatter writes them to a file that vmalert reads.
    const alertRules = new AlertRuleService({
      store: new AlertRuleStore(getDb()),
      rulesFile: new RulesFileWriter(ALERT_RULES_DIR),
      vmalert: new VmalertClient({ url: VMALERT_URL }),
      queries: new VictoriaQueryChecker({ url: VICTORIA_METRICS_URL }),
    });
    await alertRules.addStarterRulesOnFirstStart(poller.getMachines().map(machine => machine.id));
    poller.addAddListener(alertRules);
    poller.addRemovalListener(alertRules);
    // At each start, so the file matches the saved rules, also after an update
    void alertRules.publish();
    log.info('Alert rules written', { folder: ALERT_RULES_DIR, vmalert: VMALERT_URL });

    const users = new UserStore(getDb());
    const sessions = new SessionStore(getDb());
    // The key file is in the data volume, so the known browsers stay known after an update
    const auth = new Auth(users, sessions, loadDeviceKey(path.join(dataFolder(), DEVICE_KEY_FILE)));
    const accounts = new UserAccounts(users, sessions);
    const proxySettings = new ProxySettings(sqliteProxySettingStore(settings), TRUST_PROXY);
    if (proxySettings.addresses.length > 0) log.info('Trusted reverse proxies', { addresses: proxySettings.addresses.join(', ') });
    const history = new MetricsReader({ url: VICTORIA_METRICS_URL });
    // On the Pi card, an update file that did not finish before a stop is deleted
    const updateFolder = UpdateFolder.fromEnvironment();
    await updateFolder.removeLeftovers();
    const version = chatterVersion();
    // The backup and restore of the history of one machine. A backup or a restore that a stop cut off leaves files.
    const historyBackup = new HistoryBackup({
      folder: historyBackupFolder(), history: new VictoriaHistory(VICTORIA_METRICS_URL), statePeriods, alertRules, version,
    });
    await historyBackup.removeLeftovers();
    log.info('Chatter started', { version, logLevel: process.env.LOG_LEVEL || 'info' });
    // The audit log tells each start, so a gap in the lines has a reason
    writeAudit('Chatter started', { version });
    if (TWILIO_ADDRESS.warning) log.warn(TWILIO_ADDRESS.warning);
    // Asks GitHub once a day for the newest release, while the Admin has the check on (the default)
    const releases = new ReleaseWatcher({ repo: releasesRepo(), store: sqliteCheckSettingStore(settings) });
    releases.start();
    const updates = new UpdateService(updateFolder, version, releases);
    const app = createApp({
      poller, auth, accounts, history, statePeriods, alerts, alertRules, proxySettings, loginLog: new LoginLog(getDb()), version, updates,
      notifications, serverLog, connections, historyBackup,
      historyHealthUrls: { victoriaMetrics: `${VICTORIA_METRICS_URL}/health`, vmalert: `${VMALERT_URL}/health` },
    });
    if (WEB_DIR) app.route('/', webAppRoutes(WEB_DIR));
    // A large upload gets a long time limit. Each other request gets a short one.
    const server = startWebServer(app, PORT, {
      onListening: () => {
        log.info('Server running', { url: `http://localhost:${PORT}`, webApp: WEB_DIR, liveEvents: '/api/events' });
        poller.start();
      },
    });
    const receiver = alertReceiverApp(alerts, {
      isKnownMachine: machineId => poller.getMachine(machineId) !== null,
      afterSave: () => notifications.findAlertChanges(),
    });
    const alertServer = serve({ fetch: receiver.fetch, port: ALERT_PORT, hostname: ALERT_HOST }, () => {
      log.info('Alerts from vmalert received', { url: `http://${ALERT_HOST}:${ALERT_PORT}/api/v2/alerts` });
    }) as Server;
    // Without this, a port that is in use stops the whole server
    alertServer.on('error', error => {
      log.error('Could not listen for alerts. Chatter runs, but it gets no alerts', { host: ALERT_HOST, port: ALERT_PORT, error });
    });

    const shutDown = async () => {
      log.info('Shutting down');
      poller.stop();
      // After poller.stop(), so the disconnects it sent end first. It takes at most a few seconds.
      const focasStopped = focasThreads.shutDown();
      releases.stop();
      alertSync.stop();
      alertServer.close();
      alertServer.closeAllConnections();
      await notifications.stop();
      await metrics.stop();
      try {
        stateRecorder.stop();
      } catch (error) {
        log.error('Could not end the open machine states', { error });
      }
      await focasStopped;
      await closeDatabase();
      await serverLog.close();
      server.close(() => process.exit(0));
      // The live event streams stay open until they are closed
      server.closeAllConnections();
    };
    // Ctrl+C sends SIGINT. "docker stop" sends SIGTERM.
    process.once('SIGINT', shutDown);
    process.once('SIGTERM', shutDown);
  } catch (error) {
    log.error('Failed to start server', { error });
    process.exit(1);
  }
}

start();
