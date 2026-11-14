/**
 * The alarm code that the control screen shows, such as "SV0401", from the number and the type that
 * cnc_rdalmmsg gives. The number alone is not enough: on a 30i or a 0i-D/0i-F, PS0401 and SV0401 are
 * two alarms with the number 401.
 * This file loads no library, so the connector and its tests can use it.
 */

/**
 * The ODBALMMSG.type values of the 30i/31i/32i/35i and the 0i-D/0i-F (FOCAS2 cnc_rdalmmsg), with the
 * letters that the alarm screen shows. 14 and 16 to 18 are not used.
 */
const SERIES_30I_ALARM_PREFIXES: Record<number, string> = {
  0: 'SW',  // Parameter switch on
  1: 'PW',  // Power off parameter set
  2: 'IO',  // I/O error
  3: 'PS',  // Foreground P/S (program and operation)
  4: 'OT',  // Overtravel, external data
  5: 'OH',  // Overheat
  6: 'SV',  // Servo
  7: 'SR',  // Data I/O
  8: 'MC',  // Macro (#3000)
  9: 'SP',  // Spindle
  10: 'DS', // Other
  11: 'IE', // Malfunction prevention
  12: 'BG', // Background P/S
  13: 'SN', // Synchronization
  15: 'EX', // External alarm message
  19: 'PC', // PMC
};

/**
 * The series (cnc_sysinfo cnc_type) that use the 30i alarm types. "0" is the 0i: the 0i-D and 0i-F use
 * these types. The 16i/18i/21i and the older 0i-A/B/C have other types, but their alarm numbers do not
 * repeat across the types (SV4xx, OT5xx ...), so the number alone is their code.
 */
const SERIES_WITH_30I_ALARM_TYPES = new Set(['0', '30', '31', '32', '35']);

/** The digits of the number on the alarm screen of a 30i, such as SV0401 */
const ALARM_NUMBER_DIGITS = 4;

/**
 * The code of an alarm as the screen shows it, such as "PS0401" or "MC3086". When the series is not known
 * or uses other types, or the type is not known, the code is the number alone, such as "401".
 */
export function fanucAlarmCode(alarmNo: number, type: number | undefined, series: string | undefined): string {
  const prefix = series && SERIES_WITH_30I_ALARM_TYPES.has(series) && type !== undefined
    ? SERIES_30I_ALARM_PREFIXES[type]
    : undefined;
  if (!prefix) return String(alarmNo);
  return prefix + String(alarmNo).padStart(ALARM_NUMBER_DIGITS, '0');
}
