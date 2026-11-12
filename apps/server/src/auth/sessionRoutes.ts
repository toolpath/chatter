import { Hono } from 'hono';
import type { Auth, UserSession } from './Auth.js';
import { currentSession, logInFirst } from './authRoutes.js';
import { deviceName } from './deviceName.js';

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
export function sessionRoutes(auth: Auth) {
  return new Hono()
    .get('/auth/sessions', c => {
      const current = currentSession(c, auth);
      return current ? c.json(sessionsReport(auth, current)) : logInFirst(c);
    })

    .post('/auth/sessions/log-out-others', c => {
      const current = currentSession(c, auth);
      if (!current) return logInFirst(c);
      auth.logOutOtherBrowsers(current);
      return c.json(sessionsReport(auth, current));
    });
}
