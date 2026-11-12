const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** "45 s", "12 min", "3 h 25 min", or "5 h" */
export function formatDuration(ms: number): string {
  if (ms >= SECOND && ms < MINUTE) return `${Math.floor(ms / SECOND)} s`;
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

/** The part of the whole as a whole percent, such as "63%". Empty when the whole is zero. */
export function formatShare(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '';
}
