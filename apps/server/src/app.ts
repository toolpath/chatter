import path from 'node:path';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { HardwarePoller } from './polling/poller.js';
import type { HistorySource } from './recording/MetricsReader.js';
import { StatePeriodStore } from './recording/StatePeriodStore.js';
import { MachineChangeFeed } from './realtime/MachineChangeFeed.js';
import { machineEventRoutes } from './realtime/machineEvents.js';
import { machineRoutes, machinesForRoleOf } from './routes/machines.js';
import { discoveryRoutes } from './routes/discovery.js';
import { machineFileRoutes } from './routes/machineFiles.js';
import { uploadHistoryRoutes } from './routes/uploadHistory.js';
import { historyRoutes } from './routes/history.js';
import { alertRoutes } from './routes/alerts.js';
import { alertRuleRoutes } from './routes/alertRules.js';
import { AlertRuleService } from './alert-rules/AlertRuleService.js';
import { reportRoutes } from './routes/reports.js';
import { AlertStore } from './alerts/AlertStore.js';
import { errorReply } from './routes/responses.js';
import { securityHeaders } from './securityHeaders.js';
import type { Auth } from './auth/Auth.js';
import { authRoutes, isStillLoggedIn, loginOf, requireLogin } from './auth/authRoutes.js';
import { sessionRoutes } from './auth/sessionRoutes.js';
import { LoginLimiter } from './auth/LoginLimiter.js';
import { LoginLog } from './auth/loginLog.js';
import { ProxySettings } from './auth/proxySettings.js';
import { proxySettingsRoutes } from './routes/proxySettings.js';
import { loginSettingsRoutes } from './routes/loginSettings.js';
import type { UserAccounts } from './auth/userAccounts.js';
import { userSettingsRoutes } from './routes/userSettings.js';
import { focasThreads } from './machines/fanuc/focasThread.js';
import { FocasLibraryInstaller } from './machines/fanuc/focasLibraryInstaller.js';
import { focasLibraryRoutes } from './routes/focasLibrary.js';
import { chatterVersion } from './updates/chatterVersion.js';
import { UpdateFolder } from './updates/UpdateFolder.js';
import { UpdateService } from './updates/UpdateService.js';
import { memoryCheckSettingStore, ReleaseWatcher, releasesRepo } from './updates/ReleaseWatcher.js';
import { updateRoutes } from './routes/updates.js';
import { Notifications } from './notifications/Notifications.js';
import { notificationRoutes } from './routes/notifications.js';
import { auditLog } from './logging/audit.js';
import { ServerLog } from './logging/ServerLog.js';
import { logRoutes } from './routes/logs.js';
import { ConnectionLog } from './logging/ConnectionLog.js';
import { machineHealthRoutes, type ConnectionHealthSource } from './routes/machineHealth.js';
import { systemRoutes, type SystemOptions } from './routes/system.js';
import { supportBundleRoutes } from './routes/supportBundle.js';
import { dataFolder } from './storage/database.js';
import { INSTANCE_ID } from './diagnostics/instance.js';
import { HistoryBackup } from './history-backup/HistoryBackup.js';
import { VictoriaHistory } from './history-backup/victoriaHistory.js';
import { historyBackupRoutes } from './routes/historyBackup.js';

/** Every API address starts with this */
export const API_PREFIX = '/api';

export interface AppParts {
  poller: HardwarePoller;
  auth: Auth;
  /** What an admin does on the Users and roles tab */
  accounts: UserAccounts;
  /** Where the machine history is read from */
  history: HistorySource;
  /** When the program, alarm, mode, run state and tool changed. Without it, they are kept in memory only. */
  statePeriods?: StatePeriodStore;
  /** The alerts that vmalert sent. Without it, they are kept in memory only. */
  alerts?: AlertStore;
  /** The alert rules of the machines. Without it, they are kept in memory only, and no vmalert file is written. */
  alertRules?: AlertRuleService;
  /** The reverse proxies to believe. Without it, ChatterBox believes none, and a change is not saved. */
  proxySettings?: ProxySettings;
  /** The last password tries. Without it, the log is kept in memory only. */
  loginLog?: LoginLog;
  /** Saves and loads an uploaded FANUC FOCAS2 library. Without it, the real FOCAS loader is used. */
  focasLibrary?: FocasLibraryInstaller;
  /** The version of this Chatter. Without it, the version comes from CHATTER_VERSION. */
  version?: string;
  /** Updates on the Pi card. Without it, the update folder comes from CHATTER_UPDATE_FOLDER, and nothing asks GitHub until the Admin does. */
  updates?: UpdateService;
  /** The messages that go out when an alert starts or ends. Without it, the channels are kept in memory only. */
  notifications?: Notifications;
  /** The last lines of the server log, for Settings > Diagnostics. Without it, the lines are not kept. */
  serverLog?: ServerLog;
  /** The connection changes of each machine, for its health panel. Without it, the panel shows none. */
  connections?: ConnectionHealthSource;
  /** How Chatter restarts itself, and if it runs in Docker. Without it, the real process and computer. */
  system?: Omit<SystemOptions, 'version'>;
  /** The health addresses of VictoriaMetrics and vmalert, for the support bundle */
  historyHealthUrls?: Record<string, string>;
  /** The backup and restore of the history of one machine. Without it, the files go to data/history-backup. */
  historyBackup?: HistoryBackup;
}

/**
 * Make the web server and its /api routes.
 * The caller gives the parts, so tests can give their own.
 * Only /api/health and /api/auth work without a login. Some routes also need a role (see roles.ts in the shared package).
 */
