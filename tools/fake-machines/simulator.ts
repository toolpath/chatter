import type { Program } from './programs.js';

/**
 * A brand-neutral model of one CNC machine making parts.
 * Each fake machine server reads this state and answers in its own maker's language.
 *
 * The run cycle copies the old chatter-pyMachine emulator:
 * setup -> cut part (tool changes) -> load next part -> ... -> part goal reached -> setup again,
 * with random stops and, now and then, an alarm.
 */

export type Mode = 'MANUAL' | 'MDI' | 'MEMORY' | 'EDIT';
export type Execution = 'READY' | 'ACTIVE' | 'INTERRUPTED' | 'STOPPED';
type Phase = 'setup' | 'cutting' | 'loading' | 'stalled' | 'alarm';

export interface Alarm {
  code: string;
  text: string;
  /** True when the alarm comes from the emergency stop button */
  emergencyStop?: boolean;
}

export interface MachineState {
  mode: Mode;
  execution: Execution;
  program: Program;
  toolNumber: number;
  spindleRpm: number;
  /** Spindle load in percent: 0 when the spindle stops, else 20 to 70 */
  spindleLoad: number;
  partCount: number;
  partGoal: number;
  alarm: Alarm | null;
}

export interface SimulatorOptions {
  programs: Program[];
  alarms: Alarm[];
  /** How many times faster than real time the machine runs */
  speed: number;
  setupSeconds?: number;
  stallChance?: number;
  alarmChance?: number;
  random?: () => number;
}

const TICK_MS = 250;

export class MachineSimulator {
  private readonly options: Required<SimulatorOptions>;
  private phase: Phase = 'setup';
  private secondsLeft = 0;
  private stepIndex = 0;
  private state: MachineState;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SimulatorOptions) {
    this.options = {
      setupSeconds: 60,
      stallChance: 0.04,
      alarmChance: 0.02,
      random: Math.random,
      ...options,
    };
    this.state = {
      mode: 'MDI',
      execution: 'READY',
      program: this.pickProgram(),
      toolNumber: 1,
      spindleRpm: 0,
      spindleLoad: 0,
      partCount: 0,
      partGoal: this.pickPartGoal(),
      alarm: null,
    };
    this.enterSetup();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.advance((TICK_MS / 1000) * this.options.speed), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getState(): MachineState {
    const spindleRpm = this.withJitter(this.state.spindleRpm);
    return { ...this.state, spindleRpm, spindleLoad: this.loadAt(spindleRpm) };
  }

  /** Move the machine forward by a number of machine seconds. */
  advance(seconds: number): void {
    this.secondsLeft -= seconds;
    while (this.secondsLeft <= 0) {
      const carry = this.secondsLeft;
      this.finishPhase();
      this.secondsLeft += carry;
    }
  }

  private finishPhase(): void {
    switch (this.phase) {
      case 'setup': return this.startNewJob();
      case 'cutting': return this.finishStep();
      case 'loading': return this.finishLoading();
      case 'stalled': return this.enterLoading();
      case 'alarm': return this.clearAlarm();
    }
  }

  private enterSetup(): void {
    this.phase = 'setup';
    this.secondsLeft = this.options.setupSeconds;
    Object.assign(this.state, { mode: 'MDI', execution: 'READY', spindleRpm: 0 });
  }

  private startNewJob(): void {
    Object.assign(this.state, { program: this.pickProgram(), partGoal: this.pickPartGoal(), partCount: 0 });
    this.startCutting();
  }

  private startCutting(): void {
    this.stepIndex = 0;
    this.enterStep();
  }

  private enterStep(): void {
    const step = this.state.program.steps[this.stepIndex];
    this.phase = 'cutting';
    this.secondsLeft = step.seconds;
    Object.assign(this.state, {
      mode: 'MEMORY',
      execution: 'ACTIVE',
      toolNumber: step.toolNumber,
      spindleRpm: step.spindleRpm,
    });
  }

  private finishStep(): void {
    this.stepIndex += 1;
    if (this.stepIndex < this.state.program.steps.length) return this.enterStep();

    this.state.partCount += 1;
    if (this.options.random() < this.options.alarmChance) return this.enterAlarm();
    if (this.options.random() < this.options.stallChance) return this.enterStall();
    this.enterLoading();
  }

  private enterLoading(): void {
    this.phase = 'loading';
    this.secondsLeft = this.state.program.loadSeconds * (1 + this.options.random() * 0.2);
    Object.assign(this.state, { execution: 'READY', spindleRpm: 0 });
  }

  private finishLoading(): void {
    if (this.state.partCount >= this.state.partGoal) return this.enterSetup();
    this.startCutting();
  }

  private enterStall(): void {
    this.phase = 'stalled';
    this.secondsLeft = 30 + this.options.random() * 300;
    Object.assign(this.state, { execution: 'INTERRUPTED', spindleRpm: 0 });
  }

  private enterAlarm(): void {
    const alarms = this.options.alarms;
    this.phase = 'alarm';
    this.secondsLeft = 30 + this.options.random() * 90;
    Object.assign(this.state, {
      execution: 'STOPPED',
      spindleRpm: 0,
      alarm: alarms[Math.floor(this.options.random() * alarms.length)] ?? null,
    });
  }

  private clearAlarm(): void {
    this.state.alarm = null;
    this.enterLoading();
  }

  private pickProgram(): Program {
    const programs = this.options.programs;
    return programs[Math.floor(this.options.random() * programs.length)];
  }

  private pickPartGoal(): number {
    return (5 + Math.floor(this.options.random() * 46)) * 5;
  }

  /** The spindle load in percent: 0 when the spindle stops, else 20 to 69. */
  private loadAt(rpm: number): number {
    return rpm === 0 ? 0 : 20 + Math.floor(this.options.random() * 50);
  }

  /** Real spindles drift a few rpm under load. */
  private withJitter(rpm: number): number {
    if (rpm === 0) return 0;
    return rpm - Math.floor(this.options.random() * 4);
  }
}
