import type { FoundMachine } from '@local-chatter/shared';
import { describe, expect, it } from 'vitest';
import { KNOCK_TIMEOUT_MS, longestScanMs, NetworkScanner, ScanAlreadyRunningError } from './NetworkScanner.js';

const haasAt = (host: string): FoundMachine => ({
  machine: { type: 'haas', name: 'Haas', host, dataPort: 9998, queryPort: 5051 },
  isConfirmed: true,
  detail: '',
});

describe('NetworkScanner', () => {
  it('tries .1 to .254 and leaves out the machines that are added already', async () => {
    const tried: string[] = [];
    const scanner = new NetworkScanner(async host => {
      tried.push(host);
      return host.endsWith('.10') || host.endsWith('.20') ? [haasAt(host)] : [];
    });
    const found = await scanner.scan('10.0.0', machine => machine.host === '10.0.0.10');
    expect(tried).toHaveLength(254);
    expect(found.map(result => result.machine.host)).toEqual(['10.0.0.20']);
  });

  it('refuses a second scan while one runs', async () => {
    let release = () => {};
    const gate = new Promise<FoundMachine[]>(resolve => { release = () => resolve([]); });
    const scanner = new NetworkScanner(() => gate);
    const first = scanner.scan('10.0.0', () => false);
    await expect(scanner.scan('10.0.0', () => false)).rejects.toBeInstanceOf(ScanAlreadyRunningError);
    release();
    await first;
  });

  it('allows a new scan after a scan fails', async () => {
    let shouldFail = true;
    const scanner = new NetworkScanner(async () => {
      if (shouldFail) throw new Error('network down');
      return [];
    });
    await expect(scanner.scan('10.0.0', () => false)).rejects.toThrow('network down');
    shouldFail = false;
    await expect(scanner.scan('10.0.0', () => false)).resolves.toEqual([]);
  });

  it('waits 2 seconds for each port, because WiFi and Docker Desktop on a Mac answer slowly', () => {
    expect(KNOCK_TIMEOUT_MS).toBeGreaterThanOrEqual(2000);
  });

  it('ends a scan of .1 to .254 in 30 seconds, also when each address waits the longest time', () => {
    expect(longestScanMs(254)).toBeLessThanOrEqual(30_000);
  });
});
