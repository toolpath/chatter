import { Link } from 'react-router';
import type { MachineAlert } from '../../api/alerts';
import { useCan } from '../../components/CurrentUser';
import { Panel } from '../../components/ui/Panel';
import { ShowMoreFooter } from '../../components/ui/ShowMoreFooter';
import { StatusDot } from '../../components/ui/StatusDot';
import { CELL, HEAD_CELL, HEAD_ROW, ROW, TABLE } from '../../components/ui/table';
import { useShownItems } from '../../hooks/useShownItems';
import { formatDateTime } from '../../utils/formatters';
import { alertText, alertTone, splitFiring } from './alertList';
import { tabLink } from './machineTabs';
import { SETTINGS_SECTION_IDS } from './SettingsTab';
import type { MachineAlerts } from './useMachineAlerts';

/** The list shows this many past alerts at first, and this many more for each click. The firing alerts always show. */
export const PAST_ALERTS_PAGE_SIZE = 10;

/** The alerts of the machine's alert rules (Settings › Alert rules), in the last week. The page loads them with useMachineAlerts. */
export function AlertsPanel({ machineId, alerts: { alerts, loaded, failed } }: { machineId: string; alerts: MachineAlerts }) {
  const { firing, past } = splitFiring(alerts);
  const { shown: shownPast, total: pastCount, showMore } = useShownItems(past, PAST_ALERTS_PAGE_SIZE, machineId);
  const firingCount = firing.length;
  // Only a role with manage-machines can read the rules, so only that role gets the link
  const canManageMachines = useCan('manage-machines');

  return (
    <Panel
      title="Alerts"
      description={firingCount > 0 ? `${firingCount} firing now` : 'The alerts of the last 7 days'}
    >
      {failed && <p className="m-0 px-5 py-4 text-alarm-soft">Could not load the alerts. Chatter tries again in 15 seconds.</p>}
      {loaded && !failed && alerts.length === 0 && (
        <p className="m-0 px-5 py-4 text-zinc-300">
          No alerts in the last 7 days.
          {canManageMachines && (
            <>
              {' '}Set the rules in{' '}
              <Link to={tabLink('settings', SETTINGS_SECTION_IDS.alertRules)} className="font-semibold text-primary-text">Settings › Alert rules</Link>.
            </>
          )}
        </p>
      )}
      {alerts.length > 0 && (
        <>
          <AlertTable alerts={[...firing, ...shownPast]} />
          <ShowMoreFooter shownCount={shownPast.length} total={pastCount} noun="past alerts" onShowMore={showMore} />
        </>
      )}
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
