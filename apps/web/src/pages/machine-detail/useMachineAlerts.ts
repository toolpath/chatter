import { useEffect, useState } from 'react';
import { fetchMachineAlerts, type MachineAlert } from '../../api/alerts';

/** vmalert checks the rules every 15 seconds, so the list loads again this often */
const RELOAD_EVERY_MS = 30_000;

/** The alerts of one machine in the last week. `failed` is true when the last load did not work. */
export function useMachineAlerts(machineId: string) {
  const [alerts, setAlerts] = useState<MachineAlert[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    setAlerts([]);
    setLoaded(false);
    const load = () => {
      fetchMachineAlerts(machineId)
        .then(found => {
          if (stopped) return;
          setAlerts(found);
          setFailed(false);
        })
        .catch(() => {
          if (!stopped) setFailed(true);
        })
        .finally(() => {
          if (!stopped) setLoaded(true);
        });
    };
    load();
    const timer = setInterval(load, RELOAD_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [machineId]);

  return { alerts, loaded, failed };
}
