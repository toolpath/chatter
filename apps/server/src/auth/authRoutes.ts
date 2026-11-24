import { newPasswordProblem, roleCan, type Permission } from '@local-chatter/shared';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { checkedJson } from '../routes/checks.js';
import { changePasswordSchema, logInSchema, setUpSchema } from '../routes/schemas.js';
import type { Auth, CurrentUser, Login, UserSession } from './Auth.js';
import { LOCK_MINUTES, MAX_LOGGED_UNKNOWN_USERS, type LoginLimiter } from './LoginLimiter.js';
import type { LoginLog, LoginResult } from './loginLog.js';
import type { ProxySettings } from './proxySettings.js';
import type { RequestOrigin } from './proxyTrust.js';
import { hostOfRequest, isLocalHost, LOCAL_SETUP_ONLY } from './localHost.js';
import { originOf } from './requestOrigin.js';
import { SESSION_LIFETIME_SECONDS, type SessionClient } from './sessionStore.js';
import { UsernameTakenError } from './userStore.js';
import { usernameForLog } from './unknownUsername.js';
import { cutValue, writeAudit, writeAuditAndLog } from '../logging/audit.js';
import { createLogger } from '../logging/logger.js';

const log = createLogger('auth');

/**
 * Log in, log out, and the first-run account setup.
 * A browser keeps its login in a cookie.
 * A program sends the username and password with each request (HTTP Basic: "Authorization: Basic <base64 of name:password>").
 */

export const SESSION_COOKIE = 'chatterbox_session';
/** The cookie goes with each request to Chatter, for the API and for the pages */
const SESSION_COOKIE_PATH = '/';
/** Tells that this browser logged in as the user before. See deviceCookie.ts. */
export const DEVICE_COOKIE = 'chatterbox_device';
/** Only the login routes read the device cookie, so the browser sends it nowhere else */
const DEVICE_COOKIE_PATH = '/api/auth';
/**
 * 400 days: longer than the session (1 year), so the browser is still known when its session ends and the user
 * must log in again. Each login gives a new cookie. Browsers keep a cookie for at most 400 days (RFC 6265bis),
 * so a longer value has no effect.
 */
const DEVICE_COOKIE_LIFETIME_SECONDS = 400 * 24 * 60 * 60;
// The scheme name ignores case (RFC 7235)
const BASIC = /^basic\s+([A-Za-z0-9+/=]+)\s*$/i;
/** The one reply for each setup that Chatter refuses with 409, so the reply does not tell which usernames exist */
const SETUP_CLOSED = 'The setup is closed. Ask an Admin for an account.';
/** Longer than any username and password that the setup allows */
const MAX_BASIC_LENGTH = 512;

/** The username and password of an "Authorization: Basic" header, or null */
function basicLogin(header: string | undefined): Login | null {
  const encoded = BASIC.exec(header ?? '')?.[1];
  if (!encoded || encoded.length > MAX_BASIC_LENGTH) return null;
  const credentials = Buffer.from(encoded, 'base64').toString('utf8');
  // Only the first colon splits: a password can have colons in it, but a username cannot
  const colonIndex = credentials.indexOf(':');
  if (colonIndex < 0) return null;
  return { username: credentials.slice(0, colonIndex), password: credentials.slice(colonIndex + 1) };
}

/** After requireLogin, each route can read the user who sent the request: c.var.user */
export type LoggedInEnv = { Variables: { user: CurrentUser } };

/** What the login checks need */
export interface LoginGuard {
  auth: Auth;
  limiter: LoginLimiter;
  loginLog: LoginLog;
  proxySettings: ProxySettings;
}

/** The valid session of the browser that sent the request, with the token of its cookie */
export interface CheckedSession {
  session: UserSession;
  token: string;
}

/** The session of the browser that sent the request and the token that was checked, or null */
export function checkedSession(c: Context, auth: Auth): CheckedSession | null {
  const token = getCookie(c, SESSION_COOKIE);
  const session = token === undefined ? null : auth.sessionOf(token);
  return session && token !== undefined ? { session, token } : null;
}

/** The session of the browser that sent the request, or null */
export function currentSession(c: Context, auth: Auth): UserSession | null {
  return checkedSession(c, auth)?.session ?? null;
}

/**
 * The login of a request after requireLogin, as a key: the session of a browser, or the user of a program.
 * A program sends its password with each request (HTTP Basic), so it has no session.
 */
export function loginOf(c: Context<LoggedInEnv>, auth: Auth): string {
  const session = currentSession(c, auth);
  return session ? `session:${session.id}` : `user:${c.var.user.username}`;
}

