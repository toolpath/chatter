import Database from 'better-sqlite3';
import { PassThrough, Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { LoginLog } from './loginLog.js';
import { runPasswordReset } from './resetPasswordPrompt.js';
import { authParts } from './testSupport.js';

const BROWSER = { userAgent: 'test browser', address: '192.168.1.20' };
const NEW_PASSWORD = 'new-admin-password';

const USERNAME_PROMPT = 'Username of the new Admin: ';
const PASSWORD_PROMPT = 'Password of the new Admin: ';
const AGAIN_PROMPT = 'Type the password again: ';
const PROMOTE_PROMPT = 'type PROMOTE: ';

/** A terminal for the test: the person types an answer after each prompt shows */
function fakeTerminal(isTTY = true) {
  const input = Object.assign(new PassThrough(), { isTTY });
  let text = '';
  let read = 0;
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      text += chunk.toString();
      done();
    },
  });
  return {
    input,
    output,
    text: () => text,
    /** Wait for the next prompt, then type the answer and Enter */
    async type(prompt: string, answer: string) {
      await vi.waitFor(() => expect(text.indexOf(prompt, read)).toBeGreaterThanOrEqual(0));
      read = text.indexOf(prompt, read) + prompt.length;
      input.write(`${answer}\r`);
    },
  };
}

/** An Admin and an Operator on one database, and the Admin is logged in on one browser */
async function shop() {
  const db = new Database(':memory:');
  const parts = { ...authParts(db), loginLog: new LoginLog(db) };
  const adminSession = (await parts.auth.setUp({ username: 'admin', password: 'admin-password' }, BROWSER))!;
  await parts.accounts.add({ username: 'sam', password: 'sam-password', role: 'operator' });
  return { ...parts, adminSession };
}

const roles = (users: ReturnType<typeof authParts>['users']) =>
  users.list().map(({ username, role }) => `${username}: ${role}`);

