import { configureAudit } from './audit.js';
import { configureLogging, type LogLevel } from './logger.js';

export interface CapturedLog {
  /** Each written line, with its level */
  lines: { level: LogLevel; text: string }[];
  /** The text of the lines, of one level or of all, joined with newlines */
  text(level?: LogLevel): string;
  /** Write the log as before */
  restore(): void;
}

/** Keep the log lines in a list, every level, as text. Call restore() at the end of the test. */
export function captureLog(): CapturedLog {
  const lines: CapturedLog['lines'] = [];
  const old = configureLogging({ level: 'debug', format: 'text', sink: (level, text) => lines.push({ level, text }) });
  return {
    lines,
    text: level => lines.filter(line => !level || line.level === level).map(line => line.text).join('\n'),
    restore: () => {
      configureLogging(old);
    },
  };
}

export interface CapturedAudit {
  /** Each line of the audit log, as text */
  lines: string[];
  /** Write the audit log as before */
  restore(): void;
}

/** Keep the lines of the audit log in a list. Call restore() at the end of the test. */
export function captureAudit(): CapturedAudit {
  const lines: string[] = [];
  const old = configureAudit(text => lines.push(text));
  return { lines, restore: () => configureAudit(old) };
}
