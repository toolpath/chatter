import type { Machine } from '../types';
import { brotherAlarmKindMeaning, describeBrotherAlarm } from './alarmDescriptions';

/** The value that the server saves for an alarm with no code and no text */
const NO_CODE_VALUE = 'alarm';

/** "Details: the Brother manual." */
const detailsIn = (manual: string) => `Details: the ${manual}.`;

/** Words that explain an alarm in the report, for the info box next to it. `value` is the alarm code, then any text. */
export function alarmHelp(machineType: Machine['type'], value: string): string {
  if (value === NO_CODE_VALUE) return 'The machine sent no alarm code.';
  switch (machineType) {
    case 'brother': return brotherHelp(value);
    case 'haas': return 'Search for this number in the Haas alarm search at haascnc.com.';
    case 'fanuc': return detailsIn('FANUC maintenance manual for this control');
    case 'siemens': return `SINUMERIK shows the alarm and its help on the control: Diagnostics > Alarm list. ${detailsIn('SINUMERIK diagnostics manual')}`;
    case 'mtconnect': return `The meaning depends on the machine maker. ${detailsIn('machine manual')}`;
  }
}

/** "Servo Alarm. A problem with a motor that moves an axis. Details: the Brother manual." */
function brotherHelp(code: string): string {
  return [`${describeBrotherAlarm(code)}.`, brotherAlarmKindMeaning(code), detailsIn('Brother manual')].filter(Boolean).join(' ');
}
