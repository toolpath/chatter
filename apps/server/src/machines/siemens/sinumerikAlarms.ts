import { splitAlarmText } from './sinumerikValues.js';

/** The fields of an OPC UA Alarms and Conditions event that Chatter asks for */
export interface AlarmEvent {
  /** The NodeId of the condition, as text. Each alarm instance has its own. */
  conditionId?: string;
  conditionName?: string;
  sourceName?: string;
  message?: string;
  /** ActiveState/Id */
  active?: boolean;
  /** False when the server tells that the condition is no longer of interest */
  retain?: boolean;
}

export interface ActiveAlarm {
  code: string;
  text: string;
}

/** The condition name of every SINUMERIK alarm, so it tells nothing about the alarm */
const GENERIC_CONDITION_NAME = 'SystemCondition';

/**
 * The alarms that are active now, kept from the alarm events of the control.
 * The control sends an event when an alarm comes and when it goes. After a ConditionRefresh,
 * it sends the alarms that were active already.
 */
export class ActiveAlarms {
  private readonly alarms = new Map<string, ActiveAlarm>();

  apply(event: AlarmEvent): void {
    const message = event.message?.trim() ?? '';
    const conditionName = event.conditionName?.trim() ?? '';
    // RefreshStart, RefreshEnd and other events that are not alarms
    if (!message && !conditionName) return;

    const key = event.conditionId || `${event.sourceName ?? ''}|${conditionName}|${message}`;
    const isOn = event.active !== false && event.retain !== false;
    if (!isOn) {
      this.alarms.delete(key);
      return;
    }

    const { code, text } = splitAlarmText(message);
    const fallbackCode = conditionName && conditionName !== GENERIC_CONDITION_NAME && conditionName !== text
      ? conditionName
      : event.sourceName?.trim() ?? '';
    this.alarms.set(key, { code: code ?? fallbackCode, text: text || conditionName });
  }

  /** The alarms in the order they came */
  list(): ActiveAlarm[] {
    return [...this.alarms.values()];
  }

  clear(): void {
    this.alarms.clear();
  }
}
