const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const UNIT_MS: Record<string, number> = { s: SECOND_MS, m: MINUTE_MS, h: HOUR_MS, d: DAY_MS, w: WEEK_MS };

/** "-1h" or "10s" in milliseconds. The query schema already checked the form. */
export function durationMs(text: string): number {
  const match = /^-?(\d+)([smhdw])$/.exec(text);
  if (!match) throw new Error(`Not a duration: ${text}`);
  const [, count, unit] = match;
  return Number(count) * UNIT_MS[unit];
}
