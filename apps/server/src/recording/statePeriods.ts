import { STATE_PERIOD_KINDS, type StatePeriodKind } from '@local-chatter/shared';
import type { MachineDataSnapshot } from '../types/index.js';

/** The value of each state of one machine at one time. A state that is not known is left out. */
export type StateValues = Partial<Record<StatePeriodKind, string>>;

/** The value of an alarm that has no code and no text */
const ALARM_WITHOUT_DETAILS = 'alarm';

/** The states of one poll. A machine that does not answer has none, because its values are old. */
export function stateValuesOf(snapshot: MachineDataSnapshot): StateValues {
  if (!snapshot.connected) return {};
  const values: Record<StatePeriodKind, string | undefined> = {
    program: snapshot.program,
    alarm: alarmOf(snapshot),
    mode: snapshot.mode,
    'run-state': snapshot.runState ?? snapshot.execution,
    tool: toolOf(snapshot),
  };
  // An empty text is not a value, the same as a value that the machine did not send
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value)) as StateValues;
}

/** The kinds whose value is new, changed, or gone */
export function changedKinds(previous: StateValues, current: StateValues): StatePeriodKind[] {
  return STATE_PERIOD_KINDS.filter(kind => previous[kind] !== current[kind]);
}

/** The alarm code and text, only while the alarm is on */
function alarmOf(snapshot: MachineDataSnapshot): string | undefined {
  if (snapshot.alarm !== true) return undefined;
  return [snapshot.alarmCode, snapshot.alarmMessage].filter(Boolean).join(' ') || ALARM_WITHOUT_DETAILS;
}

/** The tool number as text, when it is a number */
function toolOf(snapshot: MachineDataSnapshot): string | undefined {
  return Number.isFinite(snapshot.toolNumber) ? String(snapshot.toolNumber) : undefined;
}
