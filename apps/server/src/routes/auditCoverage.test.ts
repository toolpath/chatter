import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/authRoutes.js';
import { loggedInAuth } from '../auth/testSupport.js';
import { captureAudit, type CapturedAudit } from '../logging/testSupport.js';
import { testApp } from './testSupport.js';

/**
 * Each route that can change something and gets no audit line from this walk, with the reason.
 * Each other route must write an audit line. A new route that writes none must come into this list,
 * so that a person decides it.
 */
const NOT_AUDITED: Record<string, string> = {
  'POST /api/auth/login': 'each password try gets a "Password try" line (authRoutes.test.ts). The empty body of the walk has no username.',
  'POST /api/auth/setup': 'the setup gets its own lines (authRoutes.test.ts). The empty body of the walk has no username.',
  'POST /api/auth/password': 'each password try gets a "Password try" line (authRoutes.test.ts). The empty body of the walk has no password.',
  'POST /api/auth/sessions/in-use': 'a visible page sends it from time to time to keep its login in use. It changes nothing that a person did.',
};

describe('the audit lines of the routes that can change something', () => {
  let audit: CapturedAudit;
  beforeEach(() => {
    audit = captureAudit();
  });
  afterEach(() => audit.restore());

  it('come from each route that is not a GET, except the routes in the list', async () => {
    const { auth, accounts } = await loggedInAuth();
    const login = { username: 'vic', password: 'test-password' };
    await accounts.add({ ...login, role: 'viewer' });
    const cookie = `${SESSION_COOKIE}=${await auth.logIn(login, { userAgent: 'test browser', address: '127.0.0.1' })}`;
    const app = testApp({ auth, accounts });
    const routes = [...new Set(app.routes.filter(route => !['GET', 'ALL'].includes(route.method)).map(route => `${route.method} ${route.path}`))]
      // The logout ends the login of the walk, so it comes last
      .sort((a, b) => Number(a.endsWith('/logout')) - Number(b.endsWith('/logout')));

    const notAudited: string[] = [];
    for (const route of routes) {
      const [method, routePath] = route.split(' ');
      audit.lines.length = 0;
      // A Viewer, so that the routes refuse each change with 403 and the walk changes nothing
      await app.request(routePath.replace(/:\w+/g, 'no-such-id'), {
        method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (audit.lines.length === 0) notAudited.push(route);
    }

    expect(notAudited.sort()).toEqual(Object.keys(NOT_AUDITED).sort());
    expect(routes.length).toBeGreaterThan(40);
  });
});
