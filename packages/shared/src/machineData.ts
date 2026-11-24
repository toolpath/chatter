// ============================================
// Shared Machine Data Types
// ============================================

export interface MacroConfig {
  location: number;
  name?: string;
}

export interface ToolInfo {
  toolNum: number;
  length?: number;
  lengthWear?: number;
  diameter?: number;
  diameterWear?: number;
  name?: string;
}

export interface ToolTable {
  [pot: number]: ToolInfo;
}

/** One spindle of a machine with several, such as the main spindle or the sub-spindle of a lathe */
export interface MachineSpindle {
  /** The name on the control screen, such as "S1" or "S3" */
  name: string;
  /** In rpm */
  speed?: number;
  /** In percent */
  load?: number;
}

/** One path (channel) of a control with several, such as a two-path lathe. Path 1 is the main path. */
export interface MachinePath {
  path: number;
  /** The FANUC run state of the path: RESET, STOP, HOLD, START or MSTR */
  runState?: string;
  /** The FANUC axis motion status of the path: 0 none, 1 moving, 2 dwell */
  motion?: number;
  program?: string;
  /** The full name of the program on the control, such as "//DATA_SV/O6000", when the control gives it */
  programPath?: string;
  spindles: MachineSpindle[];
}

/**
 * Normalized machine data interface - all machine types use these field names
 */
export interface MachineData {
  mode?: string;
  program?: string;
  partCount?: number;
  partGoal?: number;
  toolNumber?: number;
  spindleSpeed?: number;
  /** Spindle load in percent. Undefined when the machine does not tell it. */
  spindleLoad?: number;
  alarm?: boolean;
  alarmCode?: string;
  alarmText?: string;
  /** What the program does, in MTConnect execution words: ACTIVE (runs), READY, FEED_HOLD, INTERRUPTED, STOPPED */
  execution?: string;
  [key: string]: string | number | boolean | ToolTable | ToolSyncState | MachinePath[] | null | undefined;
}

/**
 * The reads of the tool table and the tool data. Chatter reads them only when a user presses Sync. Times are ISO
 * text, null when there was none.
 */
export interface ToolSyncState {
  /** The end of the last good read. Null: not synced yet. */
  lastSyncAt: string | null;
  /** The end of the last read, good or not */
  lastAttemptAt: string | null;
  /** Why the last read failed. Null when it was good, or when there was none. */
  error: string | null;
  running: boolean;
}
