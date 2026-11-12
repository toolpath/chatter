/** Checked in this order: Edge and Opera also say "Chrome", and Chrome also says "Safari" */
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

/** Checked in this order: an iPhone also says "Mac OS X", and Android also says "Linux" */
const SYSTEMS: [RegExp, string][] = [
  [/iPad/, 'iPad'],
  [/iPhone/, 'iPhone'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

const firstMatch = (text: string, names: [RegExp, string][]) => names.find(([pattern]) => pattern.test(text))?.[1];

/** A short name for a browser, like "Chrome on Mac", from its User-Agent header */
export function deviceName(userAgent: string): string {
  const browser = firstMatch(userAgent, BROWSERS);
  const system = firstMatch(userAgent, SYSTEMS);
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? (system ? `A browser on ${system}` : 'An unknown browser');
}
