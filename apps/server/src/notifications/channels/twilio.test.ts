import { describe, expect, it } from 'vitest';
import type { OutgoingMessage, SendContext } from './ChannelType.js';
import { createTwilioChannel, TWILIO_API, twilioAddressOf } from './twilio.js';

const MESSAGE: OutgoingMessage = {
  kind: 'started', text: 'CRITICAL - Haas VF-2: In alarm. Started 9:02 AM.', severity: 'critical',
  machine: { id: 'haas-vf2', name: 'Haas VF-2' }, alertName: 'In alarm', summary: 'In alarm',
  startedAt: '2026-11-13T15:02:00.000Z', endedAt: null, link: null,
};

const SID = `AC${'0123456789abcdef'.repeat(2)}`;
const settings = { accountSid: SID, authToken: 'token-for-tests', from: '+15551230000', to: ['+15559870001', '+15559870002'] };
const twilioChannel = createTwilioChannel(TWILIO_API);

interface SentRequest {
  url: string;
  init: RequestInit;
}

/** A fetch that keeps each request and gives the answer of `answer` for the number in the request */
function fakeTwilio(answer: (to: string) => Response) {
  const requests: SentRequest[] = [];
  const fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    requests.push({ url: String(url), init });
    return answer(new URLSearchParams(String(init.body)).get('To') ?? '');
  }) as typeof globalThis.fetch;
  return { requests, context: (): SendContext => ({ fetch, signal: new AbortController().signal }) };
}

const created = () => Response.json({ sid: 'SM1', status: 'queued' }, { status: 201 });
const twilioError = (status: number, code?: number) =>
  Response.json({ status, code, message: 'Twilio text', more_info: `https://www.twilio.com/docs/errors/${code}` }, { status });