/** The browser that logs in, as the list of sessions shows it */
function clientOf(c: Context, origin: RequestOrigin): SessionClient {
  return { userAgent: c.req.header('User-Agent') ?? '', address: origin.address };
}

/** Set the login cookie. A new login keeps it SESSION_LIFETIME_SECONDS. A cookie that is set again keeps it only the time left. */
function setSessionCookie(c: Context, origin: RequestOrigin, token: string, maxAge = SESSION_LIFETIME_SECONDS): void {
  setCookie(c, SESSION_COOKIE, token, {
    // Page scripts cannot read it, and other sites cannot send it with a form
    httpOnly: true,
    sameSite: 'Lax',
    // The browser sends it only over HTTPS, when the browser used HTTPS to log in
    secure: origin.isHttps,
    path: SESSION_COOKIE_PATH,
    maxAge,
  });
}

/** The device ID of a valid device cookie of this browser for this username, or undefined */
export function knownDevice(c: Context, auth: Auth, username: string): string | undefined {
  return auth.knownDeviceOf(getCookie(c, DEVICE_COOKIE), username) ?? undefined;
}

/** Remember this browser as a known device of the user, with a new device ID */
export function setDeviceCookie(c: Context, auth: Auth, origin: RequestOrigin, username: string): void {
  const value = auth.deviceCookieFor(username);
  if (value === null) return;
  setCookie(c, DEVICE_COOKIE, value, {
    httpOnly: true,
    // Only Chatter's own pages send it, also for a link from another site
    sameSite: 'Strict',
    secure: origin.isHttps,
    path: DEVICE_COOKIE_PATH,
    maxAge: DEVICE_COOKIE_LIFETIME_SECONDS,
  });
}

/** Give the browser its session cookie and its device cookie, and tell it that it is logged in */
function replyLoggedIn(c: Context, auth: Auth, origin: RequestOrigin, token: string, username: string) {
  setSessionCookie(c, origin, token);
  setDeviceCookie(c, auth, origin, username);
  return c.json({ loggedIn: true });
}

export const logInFirst = (c: Context) => c.json({ error: 'Log in first' }, 401);
const tooManyTries = (c: Context) =>
  c.json({
    error: `Too many wrong passwords. Try again in up to ${LOCK_MINUTES} minutes, or ask an Admin to unlock you in Settings > Logins.`,
  }, 429);
/** The audit log tells the address of each setup that Chatter refuses, but not the username, which a person can mistype */
function setUpClosed(c: Context, origin: RequestOrigin) {
  writeAudit('First-run setup refused', { address: origin.address });
  return c.json({ error: SETUP_CLOSED }, 409);
}

/**
 * Stops a first-run setup at a host that is not local, before Chatter reads the body. See localHost.ts.
 * After the setup, the check stops, and each setup gets the closed-setup reply (409), at each host.
 * 403, not 421 (Misdirected Request): a browser can send a request again after a 421, also a POST.
 * Only the audit log tells a refused setup, as setUpClosed does, so that a flood of requests cannot fill the server log.
 */
function setUpAtLocalHostOnly(auth: Auth, proxySettings: ProxySettings) {
  return createMiddleware(async (c, next) => {
    const host = hostOfRequest(c.req.header('Host'), c.req.url);
    if (auth.isSetUp() || isLocalHost(host)) return next();
    writeAudit('First-run setup refused at a host that is not local', {
      address: originOf(c, proxySettings).address, host: cutValue(host),
    });
    return c.json({ error: LOCAL_SETUP_ONLY }, 403);
  });
}

const wrongLogin = (c: Context) => c.json({ error: 'Wrong username or password' }, 401);

type Checked<Value> = { ok: true; value: Value } | { ok: false; reply: Response };

/** One try to prove who the caller is, with a password */
interface PasswordTry<Value> {
  username: string;
  /** The device ID of a valid device cookie for this username. Its tries count only for that device. */
  device?: string;
  /** What the login log says when the password is right */
  success: Extract<LoginResult, 'logged-in' | 'password-changed'>;
  /** Gives null for a wrong username or password */
  check: () => Promise<Value | null>;
}

