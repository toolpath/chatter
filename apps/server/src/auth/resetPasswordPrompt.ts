import { newPasswordProblem, type Role } from '@local-chatter/shared';
import { createInterface, type Interface } from 'node:readline';
import { Writable } from 'node:stream';
import { setUpSchema } from '../routes/schemas.js';
import { resetAdmins, type AdminResetStores } from './adminReset.js';
import { hashPassword } from './passwords.js';

/**
 * The questions of `npm run reset-password`: the username of the new Admin, and its password two times.
 * The password is never a command-line argument, because `ps` and the shell history show the arguments.
 */

const PROMOTE_WORD = 'PROMOTE';
const NOTHING_CHANGED = 'Nothing changed.';
/** The names of the roles on the screens and in the docs */
const ROLE_NAMES: Record<Role, string> = { viewer: 'Viewer', operator: 'Operator', admin: 'Admin' };

export interface PasswordResetRun extends AdminResetStores {
  /** The keyboard. It must be a terminal, so the password does not show. */
  input: NodeJS.ReadableStream & { isTTY?: boolean };
  output: NodeJS.WritableStream;
}

/** The person stopped the questions (Ctrl+C), or the input ended */
class StoppedError extends Error {}

/**
 * Reads one answer at a time. A hidden answer does not show while the person types it.
 * Only the open visible question shows what the person types. So a password that the person types or pastes
 * before its question shows does not show either.
 */
class Prompt {
  private readonly answers: string[] = [];
  private waiting: ((answer: string | null) => void) | null = null;
  private closed = false;
  private hidden = true;
  private readonly lines: Interface;

  constructor(input: NodeJS.ReadableStream, private readonly output: NodeJS.WritableStream) {
    // readline shows what the person types through this stream, so it writes nothing while it is hidden
    const echo = new Writable({
      write: (chunk, _encoding, done) => {
        if (!this.hidden) output.write(chunk);
        done();
      },
    });
    // No history: the Up arrow must never show an answer from before, such as a password
    this.lines = createInterface({ input, output: echo, terminal: true, historySize: 0 });
    this.lines.on('line', answer => this.give(answer));
    this.lines.on('SIGINT', () => this.lines.close());
    this.lines.on('close', () => {
      this.closed = true;
      this.give(null);
    });
  }

  ask(question: string): Promise<string> {
    return this.next(question);
  }

  async askHidden(question: string): Promise<string> {
    try {
      return await this.next(question, true);
    } finally {
      // The Enter of the hidden answer did not show either
      this.output.write('\n');
    }
  }

  close(): void {
    this.lines.close();
  }

  private async next(question: string, hidden = false): Promise<string> {
    if (hidden) {
      this.output.write(question);
    } else {
      // The prompt of readline, so that a Backspace writes the line again with the question
      this.hidden = false;
      this.lines.setPrompt(question);
      this.lines.prompt();
    }
    try {
      const answer = this.answers.shift() ?? (this.closed ? null : await new Promise<string | null>(resolve => {
        this.waiting = resolve;
      }));
      if (answer === null) throw new StoppedError();
      return answer;
    } finally {
      this.hidden = true;
    }
  }

  private give(answer: string | null): void {
    // The next characters can be the answer to a hidden question
    this.hidden = true;
    const waiting = this.waiting;
    this.waiting = null;
    if (waiting) waiting(answer);
    else if (answer !== null) this.answers.push(answer);
  }
}

/**
 * Ask for the new Admin, then replace the Admins with it (see resetAdmins).
 * Returns true when the new Admin exists. Else nothing changed, and the output tells why.
 */
export async function runPasswordReset({ input, output, ...stores }: PasswordResetRun): Promise<boolean> {
  const say = (text: string) => output.write(`${text}\n`);
  if (input.isTTY !== true) {
    say('reset-password needs a terminal, because it asks for a password and must hide it.');
    say('Run it with "docker compose exec", without -T. ' + NOTHING_CHANGED);
    return false;
  }

  const prompt = new Prompt(input, output);
  try {
    say('This makes a new Admin. It removes each Admin account, and logs out each browser.');
    const username = setUpSchema.shape.username.safeParse(await prompt.ask('Username of the new Admin: '));
    if (!username.success) return stop(say, username.error.issues[0].message);

    const existing = stores.users.findByName(username.data);
    const promote = existing !== null && existing.role !== 'admin';
    if (promote) {
      say(`The user ${existing.username} exists already, with the role ${ROLE_NAMES[existing.role]}.`);
      say('This user becomes the Admin, with the new password.');
      const answer = await prompt.ask(`To continue, type ${PROMOTE_WORD}: `);
      if (answer.trim() !== PROMOTE_WORD) return stop(say, `You did not type ${PROMOTE_WORD}.`);
    }

    const password = await prompt.askHidden('Password of the new Admin: ');
    // The rule of the setup: 8 characters or more, not the username, and not a common password
    const problem = newPasswordProblem(password, username.data);
    if (problem) return stop(say, problem);
    if (await prompt.askHidden('Type the password again: ') !== password) {
      return stop(say, 'The two passwords are not the same.');
    }

    const passwordHash = await hashPassword(password);
    const admin = resetAdmins(stores, { username: username.data, passwordHash }, { promote });
    say(`${admin.username} is the new Admin. Each browser is logged out. Log in to Chatter with the new password.`);
    return true;
  } catch (error) {
    if (error instanceof StoppedError) return stop(say, 'Stopped.');
    if (error instanceof Error) return stop(say, error.message);
    throw error;
  } finally {
    prompt.close();
  }
}

function stop(say: (text: string) => void, reason: string): false {
  say(`${reason.replace(/\.?$/, '.')} ${NOTHING_CHANGED}`);
  return false;
}
