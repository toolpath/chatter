/**
 * The audit log: who changed what, and each login try. It is a separate file, `logs/audit.log` in the data folder,
 * because the server log is small (2 files of 1 MB) and a busy machine can fill it in some days.
 *
 * Each line has the time, the user, the role, the method, the route pattern (for example /api/machine/:id), the values
 * of the path parameters (IDs, cut to MAX_AUDIT_VALUE characters), the status and the address. A route can add a detail
 * with addAuditDetail, for example the name of a deleted file. A line never has a value of the body, a cookie or a
 * password, and has a value of the query only when a route adds it. The secrets are hidden as in the server log (redact.ts).
 *
 * The level of the server log (LOG_LEVEL) does not stop an audit line. LOG_FILE=off also turns off the audit file.
 * Only an Admin can read the audit log: it is in the support bundle (Settings > Diagnostics).
 */
import { routePath } from 'hono/route';
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { LoggedInEnv } from '../auth/authRoutes.js';
import type { ProxySettings } from '../auth/proxySettings.js';
import { originOf } from '../auth/requestOrigin.js';
import { createLogger, textLine, type LogContext } from './logger.js';
import { redactContext, redactText } from './redact.js';

/**
 * The size of one audit file. With the old file, the audit log takes at most 10 MB on the card.
 * One line has about 150 to 250 bytes, so the two files keep about 50,000 lines.
 */
export const AUDIT_FILE_BYTES = 5 * 1024 * 1024;

/**
 * The longest path parameter or username in an audit line. A person sends these values, so a longer value is cut,
 * and one request cannot fill the log. A cut value ends with "…".
 */
const MAX_AUDIT_VALUE = 64;

/** The value, cut to MAX_AUDIT_VALUE characters */
export function cutValue(value: string): string {
  const characters = [...value];
  return characters.length > MAX_AUDIT_VALUE ? `${characters.slice(0, MAX_AUDIT_VALUE).join('')}…` : value;
}

/** Where the audit lines go */
export type AuditSink = (text: string) => void;

let sink: AuditSink = () => {};

/** Change where the audit lines go. startServerLog() sends them to the audit file. Returns the old sink. */
export function configureAudit(newSink: AuditSink): AuditSink {
  const old = sink;
  sink = newSink;
  return old;
}

/** Write one line in the audit log only, not in the server log. A sink that fails does not stop the request. */
export function writeAudit(message: string, context: LogContext): void {
  const text = redactText(textLine({ time: new Date(), level: 'info', component: 'audit', message, context: redactContext(context) }));
  try {
    sink(text);
  } catch {
    // The audit file never throws (LogFile), but a test sink or a future sink can
  }
}

const log = createLogger('audit');

/** Write one line in the audit log and in the server log, at the info level */
export function writeAuditAndLog(message: string, context: LogContext): void {
  writeAudit(message, context);
  log.info(message, context);
}

/** The details that the routes add to the audit line of each request */
const addedDetails = new WeakMap<Request, Record<string, string>>();

/**
 * Add a detail to the audit line of this request, for example the name of a deleted file, which is in the query.
 * Add it before the route can fail, so the line of a failed change has it too. The value is cut to MAX_AUDIT_VALUE
 * characters. It comes after the path parameters, and it does not replace a fixed detail or a path parameter.
 */
export function addAuditDetail(c: Context, key: string, value: string): void {
  addedDetails.set(c.req.raw, { ...addedDetails.get(c.req.raw), [key]: cutValue(value) });
}

/** A GET changes nothing. HEAD and OPTIONS read only. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Writes each request that can change something (each method except GET), after requireLogin, so each one has a user.
 * The line goes to the audit file and to the server log. A request that throws gets the status 500.
 */
export function auditLog(proxySettings: ProxySettings) {
  return createMiddleware<LoggedInEnv>(async (c, next) => {
    if (READ_METHODS.has(c.req.method)) return next();
    let status = 500;
    try {
      await next();
      status = c.res.status;
    } finally {
      recordChange(c, proxySettings, status);
    }
  });
}

function recordChange(c: Context<LoggedInEnv>, proxySettings: ProxySettings, status: number): void {
  const { username, role } = c.var.user;
  // After next(), the route pattern and the parameters are those of the last handler that ran
  const fixed = { user: username, role, method: c.req.method, route: routePath(c), status, address: originOf(c, proxySettings).address };
  // The parameters come after the fixed details. A parameter with the name of a fixed detail does not replace it.
  const params = Object.fromEntries(Object.entries(c.req.param()).filter(([key]) => !(key in fixed)).map(([key, value]) => [key, cutValue(value)]));
  const added = Object.entries(addedDetails.get(c.req.raw) ?? {}).filter(([key]) => !(key in fixed) && !(key in params));
  const details = { ...fixed, ...params, ...Object.fromEntries(added) };
  writeAuditAndLog('Change', details);
}
