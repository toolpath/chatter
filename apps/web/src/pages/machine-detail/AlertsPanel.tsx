import type { MachineAlert } from '../../api/alerts';
import { Panel } from '../../components/ui/Panel';
import { StatusDot } from '../../components/ui/StatusDot';
import { CELL, HEAD_CELL, HEAD_ROW, ROW, TABLE } from '../../components/ui/table';
import { formatDateTime } from '../../utils/formatters';
import { alertText, alertTone, firingFirst } from './alertList';
import { useMachineAlerts } from './useMachineAlerts';

/** The alerts of the machine's alert rules (the Alert rules tab), in the last week */
export function AlertsPanel({ machineId }: { machineId: string }) {
  const { alerts, loaded, failed } = useMachineAlerts(machineId);
  const firingCount = alerts.filter(alert => alert.firing).length;

  return (
    <Panel
      title="Alerts"
      description={firingCount > 0 ? `${firingCount} firing now` : 'The alerts of the last 7 days'}
    >
      {failed && <p className="m-0 px-5 py-4 text-alarm-soft">Could not load the alerts. Chatter tries again in 30 seconds.</p>}
      {loaded && !failed && alerts.length === 0 && (
        <p className="m-0 px-5 py-4 text-zinc-300">No alerts in the last 7 days. Set the rules in the Alert rules tab below.</p>
      )}
      {alerts.length > 0 && <AlertTable alerts={firingFirst(alerts)} />}
    </Panel>
  );
}

function AlertTable({ alerts }: { alerts: MachineAlert[] }) {
  return (
    <div className="overflow-x-auto">
      <table className={TABLE}>
        <thead>
          <tr className={HEAD_ROW}>
            <th scope="col" className={HEAD_CELL}>Alert</th>
            <th scope="col" className={HEAD_CELL}>Started</th>
            <th scope="col" className={HEAD_CELL}>Ended</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map(alert => <AlertRow key={alertKey(alert)} alert={alert} />)}
        </tbody>
      </table>
    </div>
  );
}

/** One rule can fire more than once, and for more than one set of labels */
function alertKey(alert: MachineAlert): string {
  return `${alert.name}-${alert.start}-${JSON.stringify(alert.labels)}`;
}

function AlertRow({ alert }: { alert: MachineAlert }) {
  const text = alertText(alert);
  return (
    <tr className={ROW}>
      <td className={CELL}>
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold">{alert.name}</span>
          {text && <span className="text-zinc-300">{text}</span>}
        </div>
      </td>
      <td className={CELL}>{formatDateTime(alert.start)}</td>
      <td className={CELL}>
        {alert.firing ? <StatusDot tone={alertTone(alert)}>Firing now</StatusDot> : formatDateTime(alert.end)}
      </td>
    </tr>
  );
}