export function createApp({
  poller,
  auth,
  accounts,
  history,
  statePeriods = StatePeriodStore.inMemory(),
  alerts = AlertStore.inMemory(),
  alertRules = AlertRuleService.inMemory(),
  proxySettings = ProxySettings.inMemory(),
  loginLog = LoginLog.inMemory(),
  focasLibrary = new FocasLibraryInstaller(focasThreads, () => poller.startFanucMachines()),
  version = chatterVersion(),
  updates = new UpdateService(UpdateFolder.fromEnvironment(), version, new ReleaseWatcher({ repo: releasesRepo(), store: memoryCheckSettingStore() })),
  notifications = Notifications.inMemory(),
  historyBackup = new HistoryBackup({
    // Read at the first backup, from DATABASE_PATH
    folder: historyBackupFolder, history: new VictoriaHistory(DEFAULT_VICTORIA_METRICS_URL), statePeriods, alertRules, version,
  }),
  ...diagnostics
}: AppParts) {
  const loginGuard = { auth, limiter: new LoginLimiter(), loginLog, proxySettings };
  const api = new Hono()
    // The update helper reads the version here, with no login, to see that the new version runs
    .get('/health', c => c.json({ status: 'ok', uptime: process.uptime(), version, instance: INSTANCE_ID }))
    .route('/', authRoutes(loginGuard))
    .route('/', sessionRoutes(loginGuard))
    // Every route below needs a login
    .use(requireLogin(loginGuard))
    // Each request below that can change something goes in the audit log, with its user and its final status
    .use(auditLog(proxySettings))
    .get('/status', c => c.json(machinesForRoleOf(c, poller.getStatus())))
    .route('/', machineRoutes(poller))
    .route('/', discoveryRoutes(poller))
    .route('/', machineFileRoutes(poller, proxySettings))
    .route('/', uploadHistoryRoutes())
    .route('/', historyRoutes(poller, history, statePeriods))
    .route('/', reportRoutes(poller, history, statePeriods))
    .route('/', historyBackupRoutes(poller, historyBackup))
    .route('/', alertRoutes(alerts))
    .route('/', alertRuleRoutes(poller, alertRules))
    .route('/', machineEventRoutes(new MachineChangeFeed(poller), c => loginOf(c, auth), c => isStillLoggedIn(c, auth)))
    .route('/', proxySettingsRoutes(proxySettings))
    .route('/', loginSettingsRoutes(loginGuard))
    .route('/', userSettingsRoutes(accounts))
    .route('/', focasLibraryRoutes(focasLibrary))
    .route('/', updateRoutes(updates))
    .route('/', notificationRoutes(notifications))
    .route('/', diagnosticRoutes({ poller, updates, version, notifications }, diagnostics));

  // No CORS headers: only pages from this server can call the API from a browser
  // The security headers also go on the web app routes that index.ts adds after these
  return new Hono()
    .use(securityHeaders())
    .use(`${API_PREFIX}/*`, noStore)
    .onError(errorReply)
    .notFound(c => c.json({ error: 'Not found' }, 404))
    .route(API_PREFIX, api);
}

/**
 * No cache keeps an API reply. A reply can set the login cookie again (markSessionSeen in authRoutes.ts),
 * so a shared cache in a proxy must not give that reply to other browsers. The data of the API also changes all the time.
 * This replaces the no-cache of the live event streams, because they can also set the cookie again.
 */
const noStore = createMiddleware(async (c, next) => {
  await next();
  c.res.headers.set('Cache-Control', 'no-store');
});

/** Settings > Diagnostics and the health of the machines: the log, the restarts, the connection test */
function diagnosticRoutes(
  { poller, updates, version, notifications }: { poller: HardwarePoller; updates: UpdateService; version: string; notifications: Notifications },
  {
    serverLog = new ServerLog(), connections = new ConnectionLog(), system = {}, historyHealthUrls = DEFAULT_HISTORY_HEALTH_URLS,
  }: Pick<AppParts, 'serverLog' | 'connections' | 'system' | 'historyHealthUrls'>,
) {
  return new Hono()
    .route('/', machineHealthRoutes(poller, connections))
    .route('/', logRoutes(serverLog))
    .route('/', systemRoutes(updates, { ...system, version }))
    .route('/', supportBundleRoutes({
      version, serverLog, connections, updates, historyHealthUrls,
      // Read at the time of the bundle, from DATABASE_PATH
      dataFolder: () => dataFolder(),
      machines: () => poller.getMachines(),
      channels: () => notifications.channels.list(),
      messages: () => notifications.outbox.list({ since: Date.now() - BUNDLE_MESSAGE_DAYS * DAY_MS }),
    }));
}

/** The support bundle has the newest notification messages of this many days */
const BUNDLE_MESSAGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60_000;

/** VictoriaMetrics in development. docker-compose.yml gives the address on the internal network "history". */
const DEFAULT_VICTORIA_METRICS_URL = process.env.VICTORIA_METRICS_URL || 'http://localhost:8428';

/** The folder for the files of a history backup or restore, in the data volume. Chatter deletes it at each start. */
export function historyBackupFolder(): string {
  return path.join(dataFolder(), 'history-backup');
}

/** VictoriaMetrics and vmalert in development. docker-compose.yml gives the addresses on the internal network "history". */
const DEFAULT_HISTORY_HEALTH_URLS = {
  victoriaMetrics: `${DEFAULT_VICTORIA_METRICS_URL}/health`,
  vmalert: `${process.env.VMALERT_URL || 'http://localhost:8880'}/health`,
};

/** The routes and their types, for the typed web client (hono/client) */
export type AppType = ReturnType<typeof createApp>;
