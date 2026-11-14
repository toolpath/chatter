// A fake Twilio and a fake webhook receiver, so you can try Chatter notifications without a Twilio account.
// It sends nothing out. It prints each message that Chatter sends, and answers like the real service.

export interface FakeRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string;
}

export interface FakeAnswer {
  status: number;
  body: object;
  /** One line for the terminal */
  printed: string;
}

export interface FakeOptions {
  /** The answer to each webhook, for example 500 to see how Chatter tries again */
  webhookStatus: number;
}

const TWILIO_MESSAGES_PATH = /^\/2010-04-01\/Accounts\/(AC[0-9a-fA-F]{32})\/Messages\.json$/;
const TWILIO_PATHS = '/2010-04-01/';
const WRONG_TOKEN = 'wrong';

/**
 * Phone numbers that make the fake refuse, with the Twilio error that Chatter must explain.
 * The first two are also test numbers of the real Twilio.
 */
const REFUSED_PHONES: Record<string, { code: number; message: string }> = {
  '+15005550001': { code: 21211, message: "The 'To' number is not a valid phone number." },
  '+15005550004': { code: 21610, message: 'Attempt to send to unsubscribed recipient' },
  '+15005550008': { code: 21608, message: 'The number is unverified. Trial accounts cannot send messages to unverified numbers.' },
};

export function answer(request: FakeRequest, options: FakeOptions): FakeAnswer {
  if (request.method !== 'POST') return { status: 404, body: { error: 'Not found' }, printed: `${request.method} ${request.path}: not a post` };
  const twilioMatch = TWILIO_MESSAGES_PATH.exec(request.path);
  if (twilioMatch) return twilioAnswer(twilioMatch[1], request);
  // A wrong Twilio address must fail, as at the real Twilio, so the fake does not hide it
  if (request.path.startsWith(TWILIO_PATHS)) {
    return twilioError({ status: 404, code: 20404, message: 'The requested resource was not found', printed: `Twilio ${request.path}: not a messages address` });
  }
  return webhookAnswer(request, options);
}

function twilioAnswer(accountSid: string, request: FakeRequest): FakeAnswer {
  const form = new URLSearchParams(request.body);
  const to = form.get('To') ?? '';
  const from = form.get('From') ?? '';
  const text = form.get('Body') ?? '';

  if (authTokenOf(request.headers.authorization) === WRONG_TOKEN) {
    return twilioError({ status: 401, code: 20003, message: 'Authenticate', printed: `Text message to ${to}: login refused` });
  }
  const refusal = REFUSED_PHONES[to];
  if (refusal) return twilioError({ status: 400, ...refusal, printed: `Text message to ${to}: refused with error ${refusal.code}` });

  return {
    status: 201,
    body: { sid: `SM${Date.now().toString(16).padStart(32, '0')}`, account_sid: accountSid, status: 'queued', to, from, body: text },
    printed: `Text message to ${to} from ${from}: ${text}`,
  };
}

interface TwilioRefusal {
  status: number;
  code: number;
  message: string;
  printed: string;
}

function twilioError({ status, code, message, printed }: TwilioRefusal): FakeAnswer {
  return { status, body: { code, message, status, more_info: `https://www.twilio.com/docs/errors/${code}` }, printed };
}

/** The password part of a Basic login. Twilio uses the auth token as the password. */
function authTokenOf(authorization: string | undefined): string | null {
  if (!authorization?.startsWith('Basic ')) return null;
  const login = Buffer.from(authorization.slice('Basic '.length), 'base64').toString();
  return login.slice(login.indexOf(':') + 1);
}

function webhookAnswer(request: FakeRequest, { webhookStatus }: FakeOptions): FakeAnswer {
  // Only whether there is a secret, never the secret: the terminal output can end up in a bug report
  const secretNote = request.headers.authorization ? 'with a secret' : 'no secret';
  return {
    status: webhookStatus,
    body: { ok: webhookStatus < 300 },
    printed: `Webhook ${request.path} (${secretNote}): ${request.body}`,
  };
}
