/**
 * Part programs that the fake machines run.
 * Tool numbers, spindle speeds and times come from the old chatter-pyMachine
 * emulator (resources/programs.json), which copied them from real shop runs.
 */

export interface ProgramStep {
  toolNumber: number;
  spindleRpm: number;
  seconds: number;
}

export interface Program {
  name: string;
  /** Program number, used by controls that report only a number (Brother) */
  number: number;
  steps: ProgramStep[];
  /** Time for the operator to unload a part and load the next blank */
  loadSeconds: number;
}

/** High-speed aluminum work: small tools, up to 15,000 rpm */
export const HIGH_SPEED_PROGRAMS: Program[] = [
  {
    name: 'O9904',
    number: 9904,
    loadSeconds: 26,
    steps: [
      { toolNumber: 1, spindleRpm: 13800, seconds: 15 },
      { toolNumber: 5, spindleRpm: 15000, seconds: 85 },
      { toolNumber: 6, spindleRpm: 15000, seconds: 43 },
      { toolNumber: 12, spindleRpm: 4800, seconds: 23 },
      { toolNumber: 13, spindleRpm: 2500, seconds: 13 },
      { toolNumber: 14, spindleRpm: 15000, seconds: 59 },
      { toolNumber: 20, spindleRpm: 1500, seconds: 59 },
    ],
  },
  {
    name: 'O5001',
    number: 5001,
    loadSeconds: 18,
    steps: [
      { toolNumber: 1, spindleRpm: 13800, seconds: 15 },
      { toolNumber: 6, spindleRpm: 15000, seconds: 43 },
      { toolNumber: 15, spindleRpm: 14290, seconds: 20 },
    ],
  },
];

/** Heavier steel work: bigger tools, lower spindle speeds */
export const HEAVY_PROGRAMS: Program[] = [
  {
    name: 'O9906',
    number: 9906,
    loadSeconds: 82,
    steps: [
      { toolNumber: 2, spindleRpm: 1200, seconds: 20 },
      { toolNumber: 6, spindleRpm: 2300, seconds: 12 },
      { toolNumber: 4, spindleRpm: 1500, seconds: 20 },
    ],
  },
  {
    name: 'O9905',
    number: 9905,
    loadSeconds: 38,
    steps: [
      { toolNumber: 2, spindleRpm: 2050, seconds: 90 },
      { toolNumber: 12, spindleRpm: 2400, seconds: 20 },
      { toolNumber: 8, spindleRpm: 1500, seconds: 57 },
    ],
  },
];
