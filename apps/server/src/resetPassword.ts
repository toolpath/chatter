/**
 * Make a new Admin, for when no Admin knows their password. It asks for the username and the password on the terminal.
 * The old Admin accounts are removed, and each browser is logged out. The users who are not Admins stay.
 * The first-run setup stays closed, so no other person on the network can make the Admin.
 *
 *   docker compose exec chatterbox npm run reset-password
 */
import 'dotenv/config';
import { LoginLog } from './auth/loginLog.js';
import { runPasswordReset } from './auth/resetPasswordPrompt.js';
import { SessionStore } from './auth/sessionStore.js';
import { UserStore } from './auth/userStore.js';
import { connectScriptLogs } from './logging/scriptLogs.js';
import { closeDatabase, dataFolder, getDb } from './storage/database.js';

// The warning about the new Admin also goes to the log file and to the audit log of the server, which are in the
// support bundle. The row in the login log (Settings > Logins) shows the reset in the app.
const stopListening = connectScriptLogs(dataFolder());
try {
  const db = getDb();
  const done = await runPasswordReset({
    input: process.stdin,
    output: process.stdout,
    users: new UserStore(db),
    sessions: new SessionStore(db),
    loginLog: new LoginLog(db),
  });
  if (!done) process.exitCode = 1;
} finally {
  stopListening();
  await closeDatabase();
}
