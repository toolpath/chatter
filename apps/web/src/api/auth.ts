import type { InferResponseType } from 'hono/client';
import { api, requestLoginCheck } from './client';
import { jsonOrThrow } from './replies';

/** Log in, log out, make the ChatterBox account, and change its password */

export interface Login {
  username: string;
  password: string;
}

export interface AuthResult {
  ok: boolean;
  /** The server's reason, when ok is false */
  error?: string;
}

const UNKNOWN_FAILURE_MESSAGE = 'Something went wrong. Try again.';

interface AuthReply {
  ok: boolean;
  json(): Promise<unknown>;
}

async function authResultOf(reply: AuthReply): Promise<AuthResult> {
  if (reply.ok) return { ok: true };
  const body = (await reply.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: body.error ?? UNKNOWN_FAILURE_MESSAGE };
}

export async function getAuthStatus() {
  const reply = await api.auth.status.$get();
  return reply.json();
}

export async function setUpAccount(login: Login): Promise<AuthResult> {
  return authResultOf(await api.auth.setup.$post({ json: login }));
}

export async function logIn(login: Login): Promise<AuthResult> {
  return authResultOf(await api.auth.login.$post({ json: login }));
}

export async function logOut(): Promise<void> {
  await api.auth.logout.$post();
  requestLoginCheck();
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthResult> {
  return authResultOf(await api.auth.password.$post({ json: { currentPassword, newPassword } }));
}

const sessions = api.auth.sessions;

/** The browsers that are logged in to the account */
export type SessionsReport = InferResponseType<typeof sessions.$get, 200>;
export type BrowserSession = SessionsReport['sessions'][number];

export async function fetchSessions(): Promise<SessionsReport> {
  return jsonOrThrow(await sessions.$get(), 'Could not load the list of browsers');
}

/** Log out each browser except this one */
export async function logOutOtherBrowsers(): Promise<SessionsReport> {
  return jsonOrThrow(await sessions['log-out-others'].$post(), 'Could not log out the other browsers');
}
