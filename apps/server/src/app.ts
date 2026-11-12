import { Hono } from 'hono';
import type { HardwarePoller } from './polling/poller.js';
import type { HistorySource } from './recording/MetricsReader.js';
import { StatePeriodStore } from './recording/StatePeriodStore.js';
import { MachineChangeFeed } from './realtime/MachineChangeFeed.js';
import { machineEventRoutes } from './realtime/machineEvents.js';
import { machineRoutes } from './routes/machines.js';
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
import type { Auth } from './auth/Auth.js';
import { authRoutes, requireLogin } from './auth/authRoutes.js';
import { sessionRoutes } from './auth/sessionRoutes.js';
import { LoginLimiter } from './auth/LoginLimiter.js';
import { LoginLog } from './auth/loginLog.js';
import { ProxySettings } from './auth/proxySettings.js';
import { proxySettingsRoutes } from './routes/proxySettings.js';
import { loginSettingsRoutes } from './routes/loginSettings.js';
import type { UserAccounts } from './auth/userAccounts.js';
import { userSettingsRoutes } from './routes/userSettings.js';
import { focasThread } from './machines/fanuc/focasThread.js';
import { FocasLibraryInstaller } from './machines/fanuc/focasLibraryInstaller.js';
import { focasLibraryRoutes } from './routes/focasLibrary.js';
import { chatterVersion } from './updates/chatterVersion.js';
import { UpdateFolder } from './updates/UpdateFolder.js';
import { UpdateService } from './updates/UpdateService.js';
import { memoryCheckSettingStore, ReleaseWatcher, releasesRepo } from './updates/ReleaseWatcher.js';
import { updateRoutes } from './routes/updates.js';

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
  focasLibrary = new FocasLibraryInstaller(focasThread, () => poller.startFanucMachines()),
  version = chatterVersion(),
  updates = new UpdateService(UpdateFolder.fromEnvironment(), version, new ReleaseWatcher({ repo: releasesRepo(), store: memoryCheckSettingStore() })),
}: AppParts) {
  const loginGuard = { auth, limiter: new LoginLimiter(), loginLog, proxySettings };
  const api = new Hono()
    // The update helper reads the version here, with no login, to see that the new version runs
    .get('/health', c => c.json({ status: 'ok', uptime: process.uptime(), version }))
    .route('/', authRoutes(loginGuard))
    .route('/', sessionRoutes(auth))
    // Every route below needs a login
    .use(requireLogin(loginGuard))
    .get('/status', c => c.json(poller.getStatus()))
    .route('/', machineRoutes(poller))
    .route('/', discoveryRoutes(poller))
    .route('/', machineFileRoutes(poller))
    .route('/', uploadHistoryRoutes())
    .route('/', historyRoutes(poller, history, statePeriods))
    .route('/', reportRoutes(poller, history, statePeriods))
    .route('/', alertRoutes(alerts))
    .route('/', alertRuleRoutes(poller, alertRules))
    .route('/', machineEventRoutes(new MachineChangeFeed(poller)))
    .route('/', proxySettingsRoutes(proxySettings))
    .route('/', loginSettingsRoutes(loginGuard))
    .route('/', userSettingsRoutes(accounts))
    .route('/', focasLibraryRoutes(focasLibrary))
    .route('/', updateRoutes(updates));

  // No CORS headers: only pages from this server can call the API from a browser
  return new Hono()
    .onError(errorReply)
    .notFound(c => c.json({ error: 'Not found' }, 404))
    .route(API_PREFIX, api);
}

/** The routes and their types, for the typed web client (hono/client) */
export type AppType = ReturnType<typeof createApp>;
