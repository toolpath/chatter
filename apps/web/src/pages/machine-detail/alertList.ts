import type { MachineAlert } from '../../api/alerts';
import type { StatusTone } from '../../components/ui/StatusDot';

/** The text of an alert rule: its "summary", or else its "description" */
export function alertText(alert: MachineAlert): string {
  return alert.annotations.summary ?? alert.annotations.description ?? '';
}

/** Red for a critical alert, yellow for the other alerts */
export function alertTone(alert: MachineAlert): StatusTone {
  return alert.labels.severity === 'critical' ? 'bad' : 'check';
}

/** The alerts that fire now come first. Each group stays newest first. */
export function firingFirst(alerts: MachineAlert[]): MachineAlert[] {
  return [...alerts.filter(alert => alert.firing), ...alerts.filter(alert => !alert.firing)];
}
