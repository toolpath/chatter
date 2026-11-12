import { hc } from 'hono/client';
import type { AppType } from 'hardware-monitor-server/app';

/** The status of a reply when the login is gone */
export const HTTP_UNAUTHORIZED = 401;

type Listener = () => void;
const loginCheckListeners = new Set<Listener>();

/**
 * Call `listener` when the login may have changed (a 401 reply, a log out).
 * Returns a function that stops the calls.
 */
export function onLoginCheckNeeded(listener: Listener): () => void {
  loginCheckListeners.add(listener);
  return () => loginCheckListeners.delete(listener);
}

export function requestLoginCheck(): void {
  loginCheckListeners.forEach(listener => listener());
}

/** The login route gives 401 for a wrong password. That is not a lost login. */
const LOGIN_PATH = '/api/auth/login';

function pathOf(input: RequestInfo | URL): string {
  const url = input instanceof Request ? input.url : String(input);
  return new URL(url, window.location.origin).pathname;
}

/** fetch(), but a 401 reply (the login is gone) asks for a login check */
async function fetchWithLogin(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === HTTP_UNAUTHORIZED && pathOf(input) !== LOGIN_PATH) requestLoginCheck();
  return response;
}

/**
 * The typed client for the server's /api routes.
 * The paths, inputs, and replies come from the server code, so a wrong call fails the type check.
 * The base is the page's own address. The Vite dev server sends /api on to the server.
 */
export const api = hc<AppType>(window.location.origin, { fetch: fetchWithLogin }).api;
