/**
 * A person can type a password in the username field. When no user has that username, the logs must not keep the text.
 * The login log (Settings > Logins), the server log and the audit log keep only a short start of the text and its
 * length, for example "jo… (12 characters)". The start helps an Admin to see a mistyped username, such as "jo" for "john".
 *
 * The start has at most MAX_SHOWN characters, and never more than a third of the text. 2 characters of a password
 * of 8 or more characters tell little. A text of 3 to 5 characters shows 1 character, and a text of 1 or 2 shows none.
 * The cut is on whole characters (code points), so it never cuts an emoji in half.
 * A control character in the start stays as it is: the log escapes it, as for each other value.
 */
const MAX_SHOWN = 2;

/** The start of the text, "…" and the length in characters */
export function maskUnknownUsername(username: string): string {
  const characters = [...username];
  const shown = Math.min(MAX_SHOWN, Math.floor(characters.length / 3));
  const count = characters.length;
  return `${characters.slice(0, shown).join('')}… (${count} ${count === 1 ? 'character' : 'characters'})`;
}

/** The end of a masked text, for example "… (12 characters)" */
const MASKED_END = /… \(\d+ characters?\)$/u;

/**
 * The text masked, but a text that is already masked stays as it is.
 * An older version saved an unknown username in full in the login log. Settings > Logins masks such a row when it shows it.
 */
export const maskedOnce = (text: string): string => (MASKED_END.test(text) ? text : maskUnknownUsername(text));

/** The username for a log: in full for a user that exists, else masked, because it can be a password */
export const usernameForLog = (users: { hasUser(username: string): boolean }, username: string): string =>
  users.hasUser(username) ? username : maskUnknownUsername(username);
