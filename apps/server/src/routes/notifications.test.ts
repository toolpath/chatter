import type { ChannelInput, NotificationChannel } from '@local-chatter/shared';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { AlertStore } from '../alerts/AlertStore.js';
import { loggedInAuth } from '../auth/testSupport.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { Notifications } from '../notifications/Notifications.js';
import { SettingsTable } from '../storage/settingsTable.js';
import { errorOf, testApp, type TestApp } from './testSupport.js';

const PASSWORD = 'a-good-password';

const slack: ChannelInput = {
  type: 'webhook', name: 'Slack', values: { url: 'https://hooks.slack.com/services/T0/B0/x', secret: 'hook-secret' },
  minSeverity: 'warning', machineIds: null, enabled: true,
};

describe('notification routes', () => {
  let app: TestApp;
  let accounts: UserAccounts;
  let adminCookie: string;
  let sentBodies: string[];

  beforeEach(async () => {
    const parts = await loggedInAuth();
    accounts = parts.accounts;
    adminCookie = parts.cookie;
    sentBodies = [];
    const db = new Database(':memory:');
    new AlertStore(db);
    const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      sentBodies.push(String(init?.body));
      return new Response(null, { status: 200 });
    };
    const notifications = new Notifications({
      db, settingsTable: new SettingsTable(db), machineName: () => null, fetch: fetch as typeof globalThis.fetch,
    });
    app = testApp({ auth: parts.auth, accounts, notifications });
  });

  function send(cookie: string, method: string, path: string, body?: unknown) {
    return app.request(`/api${path}`, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const asAdmin = (method: string, path: string, body?: unknown) => send(adminCookie, method, path, body);

  async function operatorCookie() {
    await accounts.add({ username: 'jo', password: PASSWORD, role: 'operator' });
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jo', password: PASSWORD }),
    });
    return (res.headers.get('Set-Cookie') ?? '').split(';')[0];
  }

  async function addedChannel(input = slack): Promise<NotificationChannel> {
    return (await (await asAdmin('POST', '/notification-channels', input)).json()) as NotificationChannel;
  }

  it('needs a login', async () => {
    expect((await app.request('/api/notification-channels')).status).toBe(401);
  });

  it('is only for an admin, because the channels have the phone numbers of the shop', async () => {
    const cookie = await operatorCookie();
    const routes: [string, string, unknown?][] = [
      ['GET', '/notification-types'],
      ['GET', '/notification-channels'],
      ['POST', '/notification-channels', slack],
      ['POST', '/notification-channels/test', slack],
      ['PUT', '/notification-channels/some-id', slack],
      ['DELETE', '/notification-channels/some-id'],
      ['POST', '/notification-channels/some-id/test', slack],
      ['GET', '/notification-messages'],
      ['GET', '/notification-settings'],
      ['PUT', '/notification-settings', { linkBaseUrl: null, timeZone: null }],
    ];

    for (const [method, path, body] of routes) {
      expect([method, path, (await send(cookie, method, path, body)).status]).toEqual([method, path, 403]);
    }
    expect(sentBodies).toEqual([]);
  });

  it('refuses a body that is too large before it reads it', async () => {
    const res = await asAdmin('POST', '/notification-channels', { ...slack, name: 'x'.repeat(100_000) });

    expect(res.status).toBe(413);
  });

  it('gives the channel types and their fields', async () => {
    const types = (await (await asAdmin('GET', '/notification-types')).json()) as { id: string }[];

    expect(types.map(type => type.id)).toEqual(['twilio-sms', 'webhook']);
  });

  it('adds a channel and never sends its secret back', async () => {
    const res = await asAdmin('POST', '/notification-channels', slack);
    const list = await (await asAdmin('GET', '/notification-channels')).text();

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: 'Slack', hasSecret: { secret: true } });
    expect(list).toContain('Slack');
    expect(list).not.toContain('hook-secret');
  });

  it('refuses a channel with a wrong value, with the problem in plain words', async () => {
    const res = await asAdmin('POST', '/notification-channels', { ...slack, values: { url: 'ftp://example.com' } });

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatch(/http/);
  });

  it('refuses a body that is not a channel form', async () => {
    const res = await asAdmin('POST', '/notification-channels', { ...slack, minSeverity: 'info' });

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('The level must be "warning" or "critical"');
  });

  it('changes a channel', async () => {
    const { id } = await addedChannel();

    const res = await asAdmin('PUT', `/notification-channels/${id}`, { ...slack, name: 'Night shift', values: { ...slack.values, secret: '' } });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, name: 'Night shift', hasSecret: { secret: true } });
  });

  it('tells when a channel to change, test or delete is not there', async () => {
    expect((await asAdmin('PUT', '/notification-channels/missing', slack)).status).toBe(404);
    expect((await asAdmin('POST', '/notification-channels/missing/test', slack)).status).toBe(404);
    expect((await asAdmin('DELETE', '/notification-channels/missing')).status).toBe(404);
  });

  it('deletes a channel', async () => {
    const { id } = await addedChannel();

    expect((await asAdmin('DELETE', `/notification-channels/${id}`)).status).toBe(204);
    expect(await (await asAdmin('GET', '/notification-channels')).json()).toEqual([]);
  });

  it('sends a test from a form that is not saved', async () => {
    const res = await asAdmin('POST', '/notification-channels/test', slack);

    expect(await res.json()).toEqual({ ok: true, detail: expect.any(String) });
    expect(sentBodies).toHaveLength(1);
  });

  it('sends a test of a saved channel, and shows it in the message list of the channel', async () => {
    const { id } = await addedChannel();

    await asAdmin('POST', `/notification-channels/${id}/test`, { ...slack, values: { ...slack.values, secret: '' } });
    const messages = await (await asAdmin('GET', `/notification-messages?channel=${id}`)).json();

    expect(messages).toEqual([expect.objectContaining({ channelId: id, kind: 'test', status: 'sent' })]);
    expect(JSON.stringify(messages)).not.toContain('hook-secret');
  });

  it('gives no secret in the result of a test', async () => {
    const { id } = await addedChannel();

    const result = await (await asAdmin('POST', `/notification-channels/${id}/test`, { ...slack, values: { ...slack.values, secret: '' } })).text();

    expect(result).not.toContain('hook-secret');
  });

  describe('settings', () => {
    it('has no link address and no time zone at first', async () => {
      expect(await (await asAdmin('GET', '/notification-settings')).json()).toEqual({ linkBaseUrl: null, timeZone: null });
    });

    it('saves the settings, and saves blank text as not set', async () => {
      const res = await asAdmin('PUT', '/notification-settings', { linkBaseUrl: ' ', timeZone: 'America/Chicago' });

      expect(await res.json()).toEqual({ linkBaseUrl: null, timeZone: 'America/Chicago' });
    });

    it.each([
      [{ linkBaseUrl: 'chatter.local', timeZone: null }, /must start with http/],
      [{ linkBaseUrl: null, timeZone: 'Mars/Olympus' }, /does not know this time zone/],
      [{ linkBaseUrl: 'http://admin:pw@chatter.local', timeZone: null }, /must not have a user name or password/],
    ])('refuses %o', async (body, error) => {
      const res = await asAdmin('PUT', '/notification-settings', body);

      expect(res.status).toBe(400);
      expect(await errorOf(res)).toMatch(error);
    });
  });
});
