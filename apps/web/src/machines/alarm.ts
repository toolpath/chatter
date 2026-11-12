import type { Machine } from '../types';
import { describeBrotherAlarm } from './alarmDescriptions';

export interface AlarmSummary {
  /** The alarm code from the machine, when it sends one */
  code?: string;
  /** What the alarm means, in words */
  title: string;
}

/** The text each machine type sends with an alarm */
function alarmTextOf(machine: Machine): string | undefined {
  // Each case reads `machine.data`, so TypeScript knows the fields of that machine type
  switch (machine.type) {
    case 'brother': return machine.data.alarmCode ? describeBrotherAlarm(machine.data.alarmCode) : undefined;
    case 'fanuc': return machine.data.alarmMessage || machine.data.alarmText;
    default: return machine.data.alarmText;
  }
}

/** The alarm of a machine, or null when it has none, or when Chatter does not get real values from it now */
export function alarmOf(machine: Machine): AlarmSummary | null {
  if (!machine.connected || machine.connecting || !machine.data.alarm) return null;
  const code = machine.data.alarmCode || undefined;
  return { code, title: alarmTextOf(machine) || 'Alarm' };
}

/** "107 · Emergency stop" for one table cell */
export function alarmLine(alarm: AlarmSummary): string {
  return alarm.code ? `${alarm.code} · ${alarm.title}` : alarm.title;
}

/** Why the server cannot reach the machine */
export function offlineReasonOf(machine: Machine): string {
  return machine.errors[0] || 'No connection';
}
