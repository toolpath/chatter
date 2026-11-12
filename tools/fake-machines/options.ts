const DEFAULT_SPEED = 5;
const DEFAULT_API = 'http://localhost:3001';
/** A real Brother takes 5 to 15 seconds to answer the first poll */
const DEFAULT_SLOW_START_SECONDS = 10;

export interface CliOptions {
  speed: number;
  add: boolean;
  api: string;
  /** Let other devices on the local network reach the machines */
  lan: boolean;
  /** How long the Brother and Haas controls answer slowly after Chatter connects. 0 turns it off. */
  slowStartSeconds: number;
}

export function readOptions(args: string[]): CliOptions {
  const valueAfter = (flag: string) => {
    const index = args.indexOf(flag);
    if (index === -1) return undefined;
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    return value;
  };
  const speed = Number(valueAfter('--speed') ?? DEFAULT_SPEED);
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('--speed must be a number above 0');
  const slowStartSeconds = Number(valueAfter('--slow-start') ?? DEFAULT_SLOW_START_SECONDS);
  if (!Number.isFinite(slowStartSeconds) || slowStartSeconds < 0) throw new Error('--slow-start must be 0 or more seconds');
  return {
    speed,
    add: args.includes('--add'),
    api: valueAfter('--api') ?? DEFAULT_API,
    lan: args.includes('--lan'),
    slowStartSeconds,
  };
}
