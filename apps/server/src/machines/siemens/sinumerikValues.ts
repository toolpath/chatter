/**
 * The SINUMERIK values that Chatter reads over OPC UA, and what they mean.
 *
 * The control's OPC UA server gives each NC variable (the "BTSS" variables of the HMI) as
 * the node `ns=2;s=<path>`, for example `ns=2;s=/Channel/State/chanStatus`. Without a unit
 * in the path, the control reads channel 1 and the first spindle.
 *
 * The paths marked "verified" were read on SINUMERIK 828D controls (DN Solutions machines).
 * The others come from the SINUMERIK variable list and are read only when the control has them.
 */

/** The namespace of the SINUMERIK NC variables */
export const SINUMERIK_NAMESPACE = 2;

export const SINUMERIK_PATHS = {
  /** Verified. 0 = reset, 1 = active, 2 = interrupted. Some Siemens documents give other numbers. */
  channelStatus: '/Channel/State/chanStatus',
  /** Verified. 1 = interrupted, 2 = stopped, 3 = running, 4 = waiting, 5 = aborted or ended */
  programStatus: '/Channel/State/progStatus',
  /** Verified. 0 = JOG, 1 = MDA, 2 = AUTO */
  operatingMode: '/Bag/State/opMode',
  /** Verified. The main program that is selected, as a full path such as /_N_WKS_DIR/_N_PART_WPD/_N_PART_MPF */
  selectedProgram: '/Channel/ProgramInfo/selectedWorkPProg',
  /** Verified. The part counter. The control counts only when it is set up to (MD27880). */
  partCount: '/Channel/State/actParts',
  /** The number of parts to make */
  partGoal: '/Channel/State/reqParts',
  /** Verified. The tool in the spindle */
  toolNumber: '/Channel/State/actTNumber',
  /** Verified. The name of the tool in the spindle */
  toolName: '/Channel/State/actToolIdent',
  /** The speed of the first spindle, in rpm */
  spindleSpeed: '/Channel/Spindle/actSpeed',
  /** The drive load of the first spindle, in percent */
  spindleLoad: '/Channel/Spindle/driveLoad',
  /** The path feed */
  feedrate: '/Channel/State/actFeedRateIpo',
  /** The feed override, in percent */
  feedOverride: '/Channel/State/feedRateIpoOvr',
} as const;

export type SinumerikValueName = keyof typeof SINUMERIK_PATHS;

/** The node id of a SINUMERIK variable */
export function sinumerikNodeId(path: string): string {
  return `ns=${SINUMERIK_NAMESPACE};s=${path}`;
}

/**
 * The path of R parameter `number` of channel 1. The rows of a SINUMERIK array start at 1,
 * so R0 is row 1.
 */
export function rParameterPath(number: number): string {
  return `/Channel/Parameter/R[u1,${number + 1}]`;
}

/** The channel status, in the MTConnect execution words that the rest of Chatter uses */
const EXECUTION_OF_CHANNEL_STATUS: Record<number, string> = {
  0: 'READY',
  1: 'ACTIVE',
  2: 'INTERRUPTED',
};

export function executionOf(channelStatus: number | undefined): string | undefined {
  if (channelStatus === undefined) return undefined;
  return EXECUTION_OF_CHANNEL_STATUS[channelStatus] ?? `UNKNOWN_${channelStatus}`;
}

const PROGRAM_STATUS_NAMES: Record<number, string> = {
  1: 'INTERRUPTED',
  2: 'STOPPED',
  3: 'RUNNING',
  4: 'WAITING',
  5: 'ABORTED',
};

export function programStatusName(programStatus: number | undefined): string | undefined {
  if (programStatus === undefined) return undefined;
  return PROGRAM_STATUS_NAMES[programStatus] ?? `UNKNOWN_${programStatus}`;
}

/** The names that a SINUMERIK operator knows */
const MODE_NAMES: Record<number, string> = {
  0: 'JOG',
  1: 'MDA',
  2: 'AUTO',
};

export function modeName(operatingMode: number | undefined): string | undefined {
  if (operatingMode === undefined) return undefined;
  return MODE_NAMES[operatingMode] ?? `UNKNOWN_${operatingMode}`;
}

/**
 * The program name as the operator sees it: /_N_WKS_DIR/_N_PART_WPD/_N_PART1_MPF → PART1.MPF.
 * A name in another form stays as it is.
 */
export function programDisplayName(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const last = path.trim().split('/').filter(Boolean).at(-1);
  if (!last) return undefined;
  const match = /^_N_(.+)_([A-Z]{3})$/i.exec(last);
  return match ? `${match[1]}.${match[2].toUpperCase()}` : last;
}

/**
 * SINUMERIK puts the alarm number at the start of the alarm message, for example
 * "700209 | [M,Door] Door request" or "10208 Continue program with NC start".
 * The condition name of every alarm is "SystemCondition", so the number must come from the message.
 */
export function splitAlarmText(message: string): { code?: string; text: string } {
  const match = /^\s*(\d{3,7})\s*[|:-]?\s*([\s\S]*)$/.exec(message);
  if (!match) return { text: message.trim() };
  return { code: match[1], text: match[2].trim() };
}
