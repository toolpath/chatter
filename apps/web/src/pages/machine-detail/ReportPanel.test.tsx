import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MachineReport } from '../../api/reports';
import { ReportPanel } from './ReportPanel';

const report: MachineReport = {
  machineId: 'b1',
  range: '-24h',
  from: '2026-11-08T12:00:00.000Z',
  to: '2026-11-09T12:00:00.000Z',
  watchedMs: 3_600_000,
  onlineMs: 3_600_000,
  runningMs: null,
  partsMade: null,
  alarms: { count: 1, totalMs: 60_000, values: [{ value: 'SV00000005', count: 1, totalMs: 60_000 }] },
};

vi.mock('./useMachineReport', () => ({ useMachineReport: () => ({ report, failed: false }) }));

describe('ReportPanel', () => {
  it('puts an info button next to each alarm, with what the alarm means for this machine type', () => {
    render(<ReportPanel machineId="b1" machineType="brother" />);

    const button = screen.getByRole('button', { name: 'What SV00000005 means' });
    expect(button).toHaveAccessibleDescription(/^Servo Alarm\./);
  });
});