describe('npm run reset-password', () => {
  it('asks for the username and the password two times, and makes the new Admin', async () => {
    const { users, sessions, loginLog, auth, adminSession } = await shop();
    const terminal = fakeTerminal();

    const done = runPasswordReset({ ...terminal, users, sessions, loginLog });
    await terminal.type(USERNAME_PROMPT, 'boss');
    await terminal.type(PASSWORD_PROMPT, NEW_PASSWORD);
    await terminal.type(AGAIN_PROMPT, NEW_PASSWORD);

    expect(await done).toBe(true);
    expect(roles(users)).toEqual(['boss: admin', 'sam: operator']);
    expect(auth.sessionOf(adminSession)).toBeNull();
    expect(await auth.logIn({ username: 'boss', password: NEW_PASSWORD }, BROWSER)).not.toBeNull();
    expect(terminal.text()).toContain('boss is the new Admin');
  });

  it('shows the username as the person types it, but never the password', async () => {
    const { users, sessions, loginLog } = await shop();
    const terminal = fakeTerminal();

    const done = runPasswordReset({ ...terminal, users, sessions, loginLog });
    await terminal.type(USERNAME_PROMPT, 'boss');
    await vi.waitFor(() => expect(stripVTControlCharacters(terminal.text())).toContain(`${USERNAME_PROMPT}boss`));
    await terminal.type(PASSWORD_PROMPT, NEW_PASSWORD);
    await terminal.type(AGAIN_PROMPT, NEW_PASSWORD);

    expect(await done).toBe(true);
    expect(terminal.text()).not.toContain(NEW_PASSWORD);
  });

  it('does not show a password that the person types before its question shows', async () => {
    const { users, sessions, loginLog } = await shop();
    const terminal = fakeTerminal();

    const done = runPasswordReset({ ...terminal, users, sessions, loginLog });
    await terminal.type(USERNAME_PROMPT, `boss\r${NEW_PASSWORD}\r${NEW_PASSWORD}`);

    expect(await done).toBe(true);
    expect(users.findByName('boss')?.role).toBe('admin');
    expect(terminal.text()).not.toContain(NEW_PASSWORD);
  });

  it('removes the spaces around the username, as the setup does', async () => {
    const { users, sessions, loginLog } = await shop();
    const terminal = fakeTerminal();

    const done = runPasswordReset({ ...terminal, users, sessions, loginLog });
    await terminal.type(USERNAME_PROMPT, '  boss  ');
    await terminal.type(PASSWORD_PROMPT, NEW_PASSWORD);
    await terminal.type(AGAIN_PROMPT, NEW_PASSWORD);

    expect(await done).toBe(true);
    expect(users.findByName('boss')?.role).toBe('admin');
  });

  it('changes nothing when the two passwords are not the same', async () => {
    const { users, sessions, loginLog, auth, adminSession } = await shop();
    const terminal = fakeTerminal();

    const done = runPasswordReset({ ...terminal, users, sessions, loginLog });
    await terminal.type(USERNAME_PROMPT, 'boss');
    await terminal.type(PASSWORD_PROMPT, NEW_PASSWORD);
    await terminal.type(AGAIN_PROMPT, 'other-password');

    expect(await done).toBe(false);
    expect(terminal.text()).toContain('The two passwords are not the same. Nothing changed.');
    expect(roles(users)).toEqual(['admin: admin', 'sam: operator']);
    expect(auth.sessionOf(adminSession)).not.toBeNull();
  });

  it('changes nothing when the password is too short, and tells the rule of the setup', async () => {
    const { users, sessions, loginLog } = await shop();
    const terminal = fakeTerminal();

    const done = runPasswordReset({ ...terminal, users, sessions, loginLog });
    await terminal.type(USERNAME_PROMPT, 'boss');
    await terminal.type(PASSWORD_PROMPT, 'short');

    expect(await done).toBe(false);
    expect(terminal.text()).toContain('The password must have at least 8 characters. Nothing changed.');
    expect(terminal.text()).not.toContain(AGAIN_PROMPT);
    expect(roles(users)).toEqual(['admin: admin', 'sam: operator']);
  });

  it('changes nothing when the password is the username or a common password', async () => {
    for (const [password, reason] of [
      ['Bossman01', 'The password cannot be the username'],
      ['iloveyou', 'The password is too common. Use a different password'],
    ]) {
      const { users, sessions, loginLog } = await shop();
      const terminal = fakeTerminal();

      const done = runPasswordReset({ ...terminal, users, sessions, loginLog });
      await terminal.type(USERNAME_PROMPT, 'bossman01');
      await terminal.type(PASSWORD_PROMPT, password);

      expect(await done).toBe(false);
      expect(terminal.text()).toContain(`${reason}. Nothing changed.`);
      expect(roles(users)).toEqual(['admin: admin', 'sam: operator']);
    }
  });

  it('changes nothing when the username has a colon, and tells the rule of the setup', async () => {
    const { users, sessions, loginLog } = await shop();
    const terminal = fakeTerminal();

    const done = runPasswordReset({ ...terminal, users, sessions, loginLog });
    await terminal.type(USERNAME_PROMPT, 'ops:west');

    expect(await done).toBe(false);
    expect(terminal.text()).toContain('The username cannot have a colon (:) in it. Nothing changed.');
    expect(terminal.text()).not.toContain(PASSWORD_PROMPT);
    expect(roles(users)).toEqual(['admin: admin', 'sam: operator']);
  });

  it('promotes an Operator after the person types PROMOTE', async () => {
    const { users, sessions, loginLog, auth } = await shop();
    const terminal = fakeTerminal();

    const done = runPasswordReset({ ...terminal, users, sessions, loginLog });
    await terminal.type(USERNAME_PROMPT, 'sam');
    await terminal.type(PROMOTE_PROMPT, 'PROMOTE');
    await terminal.type(PASSWORD_PROMPT, NEW_PASSWORD);
    await terminal.type(AGAIN_PROMPT, NEW_PASSWORD);

    expect(await done).toBe(true);
    expect(terminal.text()).toContain('The user sam exists already, with the role Operator.');
    expect(roles(users)).toEqual(['sam: admin']);
    expect(await auth.logIn({ username: 'sam', password: NEW_PASSWORD }, BROWSER)).not.toBeNull();
  });

  it('changes nothing, and asks for no password, when the person does not type PROMOTE', async () => {
    const { users, sessions, loginLog, auth, adminSession } = await shop();
    const terminal = fakeTerminal();

    const done = runPasswordReset({ ...terminal, users, sessions, loginLog });
    await terminal.type(USERNAME_PROMPT, 'sam');
    await terminal.type(PROMOTE_PROMPT, 'promote');

    expect(await done).toBe(false);
    expect(terminal.text()).toContain('You did not type PROMOTE. Nothing changed.');
    expect(terminal.text()).not.toContain(PASSWORD_PROMPT);
    expect(roles(users)).toEqual(['admin: admin', 'sam: operator']);
    expect(auth.sessionOf(adminSession)).not.toBeNull();
  });

  const STOPS = [
    ['the person presses Ctrl+C', (input: PassThrough) => input.write('\x03')],
    ['the input ends', (input: PassThrough) => input.end()],
  ] as const;
  /** The answers before the question where the person stops */
  const QUESTIONS = [
    ['the username', USERNAME_PROMPT, []],
    ['PROMOTE', PROMOTE_PROMPT, [[USERNAME_PROMPT, 'sam']]],
    ['the password', PASSWORD_PROMPT, [[USERNAME_PROMPT, 'boss']]],
  ] as const;

  it.each(QUESTIONS.flatMap(([question, prompt, answers]) =>
    STOPS.map(([how, stop]) => [how, question, prompt, answers, stop] as const)))(
    'changes nothing when %s at the question for %s',
    async (_how, _question, prompt, answers, stop) => {
      const { users, sessions, loginLog, auth, adminSession } = await shop();
      const terminal = fakeTerminal();

      const done = runPasswordReset({ ...terminal, users, sessions, loginLog });
      for (const [answerPrompt, answer] of answers) await terminal.type(answerPrompt, answer);
      await vi.waitFor(() => expect(terminal.text()).toContain(prompt));
      stop(terminal.input);

      expect(await done).toBe(false);
      expect(terminal.text()).toContain('Stopped. Nothing changed.');
      expect(roles(users)).toEqual(['admin: admin', 'sam: operator']);
      expect(auth.sessionOf(adminSession)).not.toBeNull();
    },
  );

  it.each([
    [' PROMOTE ', true],
    ['Promote', false],
    ['', false],
  ])('accepts the answer "%s" to the PROMOTE question: %s', async (answer, accepted) => {
    const { users, sessions, loginLog } = await shop();
    const terminal = fakeTerminal();

    const done = runPasswordReset({ ...terminal, users, sessions, loginLog });
    await terminal.type(USERNAME_PROMPT, 'sam');
    await terminal.type(PROMOTE_PROMPT, answer);
    if (accepted) {
      await terminal.type(PASSWORD_PROMPT, NEW_PASSWORD);
      await terminal.type(AGAIN_PROMPT, NEW_PASSWORD);
    }

    expect(await done).toBe(accepted);
    expect(users.findByName('sam')?.role).toBe(accepted ? 'admin' : 'operator');
  });

  it('uses the stored name of a promoted user, not the case that the person typed', async () => {
    const { users, sessions, loginLog } = await shop();
    const terminal = fakeTerminal();

    const done = runPasswordReset({ ...terminal, users, sessions, loginLog });
    await terminal.type(USERNAME_PROMPT, 'SAM');
    await terminal.type(PROMOTE_PROMPT, 'PROMOTE');
    await terminal.type(PASSWORD_PROMPT, NEW_PASSWORD);
    await terminal.type(AGAIN_PROMPT, NEW_PASSWORD);

    expect(await done).toBe(true);
    expect(terminal.text()).toContain('sam is the new Admin.');
    expect(terminal.text()).not.toContain('SAM is the new Admin');
  });

  it.each(['admin', 'ADMIN'])('asks no PROMOTE for the name of an old Admin (%s), and makes a new account', async name => {
    const { users, sessions, loginLog, auth } = await shop();
    const oldId = users.findByName('admin')!.id;
    const terminal = fakeTerminal();

    const done = runPasswordReset({ ...terminal, users, sessions, loginLog });
    await terminal.type(USERNAME_PROMPT, name);
    await terminal.type(PASSWORD_PROMPT, NEW_PASSWORD);
    await terminal.type(AGAIN_PROMPT, NEW_PASSWORD);

    expect(await done).toBe(true);
    expect(terminal.text()).not.toContain(PROMOTE_PROMPT);
    expect(users.findByName('admin')?.id).not.toBe(oldId);
    expect(await auth.logIn({ username: 'admin', password: 'admin-password' }, BROWSER)).toBeNull();
    expect(await auth.logIn({ username: name, password: NEW_PASSWORD }, BROWSER)).not.toBeNull();
  });

  it('changes nothing, and tells why, when the save fails', async () => {
    const { users, sessions, loginLog, auth, adminSession } = await shop();
    vi.spyOn(users, 'add').mockImplementation(() => {
      throw new Error('disk full');
    });
    const terminal = fakeTerminal();

    const done = runPasswordReset({ ...terminal, users, sessions, loginLog });
    await terminal.type(USERNAME_PROMPT, 'boss');
    await terminal.type(PASSWORD_PROMPT, NEW_PASSWORD);
    await terminal.type(AGAIN_PROMPT, NEW_PASSWORD);

    expect(await done).toBe(false);
    expect(terminal.text()).toContain('disk full. Nothing changed.');
    expect(terminal.text()).not.toContain('is the new Admin');
    expect(roles(users)).toEqual(['admin: admin', 'sam: operator']);
    expect(auth.sessionOf(adminSession)).not.toBeNull();
    expect(loginLog.recent()).toEqual([]);
  });

  it('stops with no change when there is no terminal, because it cannot hide the password', async () => {
    const { users, sessions, loginLog } = await shop();
    const terminal = fakeTerminal(false);

    expect(await runPasswordReset({ ...terminal, users, sessions, loginLog })).toBe(false);

    expect(terminal.text()).toContain('reset-password needs a terminal');
    expect(terminal.text()).not.toContain(USERNAME_PROMPT);
    expect(roles(users)).toEqual(['admin: admin', 'sam: operator']);
  });
});
