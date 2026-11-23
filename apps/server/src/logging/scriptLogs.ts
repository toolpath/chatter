import { configureAudit } from './audit.js';
import { appendToExistingLog } from './LogFile.js';
import { addLogListener } from './logger.js';
import { ServerLog } from './ServerLog.js';

/**
 * For a second process, such as `npm run reset-password`: add its log lines to `logs/chatter.log` and its audit lines
 * to `logs/audit.log` in the data folder, which are in the support bundle. The log view of Settings > Diagnostics does
 * not show them: that view shows the lines of the server process only.
 *
 * It adds a line only to a file that the server made (appendToExistingLog). The server writes an audit line at each
 * start, so the audit file is there after the first start. Returns a function that stops it.
 */
export function connectScriptLogs(dataFolder: string, environment: NodeJS.ProcessEnv = process.env): () => void {
  const { file: logFile, audit: auditFile } = ServerLog.forDataFolder(dataFolder, environment);
  const stopListening = addLogListener(entry => {
    if (logFile) appendToExistingLog(logFile.filePath, entry.text);
  });
  const oldAuditSink = auditFile ? configureAudit(text => appendToExistingLog(auditFile.filePath, text)) : null;
  return () => {
    stopListening();
    if (oldAuditSink) configureAudit(oldAuditSink);
  };
}
