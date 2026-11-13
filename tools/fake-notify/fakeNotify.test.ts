import { describe, expect, it } from 'vitest';
import { answer, type FakeRequest } from './fakeNotify';

const SID = `AC${'0123456789abcdef'.repeat(2)}`;
const login = (token: string) => `Basic ${Buffer.from(`${SID}:${token}`).toString('base64')}`;

function twilioRequest(to: string, token = 'any-token'): FakeRequest {
  return {
    method: 'POST',
    path: `/2010-04-01/Accounts/${SID}/Messages.json`,
    headers: { authorization: login(token), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: '+15551230000', Body: 'Test from Chatter.' }).toString(),
  };
}

describe('answer', () => {
  it('takes a text message like Twilio, and prints it', () => {
    const reply = answer(twilioRequest('+15559870001'), { webhookStatus: 200 });

    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ status: 'queued', to: '+15559870001', from: '+15551230000', body: 'Test from Chatter.' });
    expect(reply.printed).toBe('Text message to +15559870001 from +15551230000: Test from Chatter.');
  });

  it.each([
    ['+15005550001', 21211],
    ['+15005550004', 21610],
    ['+15005550008', 21608],
  ])('refuses a message to %s with the Twilio error %i', (to, code) => {
    const reply = answer(twilioRequest(to), { webhookStatus: 200 });

    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ code, status: 400 });
    expect(reply.printed).toContain(`error ${code}`);
  });

  it('refuses the login when the auth token is "wrong"', () => {
    const reply = answer(twilioRequest('+15559870001', 'wrong'), { webhookStatus: 200 });

    expect(reply.status).toBe(401);
    expect(reply.body).toMatchObject({ code: 20003 });
  });

  it('takes any other post as a webhook, and prints its JSON and whether it had a secret', () => {
    const reply = answer({
      method: 'POST', path: '/slack', headers: { authorization: 'Bearer hook-secret' }, body: '{"text":"CRITICAL - Haas VF-2"}',
    }, { webhookStatus: 200 });

    expect(reply.status).toBe(200);
    expect(reply.printed).toBe('Webhook /slack (with a secret): {"text":"CRITICAL - Haas VF-2"}');
    expect(reply.printed).not.toContain('hook-secret');
  });

  it('gives the webhook answer that --webhook-status asks for, so you can see the retries', () => {
    expect(answer({ method: 'POST', path: '/x', headers: {}, body: '{}' }, { webhookStatus: 500 }).status).toBe(500);
  });

  it('refuses a Twilio address that is not the messages address, so a wrong address does not look like it works', () => {
    const reply = answer({ ...twilioRequest('+15559870001'), path: '/2010-04-01/Accounts/ACxyz/Messages.json' }, { webhookStatus: 200 });

    expect(reply.status).toBe(404);
    expect(reply.body).toMatchObject({ code: 20404 });
  });

  it('answers 404 to a request that is not a post', () => {
    expect(answer({ method: 'GET', path: '/', headers: {}, body: '' }, { webhookStatus: 200 }).status).toBe(404);
  });
});
