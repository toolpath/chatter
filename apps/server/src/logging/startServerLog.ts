import { configureAudit } from './audit.js';
import { stopOnCrash, type CrashOptions } from './crashHandlers.js';
import { ServerLog } from './ServerLog.js';

export interface ServerLogStart extends Pick<CrashOptions, 'target' | 'exit'> {
  environment?: NodeJS.ProcessEnv;
}

/**
 * Start the server log (in memory and in `dataFolder`/logs), for Settings > Diagnostics, and the audit file next to it.
 * Then an error that nothing caught is logged and written to the file, and Chatter stops. Docker starts it again.
 * index.ts calls this at start-up. Tests give their own target and exit.
 */
export function startServerLog(dataFolder: string, { target, exit, environment = process.env }: ServerLogStart = {}) {
  const serverLog = ServerLog.forDataFolder(dataFolder, environment);
  const stopLogListener = serverLog.listen();
  const { audit } = serverLog;
  const oldAuditSink = audit ? configureAudit(text => audit.write(text)) : null;
  const stopListening = () => {
    stopLogListener();
    if (oldAuditSink) configureAudit(oldAuditSink);
  };
  stopOnCrash({ target, exit, flushLog: () => serverLog.close() });
  return { serverLog, stopListening };
}
