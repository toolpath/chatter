import { machineRequest, type MachineProfile } from './profiles.js';

/**
 * Adds the fake machines to Chatter through its API.
 * Chatter needs a login for each request. A program sends it with HTTP Basic:
 * the username and password in the Authorization header.
 */

export const USERNAME_VARIABLE = 'CHATTER_USERNAME';
export const PASSWORD_VARIABLE = 'CHATTER_PASSWORD';

export interface ChatterLogin {
  username: string;
  password: string;
}

/** The login from the environment variables, or null when one of them is not set */
export function loginFromEnvironment(environment: NodeJS.ProcessEnv): ChatterLogin | null {
  const username = environment[USERNAME_VARIABLE];
  const password = environment[PASSWORD_VARIABLE];
  if (!username || !password) return null;
  return { username, password };
}

function basicAuthHeader({ username, password }: ChatterLogin): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

/** Replies that stop the adding: each next machine would fail in the same way */
const STOPPING_REPLIES: Record<number, string> = {
  401: `Chatter did not accept the login. Check ${USERNAME_VARIABLE} and ${PASSWORD_VARIABLE}.`,
  429: 'Chatter blocked this computer for a short time after too many wrong logins. Wait, then try again.',
};

class StopAdding extends Error {}

async function addMachine(api: string, login: ChatterLogin, profile: MachineProfile, host: string): Promise<void> {
  const response = await fetch(`${api}/api/machines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: basicAuthHeader(login) },
    body: JSON.stringify(machineRequest(profile, host)),
  });
  const stopReason = STOPPING_REPLIES[response.status];
  if (stopReason) throw new StopAdding(stopReason);

  if (response.ok) console.log(`  added     ${profile.name}`);
  else if (response.status === 409) console.log(`  exists    ${profile.name}`);
  else console.log(`  FAILED    ${profile.name}: ${response.status} ${await response.text()}`);
}

/** Add each machine at `host` to Chatter. A 409 reply means it is already there. */
export async function addToChatter(api: string, login: ChatterLogin, profiles: MachineProfile[], host: string): Promise<void> {
  try {
    for (const profile of profiles) await addMachine(api, login, profile, host);
  } catch (error) {
    if (!(error instanceof StopAdding)) throw error;
    console.error(`  ${error.message}`);
  }
}
