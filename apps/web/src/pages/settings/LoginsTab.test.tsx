import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLoginsReport, unlockComputer, type LoginsReport } from '../../api/settings';
import { LoginsTab } from './LoginsTab';

vi.mock('../../api/settings', () => ({ fetchLoginsReport: vi.fn(), unlockComputer: vi.fn() }));

const ATTACKER = '192.168.1.66';
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000 - 1000).toISOString();

function report(changes: Partial<LoginsReport> = {}): LoginsReport {
  const at = new Date().toISOString();
  return {
    limits: { maxWrongPasswords: 10, lockMinutes: 15 },
    locked: [{ address: ATTACKER, username: 'sam', until: inMinutes(14) }],
    tries: [
      { at, username: 'sam', address: ATTACKER, result: 'locked' },
      { at, username: 'admin', address: '192.168.1.20', result: 'logged-in' },
    ],
    ...changes,
  };
}

async function renderTab(loaded: LoginsReport) {
  vi.mocked(fetchLoginsReport).mockResolvedValue(loaded);
  render(<LoginsTab />);
  await screen.findByText('Recent logins');
}

describe('LoginsTab', () => {
  beforeEach(() => {
    vi.mocked(unlockComputer).mockReset();
  });

  it('shows a locked computer with the user it tried and the time left', async () => {
    await renderTab(report());
    expect(screen.getByText('Tried user "sam" · locked for 14 min more')).toBeInTheDocument();
  });

  it('shows each try with its result', async () => {
    await renderTab(report());
    const rows = within(screen.getByRole('table')).getAllByRole('row');

    expect(rows[1]).toHaveTextContent('Locked: 10 wrong passwords');
    expect(rows[2]).toHaveTextContent('admin');
    expect(rows[2]).toHaveTextContent('Logged in');
  });

  it('unlocks a computer', async () => {
    await renderTab(report());
    vi.mocked(unlockComputer).mockResolvedValue(report({ locked: [] }));

    fireEvent.click(screen.getByRole('button', { name: `Unlock ${ATTACKER}` }));

    expect(unlockComputer).toHaveBeenCalledWith(ATTACKER);
    expect(await screen.findByText('No computer is locked.')).toBeInTheDocument();
  });

  it('shows the reason when the unlock fails', async () => {
    await renderTab(report());
    vi.mocked(unlockComputer).mockRejectedValue(new Error(`Could not unlock ${ATTACKER}`));

    fireEvent.click(screen.getByRole('button', { name: `Unlock ${ATTACKER}` }));

    expect(await screen.findByText(`Could not unlock ${ATTACKER}`)).toBeInTheDocument();
  });

  it('loads the list again on Refresh', async () => {
    await renderTab(report({ tries: [] }));
    expect(screen.getByText('No one has tried to log in yet.')).toBeInTheDocument();
    vi.mocked(fetchLoginsReport).mockResolvedValue(report());

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('Locked: 10 wrong passwords')).toBeInTheDocument();
  });

  it('shows the reason when the list cannot load', async () => {
    vi.mocked(fetchLoginsReport).mockRejectedValue(new Error('Could not load the logins'));
    render(<LoginsTab />);
    expect(await screen.findByText('Could not load the logins')).toBeInTheDocument();
  });
});
