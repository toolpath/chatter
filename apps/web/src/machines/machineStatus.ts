import type { Machine, MachineData } from '../types';

/**
 * What a machine does now. The pages show these states with a color, a word and an icon.
 * - alarm: the machine reports an alarm
 * - running: a program runs, or the spindle turns
 * - idle: connected, but nothing runs
 * - connecting: the server tries to reach the machine for the first time, for at most 30 seconds
 * - offline: the server cannot reach the machine
 */
export type MachineState = 'running' | 'idle' | 'alarm' | 'connecting' | 'offline';

/** Shown in place of a value the machine does not send */
export const NO_VALUE = '—';

export const STATE_LABELS: Record<MachineState, string> = {
  running: 'Running',
  idle: 'Idle',
  alarm: 'Alarm',
  connecting: 'Connecting',
  offline: 'Offline',
};

/** The machine says a program runs: MTConnect "execution" or the FANUC "run state" */
function reportsProgramRunning(data: MachineData): boolean {
  return data.execution === 'ACTIVE' || data.runState === 'START';
}

function spindleTurns(data: MachineData): boolean {
  return (data.spindleSpeed ?? 0) > 0;
}

export function machineStateOf(machine: Machine): MachineState {
  // Before the first good poll the values are not real yet, even when the network connection is open
  if (machine.connecting) return 'connecting';
  if (!machine.connected) return 'offline';
  if (machine.data.alarm) return 'alarm';
  if (reportsProgramRunning(machine.data) || spindleTurns(machine.data)) return 'running';
  return 'idle';
}

/** True when the server gets values from the machine now. Values from before are old, so the pages do not show them. */
export function isReachable(state: MachineState): boolean {
  return state !== 'connecting' && state !== 'offline';
}

const TYPE_LABELS: Record<string, string> = {
  brother: 'Brother CNC',
  haas: 'Haas CNC',
  mtconnect: 'MTConnect',
  fanuc: 'FANUC CNC',
  siemens: 'Siemens SINUMERIK',
};

export function machineTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? 'CNC machine';
}

/** The MTConnect agent types the edit form offers, and the maker each one names */
export const AGENT_MAKERS: Record<string, string> = {
  generic: 'Generic',
  dmg_mori: 'DMG Mori',
  hurco: 'Hurco',
  okuma: 'Okuma',
  mazak: 'Mazak',
};

/** The maker name for an MTConnect machine whose maker ChatterBox does not know */
const UNKNOWN_MTCONNECT_MAKER = 'MTConnect';

/** The company that made the machine, when ChatterBox knows it */
export function makerOf(machine: Machine): string {
  switch (machine.type) {
    case 'brother': return 'Brother';
    case 'haas': return 'Haas';
    case 'fanuc': return 'FANUC';
    case 'siemens': return 'Siemens';
    case 'mtconnect': return mtConnectMakerOf(machine.agentType);
  }
}

/** The "generic" agent names no maker, so it gets the same name as an unknown agent */
function mtConnectMakerOf(agentType: string | undefined): string {
  if (!agentType || agentType === 'generic') return UNKNOWN_MTCONNECT_MAKER;
  return AGENT_MAKERS[agentType] ?? UNKNOWN_MTCONNECT_MAKER;
}

/** The port the server reads the machine's data from */
export function dataPortOf(machine: Machine): number | undefined {
  switch (machine.type) {
    case 'brother':
    case 'haas':
      return machine.dataPort;
    case 'mtconnect':
      return machine.mtConnectPort;
    case 'fanuc':
      return machine.focasPort;
    case 'siemens':
      return machine.opcuaPort;
  }
}

/** "192.168.1.50:10000" */
export function machineAddress(machine: Machine): string {
  const port = dataPortOf(machine);
  return port ? `${machine.host}:${port}` : machine.host;
}

export interface PartCount {
  /** "17 / 50", or "17" when the machine has no part goal */
  text: string;
  /** From 0 to 1, or null when there is no part goal */
  fraction: number | null;
}

/** The parts made, and how far they are to the goal. Null when the machine sends no part count. */
export function partCountOf(data: MachineData): PartCount | null {
  if (typeof data.partCount !== 'number') return null;
  const goal = data.partGoal;
  if (typeof goal !== 'number' || goal <= 0) return { text: String(data.partCount), fraction: null };
  return { text: `${data.partCount} / ${goal}`, fraction: Math.min(data.partCount / goal, 1) };
}

/** "8,000 rpm", or null when the machine sends no spindle speed */
export function spindleSpeedText(data: MachineData): string | null {
  if (typeof data.spindleSpeed !== 'number') return null;
  return `${Math.round(data.spindleSpeed).toLocaleString('en-US')} rpm`;
}

export interface SpindleLoad {
  /** "37%" */
  text: string;
  /** From 0 to 1; full at 100% load */
  fraction: number;
}

/** The spindle load as text and as a bar fraction, or null when the machine sends no spindle load */
export function spindleLoadOf(data: MachineData): SpindleLoad | null {
  if (typeof data.spindleLoad !== 'number') return null;
  return { text: `${Math.round(data.spindleLoad)}%`, fraction: clampToFraction(data.spindleLoad / 100) };
}

function clampToFraction(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/** "T12", or null when the machine sends no tool number */
export function toolText(data: MachineData): string | null {
  return typeof data.toolNumber === 'number' ? `T${data.toolNumber}` : null;
}
