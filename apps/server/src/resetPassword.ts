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
import { configureAudit } from './logging/audit.js';
import { appendToExistingLog } from './logging/LogFile.js';
import { addLogListener } from './logging/logger.js';
import { ServerLog } from './logging/ServerLog.js';
import { closeDatabase, dataFolder, getDb } from './storage/database.js';

// The warning about the new Admin also goes to the log file `logs/chatter.log` in the data folder, which is in the
// support bundle. The log view of Settings > Diagnostics does not show it: that view shows the lines of the server
// process only. The row in the login log (Settings > Logins) shows the reset in the app.
const { file: logFile, audit: auditFile } = ServerLog.forDataFolder(dataFolder());
const stopListening = addLogListener(entry => {
  if (logFile) appendToExistingLog(logFile.filePath, entry.text);
});
// The new Admin also goes to the audit log `logs/audit.log`, when the server made that file
if (auditFile) configureAudit(text => appendToExistingLog(auditFile.filePath, text));
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
