// ============================================
// When a machine counts as running
// ============================================

/**
 * The FANUC run states (ODBST.run) in which a program runs: START (automatic operation) and MSTR.
 * STOP and HOLD are not cutting, and RESET is not either.
 */
export const RUNNING_RUN_STATES: readonly string[] = ['START', 'MSTR'];

/** The MTConnect execution word (also used for Brother, Haas and Siemens) for a program that runs */
export const RUNNING_EXECUTION = 'ACTIVE';

/** The values that tell whether a machine runs */
export interface RunningValues {
  /** The FANUC run state: RESET, STOP, HOLD, START or MSTR */
  runState?: unknown;
  /** The MTConnect execution: ACTIVE, READY, FEED_HOLD, INTERRUPTED, STOPPED */
  execution?: unknown;
}

/**
 * True when the machine says a program runs. The dashboard and the machine history both use this rule.
 * Undefined when the machine tells neither a run state nor an execution.
 *
 * A turning spindle does not count: the spindle can turn while a program is held (HOLD, FEED_HOLD),
 * or in MDI or JOG with no program, and none of that is the machine running a job.
 */
export function isMachineRunning(values: RunningValues): boolean | undefined {
  if (typeof values.runState === 'string') return RUNNING_RUN_STATES.includes(values.runState);
  if (typeof values.execution === 'string') return values.execution === RUNNING_EXECUTION;
  return undefined;
}
