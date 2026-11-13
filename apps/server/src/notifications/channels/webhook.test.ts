import { describe, expect, it } from 'vitest';
import type { OutgoingMessage, SendContext } from './ChannelType.js';
import { webhookChannel } from './webhook.js';

const MESSAGE: OutgoingMessage = {
  kind: 'started',
  text: 'WARNING - Haas ST-10: Idle for 20 minutes. Started 9:40 AM.',
  severity: 'warning',
  machine: { id: 'haas-st10', name: 'Haas ST-10' },
  alertName: 'Idle for 20 minutes',
  summary: 'Idle for 20 min or more',
  startedAt: '2026-11-13T15:40:00.000Z',
  endedAt: null,
  link: 'http://chatter.local:3001/machine/haas-st10',
};

interface SentRequest {
  url: string;
  init: RequestInit;
}

/** A fetch that keeps each request and gives the answer of `answer` */
function fakeFetch(answer: () => Response | Promise<Response>) {
  const requests: SentRequest[] = [];
  const fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    requests.push({ url: String(url), init });
    return answer();
  }) as typeof globalThis.fetch;
  return { requests, context: (): SendContext => ({ fetch, signal: new AbortController().signal }) };
}

const settings = { url: 'https://hooks.slack.com/services/T0/B0/x', secret: '' };

function firstProblem(values: unknown): string | undefined {
  return webhookChannel.settings.safeParse(values).error?.issues[0].message;
}