/** Check a password from the caller. Each try counts against the caller's address and the username, and goes in the login log. */
async function withPasswordCheck<Value>(
  c: Context,
  { auth, limiter, loginLog }: LoginGuard,
  { address }: RequestOrigin,
  { username, device, success, check }: PasswordTry<Value>,
): Promise<Checked<Value>> {
  const recordTry = (result: LoginResult) => {
    const shown = usernameForLog(auth, username);
    logTry(limiter, { username: shown, address, result, device });
    withoutFailing('[Login log] Could not save a login try', () => loginLog.record({ username: shown, address, result }));
  };
  if (limiter.isBlocked(address, username, device)) {
    if (limiter.isFirstBlockedTry(address, username, device)) recordTry('locked');
    return { ok: false, reply: tooManyTries(c) };
  }
  // Count the try before the slow check, so tries sent at the same time cannot all get past the block
  limiter.recordAttempt(address, username, device);
  const value = await check();
  if (value === null) {
    recordTry(auth.hasUser(username) ? 'wrong-password' : 'no-such-user');
    return { ok: false, reply: wrongLogin(c) };
  }
  limiter.recordSuccess(address, username, device);
  recordTry(success);
  return { ok: true, value };
}

/** Results of a password try that are not a problem. The other results can show an attack, so they are warnings. */
const GOOD_RESULTS: readonly LoginResult[] = ['logged-in', 'password-changed'];

/** A line in the audit log and in the server log */
function warnAndAudit(message: string, details: Record<string, unknown>): void {
  log.warn(message, details);
  writeAudit(message, details);
}

/**
 * Write each password try in the audit log and in the server log, also when the login log cannot save it.
 * The login log keeps only the last 50 tries. The audit log and the server log have a limit of size,
 * so they write only the first MAX_LOGGED_UNKNOWN_USERS tries with an unknown username from one address in LOCK_MINUTES.
 * When that time ends, the next password try writes the count of the other tries. A long username is cut.
 * Never log the password or the cookie. The caller gives an unknown username masked, because it can be a password.
 */
function logTry(
  limiter: LoginLimiter,
  { username, address, result, device }: { username: string; address: string; result: LoginResult; device?: string },
) {
  for (const { address: group, notLogged } of limiter.takeEndedUnknownUserFloods()) {
    warnAndAudit('Password tries with unknown usernames that had no line', { address: group, count: notLogged });
  }
  if (result === 'no-such-user') {
    const count = limiter.countUnknownUser(address);
    if (count === MAX_LOGGED_UNKNOWN_USERS + 1) {
      warnAndAudit('More password tries with unknown usernames from this address are not logged one by one', { address, minutes: LOCK_MINUTES });
    }
    if (count > MAX_LOGGED_UNKNOWN_USERS) return;
  }
  // The login log on the Logins tab does not show the device, so the audit log and the server log tell it
  const details = { username: cutValue(username), address, result, ...(device ? { knownDevice: true } : {}) };
  writeAudit('Password try', details);
  if (GOOD_RESULTS.includes(result)) log.info('Password try', details);
  else log.warn('Password try failed', details);
}

/** A note that cannot be saved (for example, on a full disk) must not stop a login or a request */
function withoutFailing(message: string, save: () => void): void {
  try {
    save();
  } catch (error) {
    log.error(message, { error });
  }
}

/**
 * Save that the browser of the request was used now, so its session does not stop for no use.
 * A cookie from a login over plain HTTP has no Secure flag. When the browser uses it over HTTPS, it gets the cookie again
 * with the Secure flag. This occurs only when the use is saved: normally at most once in SEEN_INTERVAL_MS, and also
 * each time the address of the browser changes. So most replies set no cookie. The cookie gets the token that was checked.
 */
export function markSessionSeen(
  c: Context,
  { auth, proxySettings }: Pick<LoginGuard, 'auth' | 'proxySettings'>,
  { session, token }: CheckedSession,
): void {
  const origin = originOf(c, proxySettings);
  let saved = false;
  withoutFailing('[Sessions] Could not save when a browser was used', () => {
    saved = auth.markSeen(session, origin.address);
  });
  if (saved && origin.isHttps) setSessionCookie(c, origin, token, auth.secondsLeftOf(session));
}

/**
 * True while the login of a request after requireLogin is still valid. A long request, such as the live events, checks it again.
 * A browser login ends with its session. A program (HTTP Basic) sends the password with each request, so its login stays.
 * When the check cannot read the database, the login stays: the next request checks it again.
 */
export function isStillLoggedIn(c: Context, auth: Auth): boolean {
  if (basicLogin(c.req.header('Authorization'))) return true;
  try {
    return currentSession(c, auth) !== null;
  } catch (error) {
    log.error('[Sessions] Could not check the login of a long request', { error });
    return true;
  }
}

