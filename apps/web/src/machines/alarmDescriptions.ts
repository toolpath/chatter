/** Brother alarm codes start with two letters that tell the kind of alarm */
const KIND_PREFIX_LENGTH = 2;

function kindOf(alarmCode: string): string {
  return alarmCode.substring(0, KIND_PREFIX_LENGTH);
}

/** Codes that have their own name, more exact than the name of their kind */
const SPECIFIC_CODE_NAMES: Record<string, string> = {
  IO0500: 'E Stop',
  SL7701: 'This is an unusable folder name',
};

const KIND_NAMES: Record<string, string> = {
  EX: 'External Alarm',
  EC: 'Emergency Stop',
  SV: 'Servo Alarm',
  NC: 'NC Alarm',
  IO: 'I/O Alarm',
  SP: 'Spindle Alarm',
  SM: 'Sub Motor Alarm',
  SL: 'Safety Alarm',
  CM: 'Communication Alarm',
  ES: 'Emergency Stop',
  FC: 'Function Alarm',
};

/** The name of a Brother alarm: its own name, else the name of its kind, else "Alarm" */
export function describeBrotherAlarm(alarmCode: string | undefined): string {
  if (!alarmCode) return '';
  return SPECIFIC_CODE_NAMES[alarmCode] || KIND_NAMES[kindOf(alarmCode)] || 'Alarm';
}

/** What each kind of Brother alarm means, in plain words. Only the kinds that we can explain with confidence. */
const KIND_MEANINGS: Record<string, string> = {
  EX: 'An alarm that the machine builder or the shop added.',
  EC: 'The emergency stop is on.',
  ES: 'The emergency stop is on.',
  SV: 'A problem with a motor that moves an axis.',
  NC: 'An error that the control found.',
  IO: 'A problem with a switch or sensor signal.',
  SP: 'A problem with the spindle or its motor.',
  CM: 'A communication problem with another device.',
};

/** What the kind of a Brother alarm means, or undefined when the code has its own meaning or the kind is not known */
export function brotherAlarmKindMeaning(alarmCode: string): string | undefined {
  if (SPECIFIC_CODE_NAMES[alarmCode]) return undefined;
  return KIND_MEANINGS[kindOf(alarmCode)];
}
