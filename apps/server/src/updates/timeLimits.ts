/** The longest time an upload or a download of an update file may take. A slow shop network needs this much for 600 MB. */
export const UPDATE_TIME_LIMIT_MS = 60 * 60 * 1000;

/** An upload or a download of an update file stops when no bytes come in for this long */
export const UPDATE_IDLE_LIMIT_MS = 60_000;

/** A time limit in whole seconds, for a message that the Admin reads */
export const wholeSeconds = (ms: number): number => Math.round(ms / 1000);