/** Stops each request that has no valid login. Sets c.var.user for the routes after it. */
export function requireLogin(guard: LoginGuard) {
  const { auth, proxySettings } = guard;
  return createMiddleware<LoggedInEnv>(async (c, next) => {
    const browser = checkedSession(c, auth);
    if (browser) {
      markSessionSeen(c, guard, browser);
      c.set('user', browser.session.user);
      return next();
    }

    // A program has no device cookie, so this login always has the normal limits
    const login = basicLogin(c.req.header('Authorization'));
    if (!login) return logInFirst(c);
    // A known login is not logged, because a program sends it with each request
    const knownUser = auth.knownUserOf(login);
    if (knownUser) {
      c.set('user', knownUser);
      return next();
    }

    const checked = await withPasswordCheck(c, guard, originOf(c, proxySettings), {
      username: login.username,
      success: 'logged-in',
      check: () => auth.userOf(login),
    });
    if (!checked.ok) return checked.reply;
    c.set('user', checked.value);
    return next();
  });
}

/** Stops a request from a browser that is not logged in, before the route reads the body. Sets c.var.user. */
function requireBrowserLogin(auth: Auth) {
  return createMiddleware<LoggedInEnv>(async (c, next) => {
    const session = currentSession(c, auth);
    if (!session) return logInFirst(c);
    c.set('user', session.user);
    return next();
  });
}

/** Stops the request when the role of the user cannot do this. Use it only after requireLogin. */
export function requirePermission(permission: Permission) {
  return createMiddleware<LoggedInEnv>(async (c, next) => {
    if (roleCan(c.var.user.role, permission)) return next();
    return c.json({ error: 'Your role cannot do this. Ask an admin.' }, 403);
  });
}

export function authRoutes(guard: LoginGuard) {
  const { auth, proxySettings } = guard;
  return new Hono()
    .get('/auth/status', c => {
      const user = currentSession(c, auth)?.user ?? null;
      return c.json({
        setupNeeded: !auth.isSetUp(),
        loggedIn: user !== null,
        user: user && { username: user.username, role: user.role },
      });
    })

    // Only the first visitor can do this: when an admin exists, the reply is 409
    .post('/auth/setup', setUpAtLocalHostOnly(auth, proxySettings), checkedJson(setUpSchema), async c => {
      const origin = originOf(c, proxySettings);
      try {
        const setUp = c.req.valid('json');
        const token = await auth.setUp(setUp, clientOf(c, origin));
        if (!token) return setUpClosed(c, origin);
        // Only the first visitor can make an Admin, so the log tells who did it
        const details = { username: setUp.username, address: origin.address };
        log.warn('First-run setup made a new Admin', details);
        writeAudit('First-run setup made a new Admin', details);
        return replyLoggedIn(c, auth, origin, token, setUp.username);
      } catch (error) {
        // A user who is not an admin can have this username, in the database of an older version after its
        // reset-password. The same reply as for a closed setup does not tell that the username exists.
        if (error instanceof UsernameTakenError) return setUpClosed(c, origin);
        throw error;
      }
    })

    .post('/auth/login', checkedJson(logInSchema), async c => {
      const login = c.req.valid('json');
      const origin = originOf(c, proxySettings);
      const checked = await withPasswordCheck(c, guard, origin, {
        username: login.username,
        device: knownDevice(c, auth, login.username),
        success: 'logged-in',
        check: () => auth.logIn(login, clientOf(c, origin)),
      });
      if (!checked.ok) return checked.reply;
      return replyLoggedIn(c, auth, origin, checked.value, login.username);
    })

    .post('/auth/logout', c => {
      const session = currentSession(c, auth);
      if (session) {
        auth.logOut(session);
        // The routes of the login come before the audit middleware (app.ts), so they write their own lines
        writeAuditAndLog('Logged out', { user: session.user.username, address: originOf(c, proxySettings).address });
      }
      deleteCookie(c, SESSION_COOKIE, { path: SESSION_COOKIE_PATH });
      return c.json({ loggedIn: false });
    })

    // Only a browser that is logged in can do this. A new password logs out every other browser.
    .post('/auth/password', requireBrowserLogin(auth), checkedJson(changePasswordSchema), async c => {
      const { user } = c.var;
      const passwordChange = c.req.valid('json');
      // The rule needs the username, which is not in the body. The current password is not checked yet.
      const problem = newPasswordProblem(passwordChange.newPassword, user.username);
      if (problem) return c.json({ error: problem }, 400);
      const origin = originOf(c, proxySettings);
      const checked = await withPasswordCheck(c, guard, origin, {
        username: user.username,
        device: knownDevice(c, auth, user.username),
        success: 'password-changed',
        check: () => auth.changePassword(user, passwordChange, clientOf(c, origin)),
      });
      if (!checked.ok) return checked.reply;
      // The new password stops the old device cookie, so the browser gets a new one
      return replyLoggedIn(c, auth, origin, checked.value, user.username);
    });
}