describe('twilioChannel', () => {
  it('asks for the Twilio login, the From number, and the phone numbers', () => {
    expect(twilioChannel.id).toBe('twilio-sms');
    expect(twilioChannel.name).toBe('Text message (Twilio)');
    expect(twilioChannel.fields.map(field => [field.key, field.kind, field.required])).toEqual([
      ['accountSid', 'text', true],
      ['authToken', 'secret', true],
      ['from', 'text', true],
      ['to', 'phone-list', true],
    ]);
  });

  it('sends one text message to each phone, with the Twilio login', async () => {
    const twilio = fakeTwilio(created);
    const context = twilio.context();

    const result = await twilioChannel.send(settings, MESSAGE, context);

    expect(result).toEqual({ ok: true, detail: 'Sent to 2 phones' });
    expect(twilio.requests.map(request => new URLSearchParams(String(request.init.body)).get('To')))
      .toEqual(['+15559870001', '+15559870002']);
    const [{ url, init }] = twilio.requests;
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(context.signal);
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from(`${SID}:token-for-tests`).toString('base64')}`);
    const form = new URLSearchParams(String(init.body));
    expect(form.get('From')).toBe('+15551230000');
    expect(form.get('Body')).toBe(MESSAGE.text);
  });

  it('says phone, not phones, for one phone', async () => {
    expect(await twilioChannel.send({ ...settings, to: ['+15559870001'] }, MESSAGE, fakeTwilio(created).context()))
      .toEqual({ ok: true, detail: 'Sent to 1 phone' });
  });

  it('sends to the Twilio address that it gets, so a fake Twilio can get the messages in development', async () => {
    const twilio = fakeTwilio(created);

    await createTwilioChannel('http://localhost:4010/').send(settings, MESSAGE, twilio.context());

    expect(twilio.requests[0].url).toBe(`http://localhost:4010/2010-04-01/Accounts/${SID}/Messages.json`);
  });

  it.each([
    [401, 20003, 'Twilio refused the login. Check the Account SID and the auth token.'],
    [404, 20404, 'Twilio does not know this Account SID. Check the Account SID.'],
    [400, 21211, '+15559870001 is not a phone number that Twilio can send to. Check the number.'],
    [400, 21606, 'The From number cannot send text messages for this Twilio account. Use an SMS number of your account.'],
    [400, 21608, '+15559870001 is not verified. A Twilio trial account sends only to numbers that you verify in Twilio.'],
    [400, 21610, '+15559870001 sent STOP to your Twilio number, so Twilio does not send to it. The phone can send START to get texts again.'],
    [400, 21408, 'Your Twilio account cannot send to the country of +15559870001. Turn on the country in the Twilio Messaging Geo Permissions.'],
    [400, 21999, 'Twilio refused the message to +15559870001 (error 21999).'],
  ])('stops at once when Twilio answers %i with error %i, and tells what to do', async (status, code, error) => {
    const twilio = fakeTwilio(() => twilioError(status, code));

    expect(await twilioChannel.send({ ...settings, to: ['+15559870001'] }, MESSAGE, twilio.context()))
      .toEqual({ ok: false, retry: false, error });
  });

  it.each([[429, 20429], [500, undefined], [503, undefined]])('tries again later when Twilio answers %i', async (status, code) => {
    const twilio = fakeTwilio(() => twilioError(status, code));

    expect(await twilioChannel.send({ ...settings, to: ['+15559870001'] }, MESSAGE, twilio.context()))
      .toEqual({ ok: false, retry: true, error: `Twilio answered ${status}. Chatter tries again later.` });
  });

  it('tells the problem one time when it is the same for each phone', async () => {
    const twilio = fakeTwilio(() => twilioError(401, 20003));

    expect(await twilioChannel.send(settings, MESSAGE, twilio.context()))
      .toEqual({ ok: false, retry: false, error: 'Twilio refused the login. Check the Account SID and the auth token.' });
  });

  it('tries again when no phone got the message and a phone can get it later', async () => {
    const twilio = fakeTwilio(to => (to === '+15559870001' ? twilioError(503) : twilioError(400, 21211)));

    const result = await twilioChannel.send(settings, MESSAGE, twilio.context());

    expect(result).toEqual({
      ok: false, retry: true,
      error: 'Twilio answered 503. +15559870002 is not a phone number that Twilio can send to. Check the number. Chatter tries again later.',
    });
  });

  it('does not try again when some phones got the message, so no phone gets it two times', async () => {
    const twilio = fakeTwilio(to => (to === '+15559870001' ? created() : twilioError(503)));

    expect(await twilioChannel.send(settings, MESSAGE, twilio.context())).toEqual({
      ok: false, retry: false,
      error: 'Sent to 1 of 2 phones. Twilio answered 503. Chatter does not try again, so no phone gets the message two times.',
    });
  });

  it('sends to all the phones at the same time, so a slow answer does not use the time limit of the other phones', async () => {
    let waiting = 0;
    let mostWaiting = 0;
    const fetch = (async () => {
      waiting += 1;
      mostWaiting = Math.max(mostWaiting, waiting);
      await new Promise(resolve => setTimeout(resolve, 5));
      waiting -= 1;
      return created();
    }) as typeof globalThis.fetch;

    await twilioChannel.send(settings, MESSAGE, { fetch, signal: new AbortController().signal });

    expect(mostWaiting).toBe(2);
  });

  it('never puts the auth token in the error text', async () => {
    const answers = [() => twilioError(401, 20003), () => new Response('not json', { status: 400 }), () => twilioError(503)];
    for (const answer of answers) {
      const result = await twilioChannel.send(settings, MESSAGE, fakeTwilio(answer).context());
      expect(JSON.stringify(result)).not.toContain('token-for-tests');
    }
  });

  it('gives a plain failure when the Twilio answer is not JSON', async () => {
    const twilio = fakeTwilio(() => new Response('<html>Bad gateway</html>', { status: 400 }));

    expect(await twilioChannel.send({ ...settings, to: ['+15559870001'] }, MESSAGE, twilio.context()))
      .toEqual({ ok: false, retry: false, error: 'Twilio refused the message to +15559870001 (answer 400).' });
  });

  it('tries again later when Chatter cannot reach Twilio, or Twilio does not answer in time', async () => {
    const offline = fakeTwilio(() => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); });
    const slow = fakeTwilio(() => { throw new DOMException('This operation was aborted', 'TimeoutError'); });
    const onePhone = { ...settings, to: ['+15559870001'] };

    expect(await twilioChannel.send(onePhone, MESSAGE, offline.context()))
      .toEqual({ ok: false, retry: true, error: 'Chatter could not reach Twilio (ENOTFOUND). Chatter tries again later.' });
    expect(await twilioChannel.send(onePhone, MESSAGE, slow.context()))
      .toEqual({ ok: false, retry: true, error: 'Twilio did not answer in time. Chatter tries again later.' });
  });

  describe('settings', () => {
    function firstProblem(values: unknown): string | undefined {
      return twilioChannel.settings.safeParse(values).error?.issues[0].message;
    }

    it('accepts a Twilio login, a From number, and one phone number or more', () => {
      expect(firstProblem(settings)).toBeUndefined();
    });

    it.each([
      [{ accountSid: 'SK123' }, 'Account SID starts with AC and has 34 characters'],
      [{ authToken: '  ' }, 'Auth token is necessary'],
      [{ from: '555-123-0000' }, 'From number must start with + and the country code, for example +15551230000'],
      [{ to: [] }, 'Add one phone number or more'],
      [{ to: ['+15559870001', '5559870002'] }, 'Each phone number must start with + and the country code, for example +15559870001'],
      [{ to: Array.from({ length: 21 }, (_, index) => `+1555987${String(index).padStart(4, '0')}`) }, 'Add at most 20 phone numbers'],
    ])('refuses %o', (change, problem) => {
      expect(firstProblem({ ...settings, ...change })).toBe(problem);
    });
  });
});

describe('twilioAddressOf', () => {
  it('is the real Twilio, with nothing to log, when TWILIO_API_URL is not set', () => {
    expect(twilioAddressOf(undefined)).toEqual({ url: TWILIO_API, warning: null });
    expect(twilioAddressOf(' ')).toEqual({ url: TWILIO_API, warning: null });
  });

  it.each(['http://127.0.0.1:4010', 'http://localhost:4010', 'https://twilio-proxy.example.com'])('uses %s, and says so in the log', url => {
    expect(twilioAddressOf(` ${url} `)).toEqual({ url, warning: expect.stringContaining(url) });
  });

  it.each(['http://192.168.1.20:4010', 'ftp://127.0.0.1', 'not an address'])(
    'does not send the auth token to %s, because the token would go over the network as plain text',
    url => {
      expect(twilioAddressOf(url)).toEqual({ url: TWILIO_API, warning: expect.stringContaining('does not use TWILIO_API_URL') });
    },
  );
});