describe('webhookChannel', () => {
  it('asks for a web address and a secret that is not necessary', () => {
    expect(webhookChannel.fields.map(field => [field.key, field.kind, field.required])).toEqual([
      ['url', 'url', true],
      ['secret', 'secret', false],
    ]);
  });

  it('sends the message as JSON, with the text line that Slack shows', async () => {
    const service = fakeFetch(() => new Response('ok', { status: 200 }));

    const result = await webhookChannel.send(settings, MESSAGE, service.context());

    expect(result).toEqual({ ok: true, detail: 'The address answered 200' });
    expect(service.requests).toHaveLength(1);
    const [{ url, init }] = service.requests;
    expect(url).toBe(settings.url);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(new Headers(init.headers).has('authorization')).toBe(false);
    expect(init.redirect).toBe('manual');
    expect(JSON.parse(String(init.body))).toEqual({
      text: MESSAGE.text,
      state: 'started',
      level: 'warning',
      machine: { id: 'haas-st10', name: 'Haas ST-10' },
      alert: 'Idle for 20 minutes',
      summary: 'Idle for 20 min or more',
      startedAt: '2026-11-13T15:40:00.000Z',
      endedAt: null,
      link: 'http://chatter.local:3001/machine/haas-st10',
    });
  });

  it('sends the secret in the Authorization header, so the other app knows the message is from Chatter', async () => {
    const service = fakeFetch(() => new Response(null, { status: 204 }));

    await webhookChannel.send({ ...settings, secret: 's3cret' }, MESSAGE, service.context());

    expect(new Headers(service.requests[0].init.headers).get('authorization')).toBe('Bearer s3cret');
  });

  it('gives the signal of the context to fetch, so a slow address stops after the time limit', async () => {
    const service = fakeFetch(() => new Response(null, { status: 200 }));
    const context = service.context();

    await webhookChannel.send(settings, MESSAGE, context);

    expect(service.requests[0].init.signal).toBe(context.signal);
  });

  it.each([408, 429, 500, 503])('tries again later when the address answers %i (busy or a problem)', async status => {
    const result = await webhookChannel.send(settings, MESSAGE, fakeFetch(() => new Response(null, { status })).context());

    expect(result).toEqual({ ok: false, retry: true, error: `The address answered ${status}. Chatter tries again later.` });
  });

  it('stops at once when the address refuses the message, and tells what to check', async () => {
    const notFound = await webhookChannel.send(settings, MESSAGE, fakeFetch(() => new Response(null, { status: 404 })).context());
    const noLogin = await webhookChannel.send(settings, MESSAGE, fakeFetch(() => new Response(null, { status: 401 })).context());

    expect(notFound).toEqual({ ok: false, retry: false, error: 'The address answered 404. Check the web address.' });
    expect(noLogin).toEqual({ ok: false, retry: false, error: 'The address answered 401. Check the secret.' });
  });

  it('gives the result of the send, also when Chatter cannot close the answer', async () => {
    const response = new Response('ok', { status: 200 });
    response.body!.cancel = () => Promise.reject(new Error('the time limit ended'));

    expect(await webhookChannel.send(settings, MESSAGE, fakeFetch(() => response).context()))
      .toEqual({ ok: true, detail: 'The address answered 200' });
  });

  it('tells to check the web address for a 3xx answer that does not point to another address', async () => {
    expect(await webhookChannel.send(settings, MESSAGE, fakeFetch(() => new Response(null, { status: 304 })).context()))
      .toEqual({ ok: false, retry: false, error: 'The address answered 304. Check the web address.' });
  });

  it('stops at once when the address sends Chatter to another address', async () => {
    const moved = fakeFetch(() => new Response(null, { status: 301, headers: { location: 'https://example.com/new' } }));

    expect(await webhookChannel.send(settings, MESSAGE, moved.context()))
      .toEqual({ ok: false, retry: false, error: 'The address answered 301 and points to another address. Use the new address.' });
  });

  it('tells the network code when Node gives one', async () => {
    const refused = fakeFetch(() => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); });

    expect(await webhookChannel.send(settings, MESSAGE, refused.context()))
      .toEqual({ ok: false, retry: true, error: 'Chatter could not reach the address (ECONNREFUSED).' });
  });

  it('does not put the text of other errors in the message for the user, because the text can have the address in it', async () => {
    const other = fakeFetch(() => { throw new TypeError('Request cannot be constructed from http://a:b@host/'); });

    expect(await webhookChannel.send(settings, MESSAGE, other.context()))
      .toEqual({ ok: false, retry: true, error: 'Chatter could not reach the address.' });
  });

  it.each(['TimeoutError', 'AbortError'])('tries again later when the request stops with %s', async name => {
    const slow = fakeFetch(() => { throw new DOMException('This operation was aborted', name); });

    expect(await webhookChannel.send(settings, MESSAGE, slow.context()))
      .toEqual({ ok: false, retry: true, error: 'The address did not answer in time.' });
  });

  describe('settings', () => {
    it('accepts an http or https address, with or without a secret', () => {
      expect(webhookChannel.settings.safeParse({ url: 'http://192.168.1.20:8123/api/webhook/chatter' }).success).toBe(true);
      expect(webhookChannel.settings.safeParse({ url: 'https://ntfy.sh/shop', secret: 'x' }).success).toBe(true);
    });

    it.each([undefined, '', 'hooks.slack.com/x', 'ftp://example.com/x', 'javascript:alert(1)'])(
      'refuses the address %s, which is missing, not a web address, or not http or https',
      url => {
        expect(firstProblem({ url })).toBe('Web address must start with http:// or https://');
      },
    );

    it('refuses an address with a user name or password in it, and tells where the password goes', () => {
      expect(firstProblem({ url: 'http://user:pass@homeassistant.local/api/webhook/x' }))
        .toBe('Remove the user name and password from the web address. Put a password in Secret.');
    });

    it('sends no secret when the secret is only spaces', async () => {
      const service = fakeFetch(() => new Response(null, { status: 200 }));
      const parsed = webhookChannel.settings.parse({ url: settings.url, secret: '   ' });

      await webhookChannel.send(parsed, MESSAGE, service.context());

      expect(new Headers(service.requests[0].init.headers).has('authorization')).toBe(false);
    });

    it('refuses a secret with spaces or special characters, because a web header cannot carry them', () => {
      expect(firstProblem({ url: settings.url, secret: 'abc é' }))
        .toBe('Secret can have only plain letters, digits, and signs, with no spaces');
    });
  });
});
