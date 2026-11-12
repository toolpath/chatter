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
  [key: string]: string | number | boolean | ToolTable | null | undefined;
}
