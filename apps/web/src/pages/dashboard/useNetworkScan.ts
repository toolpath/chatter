import { useEffect, useRef, useState } from 'react';
import { fetchRangeGuesses, scanRange } from '../../api/discovery';
import type { FoundMachine } from '../../types';
import { errorMessageOf } from '../../utils/errorMessage';
import { mergeFound } from './foundMachines';

/** At the first start, the scan tries this many of the guessed ranges, one after the other */
const FIRST_START_RANGES = 3;

/**
 * Looks for machines on the network, one address range at a time.
 * With `autoStart`, it scans the guessed ranges at once (the first start, with no machines yet).
 */
export function useNetworkScan(autoStart: boolean) {
  const [guesses, setGuesses] = useState<string[]>([]);
  const [range, setRange] = useState('');
  const [scanningRange, setScanningRange] = useState<string | null>(null);
  const [scannedRanges, setScannedRanges] = useState<string[]>([]);
  const [found, setFound] = useState<FoundMachine[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Changes when the panel closes, so a scan from before stops before its next range
  const runId = useRef(0);

  const scan = async (ranges: string[]) => {
    const startedRunId = runId.current;
    setError(null);
    try {
      for (const nextRange of ranges) {
        if (runId.current !== startedRunId) return;
        setScanningRange(nextRange);
        const foundInRange = await scanRange(nextRange);
        setFound(known => mergeFound(known, foundInRange));
        setScannedRanges(scanned => (scanned.includes(nextRange) ? scanned : [...scanned, nextRange]));
      }
    } catch (err) {
      setError(errorMessageOf(err, 'The scan did not work'));
    } finally {
      setScanningRange(null);
    }
  };

  useEffect(() => {
    const thisRunId = ++runId.current;
    fetchRangeGuesses()
      .then(guessedRanges => {
        if (runId.current !== thisRunId) return;
        setGuesses(guessedRanges);
        setRange(guessedRanges[0] ?? '');
        if (autoStart && guessedRanges.length > 0) scan(guessedRanges.slice(0, FIRST_START_RANGES));
      })
      // The guesses are only a help: without them, the user types the range
      .catch(() => {});
    return () => { runId.current++; };
    // Guess only once, when the panel opens
  }, []);

  return { guesses, range, setRange, scanningRange, scannedRanges, found, error, scan };
}

export type NetworkScan = ReturnType<typeof useNetworkScan>;
