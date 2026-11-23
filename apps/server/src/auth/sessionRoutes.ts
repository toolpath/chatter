import { Hono } from 'hono';
import type { Auth, UserSession } from './Auth.js';
import { checkedSession, currentSession, knownDevice, logInFirst, markSessionSeen, setDeviceCookie, type LoginGuard } from './authRoutes.js';
import { deviceName } from './deviceName.js';
import { writeAuditAndLog } from '../logging/audit.js';
import { originOf } from './requestOrigin.js';

/** The browsers where the user is logged in, as the "Your account" tab shows them */
function sessionsReport(auth: Auth, current: UserSession) {
  return {
    sessions: auth.browserSessions(current.user).map(session => ({
      device: deviceName(session.userAgent),
      address: session.address,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      isThisBrowser: session.id === current.id,
    })),
  };
}

/**
 * See where you are logged in, and log out your other browsers.
 * Only a browser can do this: a program that sends the password has no session.
 */
export function sessionRoutes(guard: Pick<LoginGuard, 'auth' | 'proxySettings'>) {
  const { auth, proxySettings } = guard;
  return new Hono()
    // A visible Chatter page sends this from time to time, so its login stays in use. A hidden page does not send it.
    .post('/auth/sessions/in-use', c => {
      const checked = checkedSession(c, auth);
      if (!checked) return logInFirst(c);
      markSessionSeen(c, guard, checked);
      return c.body(null, 204);
    })

    .get('/auth/sessions', c => {
      const current = currentSession(c, auth);
      return current ? c.json(sessionsReport(auth, current)) : logInFirst(c);
    })

    .post('/auth/sessions/log-out-others', c => {
      const current = currentSession(c, auth);
      if (!current) return logInFirst(c);
      const { username } = current.user;
      const wasKnown = knownDevice(c, auth, username) !== undefined;
      auth.logOutOtherBrowsers(current);
      // A person who took over the account can log out the real user, so the audit log tells it
      const origin = originOf(c, proxySettings);
      writeAuditAndLog('Logged out the other browsers', { user: username, address: origin.address });
      // The device cookie of this browser stops too, so a known browser gets a new one and stays known
      if (wasKnown) setDeviceCookie(c, auth, origin, username);
      return c.json(sessionsReport(auth, current));
    });
}
