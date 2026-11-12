import Database from 'better-sqlite3';
import { createApp, type AppParts } from '../app.js';
import { HardwarePoller } from '../polling/poller.js';
import { noHistory } from '../recording/testSupport.js';

/** For tests: the app with no machines and no history, plus the login parts and any other parts the test gives */
export function testApp(parts: Pick<AppParts, 'auth' | 'accounts'> & Partial<AppParts>) {
  return createApp({ poller: new HardwarePoller(new Database(':memory:')), history: noHistory(), ...parts });
}

export type TestApp = ReturnType<typeof testApp>;

/** For tests: the error text of a JSON error reply */
export async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}
