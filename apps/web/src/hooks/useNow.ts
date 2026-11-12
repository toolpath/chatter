import { useEffect, useState } from 'react';

/** The time now in milliseconds. It changes every `tickMs`, so "1 s ago" texts stay true. */
export function useNow(tickMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);
  return now;
}
