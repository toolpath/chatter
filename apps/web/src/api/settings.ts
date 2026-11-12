import type { Role, UserToAdd } from '@local-chatter/shared';
import type { InferResponseType } from 'hono/client';
import { api } from './client';
import { jsonOrThrow } from './replies';

/** The settings of the whole Chatter server */

const proxy = api.settings.proxy;

/** The trusted reverse proxies, the computers that sent proxy headers, and how this page came */
export type ProxyReport = InferResponseType<typeof proxy.$get, 200>;
export type HeaderSender = ProxyReport['senders'][number];

export async function fetchProxyReport(): Promise<ProxyReport> {
  return jsonOrThrow(await proxy.$get(), 'Could not load the proxy settings');
}

/** Trust these addresses and ranges from now on. Throws an error with the server's reason. */
export async function saveTrustedProxies(addresses: string[]): Promise<ProxyReport> {
  return jsonOrThrow(await proxy.$put({ json: { addresses } }), 'Could not save the trusted proxies');
}

const logins = api.settings.logins;

/** The computers that must wait after too many wrong passwords, and the last password tries */
export type LoginsReport = InferResponseType<typeof logins.$get, 200>;
export type LockedComputer = LoginsReport['locked'][number];
export type LoginTry = LoginsReport['tries'][number];
export type LoginResult = LoginTry['result'];

export async function fetchLoginsReport(): Promise<LoginsReport> {
  return jsonOrThrow(await logins.$get(), 'Could not load the logins');
}

/** Let this computer try a password again now */
export async function unlockComputer(address: string): Promise<LoginsReport> {
  return jsonOrThrow(await logins.unlock.$post({ json: { address } }), `Could not unlock ${address}`);
}

const users = api.settings.users;
const userIdParam = (id: number) => ({ param: { id: String(id) } });

/** The Chatter users and their roles */
export type UsersReport = InferResponseType<typeof users.$get, 200>;
export type ChatterUser = UsersReport['users'][number];

export async function fetchUsersReport(): Promise<UsersReport> {
  return jsonOrThrow(await users.$get(), 'Could not load the users');
}

/** Throws an error with the server's reason, for example when the username is taken */
export async function addUser(user: UserToAdd): Promise<UsersReport> {
  return jsonOrThrow(await users.$post({ json: user }), 'Could not add the user');
}

export async function changeRole(id: number, role: Role): Promise<UsersReport> {
  return jsonOrThrow(await users[':id'].role.$put({ ...userIdParam(id), json: { role } }), 'Could not change the role');
}

/** Each browser of the user is logged out */
export async function setUserPassword(id: number, password: string): Promise<UsersReport> {
  return jsonOrThrow(await users[':id'].password.$put({ ...userIdParam(id), json: { password } }), 'Could not set the password');
}

export async function removeUser(id: number): Promise<UsersReport> {
  return jsonOrThrow(await users[':id'].$delete(userIdParam(id)), 'Could not remove the user');
}
