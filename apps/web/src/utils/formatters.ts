/** The time in the browser's local format, or "Never" when there is no time */
export function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return 'Never';
  return new Date(isoString).toLocaleString();
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "1 s ago", "14 min ago", "3 h ago", "2 d ago", or "Never" */
export function formatAgo(isoString: string | null | undefined, now: number): string {
  if (!isoString) return 'Never';
  const ageMs = Math.max(0, now - Date.parse(isoString));
  if (ageMs < MINUTE) return `${Math.floor(ageMs / SECOND)} s ago`;
  if (ageMs < HOUR) return `${Math.floor(ageMs / MINUTE)} min ago`;
  if (ageMs < DAY) return `${Math.floor(ageMs / HOUR)} h ago`;
  return `${Math.floor(ageMs / DAY)} d ago`;
}

const BYTES_PER_KILOBYTE = 1024;
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];

/** "0 B", "512 B", "1.5 KB", "3 MB": one decimal at most, with no ".0" */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (!bytes) return '';
  const unitIndex = Math.floor(Math.log(bytes) / Math.log(BYTES_PER_KILOBYTE));
  const sizeInUnit = bytes / Math.pow(BYTES_PER_KILOBYTE, unitIndex);
  return `${parseFloat(sizeInUnit.toFixed(1))} ${SIZE_UNITS[unitIndex]}`;
}
