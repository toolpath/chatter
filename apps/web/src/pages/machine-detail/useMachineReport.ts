import { useEffect, useState } from 'react';
import { fetchMachineReport, type MachineReport } from '../../api/reports';

/** The report uses minute averages, so a new load each minute is enough */
const RELOAD_EVERY_MS = 60_000;

/**
 * The report of one machine over a range, such as "-1d". `failed` is true when the last load did not work.
 * After a failed reload, the last report stays, because its numbers are still good.
 */
export function useMachineReport(machineId: string, range: string) {
  const [report, setReport] = useState<MachineReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    setReport(null);
    setFailed(false);
    const load = () => {
      fetchMachineReport(machineId, range)
        .then(found => {
          if (stopped) return;
          setReport(found);
          setFailed(false);
        })
        .catch(() => {
          if (!stopped) setFailed(true);
        });
    };
    load();
    const timer = setInterval(load, RELOAD_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [machineId, range]);

  return { report, failed };
}
