import { useCallback, useEffect, useState } from 'react';
import { errorMessageOf } from '../../utils/errorMessage';

const UNKNOWN_ERROR_MESSAGE = 'Something went wrong. Try again.';

/**
 * A report that a Settings tab loads from the server, and a way to change it.
 * Give a load function that does not change between renders, for example a function of a module.
 */
export function useServerReport<Report>(load: () => Promise<Report>) {
  const [report, setReport] = useState<Report | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    load().then(
      loaded => isCurrent && setReport(loaded),
      error => isCurrent && setLoadError(errorMessageOf(error, UNKNOWN_ERROR_MESSAGE)),
    );
    return () => {
      isCurrent = false;
    };
  }, [load]);

  /** Run a change that gives the new report. Returns true when it worked. */
  const change = async (action: () => Promise<Report>): Promise<boolean> => {
    setIsChanging(true);
    setChangeError(null);
    try {
      setReport(await action());
      return true;
    } catch (error) {
      setChangeError(errorMessageOf(error, UNKNOWN_ERROR_MESSAGE));
      return false;
    } finally {
      setIsChanging(false);
    }
  };

  /** Load the report again. A failure keeps the last report, for example while the server restarts. */
  const refresh = useCallback(async () => {
    try {
      setReport(await load());
    } catch {
      // The next refresh tries again
    }
  }, [load]);

  return { report, loadError, changeError, isChanging, change, refresh };
}
