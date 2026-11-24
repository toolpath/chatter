import type { Role } from '@local-chatter/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolSyncError, type SyncProblem } from '../../api/toolSync';
import { CurrentUserContext } from '../../components/CurrentUser';
import type { ToolSyncState, ToolTable } from '../../types';
import { ToolTableTab } from './ToolTableTab';

const syncTools = vi.fn<(machineId: string) => Promise<ToolSyncState>>();
vi.mock('../../api/toolSync', async importOriginal => ({
  ...await importOriginal<typeof import('../../api/toolSync')>(),
  syncTools: (machineId: string) => syncTools(machineId),
}));

const SYNCED_AT = '2026-11-21T08:05:00.000Z';
const NOT_SYNCED: ToolSyncState = { lastSyncAt: null, lastAttemptAt: null, error: null, running: false };
const SYNCED: ToolSyncState = { lastSyncAt: SYNCED_AT, lastAttemptAt: SYNCED_AT, error: null, running: false };
const TOOLS = { 1: { toolNum: 5, length: 3.402, name: 'ENDMILL' } };

/** The text for SYNCED_AT in the time zone UTC and the format of en-US (see beforeEach) */
const SYNCED_TEXT = 'Synced 08:05 AM';

/** The end of the last good poll in the status */
const POLLED_AT = '2026-11-21T08:06:00.000Z';

/** The page around the tab, with a user of this role. A rerender keeps it. */
const asRole = (role: Role) => ({ children }: { children: ReactNode }) =>
  <CurrentUserContext.Provider value={{ username: 'sam', role }}>{children}</CurrentUserContext.Provider>;

function renderTab(toolSync: ToolSyncState | undefined, toolTable: ToolTable = TOOLS, connected = true, role: Role = 'operator') {
  return render(
    <ToolTableTab
      machineId="m1" connected={connected} lastPollTime={POLLED_AT} toolTable={toolTable} hasPocketInfo spindleTool={undefined} toolSync={toolSync}
    />,
    { wrapper: asRole(role) },
  );
}

/** The tab again, with a new status of the server */
const tabWith = (toolSync: ToolSyncState, connected = true, lastPollTime: string | null = POLLED_AT) =>
  <ToolTableTab
    machineId="m1" connected={connected} lastPollTime={lastPollTime} toolTable={TOOLS} hasPocketInfo spindleTool={undefined} toolSync={toolSync}
  />;

/** The text of the server for the outcome 'program-running'. The tab shows the text that the server gives. */
const PROGRAM_RUNNING = 'The server text for a refused Sync while the control does not report READY.';

/** The next Sync fails with this text and reason */
const refuseSync = (text: string, problem: SyncProblem) => syncTools.mockRejectedValue(new ToolSyncError(text, problem));

/** Press Sync, and let the reply of the server come */
async function pressSync() {
  fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
  await act(async () => {});
}

/** A state of the server at `iso`: the time of the last read and of the last try */
const syncedAt = (iso: string, error: string | null = null): ToolSyncState =>
  ({ lastSyncAt: error ? SYNCED_AT : iso, lastAttemptAt: iso, error, running: false });

describe('ToolTableTab Sync for each role', () => {
  // A Viewer only looks: the server refuses its Sync. The time of the last read stays.
  it('shows no Sync button to a viewer, but shows when Chatter read the tools', () => {
    renderTab(NOT_SYNCED, TOOLS, true, 'viewer');

    expect(screen.getByText('Not synced yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync' })).not.toBeInTheDocument();
  });

  it.each(['operator', 'admin'] as const)('shows the Sync button to an %s', role => {
    renderTab(NOT_SYNCED, TOOLS, true, role);

    expect(screen.getByRole('button', { name: 'Sync' })).toBeEnabled();
  });
});

describe('ToolTableTab sync', () => {
  beforeEach(() => {
    syncTools.mockReset();
    // The tab shows a time in the locale and the time zone of the browser. The test uses en-US and UTC, so it gets
    // the same text on each computer.
    const browserTime = Date.prototype.toLocaleTimeString;
    vi.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(function (this: Date, _locales, options) {
      return browserTime.call(this, 'en-US', { ...options, timeZone: 'UTC' });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says "Not synced yet" and offers Sync before the first read', () => {
    renderTab(NOT_SYNCED, {});

    expect(screen.getByText('Not synced yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync' })).toBeEnabled();
  });

  it('tells that Chatter reads the tool table only on a Sync, and when not to press Sync', () => {
    renderTab(NOT_SYNCED, {});

    expect(screen.getByText(
      'Chatter reads the tool table only when you press Sync, and only when the control reports that no program runs. '
      + 'Press Sync only when no program runs. Do not press it while the door is open during a program: '
      + 'some Brother controls report that no program runs while the door holds a program.',
    )).toBeInTheDocument();
    expect(screen.queryByText(/automatic|minutes/)).toBeNull();
  });

  it('shows the reason of the server when it refused a Sync because a program can run, and keeps the button', async () => {
    refuseSync(PROGRAM_RUNNING, { outcome: 'program-running' });
    renderTab(SYNCED);

    await pressSync();

    expect(screen.getByRole('alert')).toHaveTextContent(PROGRAM_RUNNING);
    expect(screen.getByRole('button', { name: 'Sync' })).toBeEnabled();
    expect(screen.getByText(SYNCED_TEXT)).toBeInTheDocument();
  });

  it('gives the time of the last good read', () => {
    renderTab(SYNCED);

    expect(screen.getByText(SYNCED_TEXT)).toBeInTheDocument();
    expect(screen.getByText('ENDMILL')).toBeInTheDocument();
  });

  it('says "Syncing…" while the server reads the tools', () => {
    renderTab({ ...SYNCED, running: true });

    expect(screen.getByText('Syncing…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync' })).toBeDisabled();
  });

  it('reads the tools when the user presses Sync, and shows "Syncing…" until the read ends', async () => {
    let finish: (state: ToolSyncState) => void = () => {};
    syncTools.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderTab(NOT_SYNCED, {});

    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));

    expect(syncTools).toHaveBeenCalledWith('m1');
    expect(screen.getByText('Syncing…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync' })).toBeDisabled();
    finish(SYNCED);
    await waitFor(() => expect(screen.getByText(SYNCED_TEXT)).toBeInTheDocument());
  });

  it('shows the error of a Sync that fails, and keeps the button', async () => {
    syncTools.mockRejectedValue(new Error('Chatter read the tool table a short time ago. Try again in 20 seconds.'));
    renderTab(SYNCED);

    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 20 seconds');
    expect(screen.getByRole('button', { name: 'Sync' })).toBeEnabled();
  });

  it('shows the error of the last read', () => {
    renderTab({ ...SYNCED, error: 'No reply' });

    expect(screen.getByRole('alert')).toHaveTextContent('No reply');
    expect(screen.getByText(SYNCED_TEXT)).toBeInTheDocument();
  });

  it('removes the error of a Sync when a newer status of the server comes', async () => {
    syncTools.mockRejectedValue(new Error('Could not read the tool table'));
    const { rerender } = renderTab(SYNCED);
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read the tool table');

    rerender(tabWith(syncedAt('2026-11-21T08:20:00.000Z')));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Synced 08:20 AM')).toBeInTheDocument();
  });

  it('shows a later status of the server with an error, not the older result of the Sync', async () => {
    syncTools.mockResolvedValue(syncedAt('2026-11-21T08:10:00.000Z'));
    const { rerender } = renderTab(SYNCED);
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    expect(await screen.findByText('Synced 08:10 AM')).toBeInTheDocument();

    rerender(tabWith(syncedAt('2026-11-21T08:30:00.000Z', 'No reply')));

    expect(screen.getByRole('alert')).toHaveTextContent('No reply');
    expect(screen.getByText(SYNCED_TEXT)).toBeInTheDocument();
  });

  it('keeps the result of the Sync when an older status of the server comes', async () => {
    syncTools.mockResolvedValue(syncedAt('2026-11-21T08:10:00.000Z'));
    const { rerender } = renderTab(SYNCED);
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    expect(await screen.findByText('Synced 08:10 AM')).toBeInTheDocument();

    rerender(tabWith(syncedAt(SYNCED_AT, 'No reply')));

    expect(screen.getByText('Synced 08:10 AM')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the error of a failed read one time, with the text of the server state, when the reply comes first', async () => {
    const failed = syncedAt('2026-11-21T08:10:00.000Z', 'No reply');
    refuseSync('The machine did not send its tool table: No reply', { outcome: 'failed', toolSync: failed });
    const { rerender } = renderTab(SYNCED);
    await pressSync();
    expect(screen.getByRole('alert')).toHaveTextContent(/^No reply$/);

    rerender(tabWith(failed));

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(/^No reply$/);
  });

  it('shows the error of a failed read one time, with the text of the server state, when the status comes first', async () => {
    const failed = syncedAt('2026-11-21T08:10:00.000Z', 'No reply');
    let fail: (error: Error) => void = () => {};
    syncTools.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const { rerender } = renderTab(SYNCED);
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    rerender(tabWith(failed));

    await act(async () => fail(new ToolSyncError('The machine did not send its tool table: No reply', { outcome: 'failed', toolSync: failed })));

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(/^No reply$/);
  });

  describe('the error of a Sync that the server refused before a read', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('goes after the seconds of "Try again", also with no newer status of the server', async () => {
      vi.useFakeTimers();
      refuseSync('Try again in 12 seconds.', { outcome: 'too-soon', retryAfterSeconds: 12 });
      renderTab(SYNCED);
      await pressSync();
      expect(screen.getByRole('alert')).toHaveTextContent('Try again in 12 seconds.');

      act(() => vi.advanceTimersByTime(11_999));
      expect(screen.getByRole('alert')).toHaveTextContent('Try again in 12 seconds.');

      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('gives a second "Try again" its full seconds, also when the first one has not gone yet', async () => {
      vi.useFakeTimers();
      refuseSync('Try again in 12 seconds.', { outcome: 'too-soon', retryAfterSeconds: 12 });
      renderTab(SYNCED);
      await pressSync();
      act(() => vi.advanceTimersByTime(8000));
      refuseSync('Try again in 12 seconds again.', { outcome: 'too-soon', retryAfterSeconds: 12 });

      await pressSync();
      act(() => vi.advanceTimersByTime(11_999));
      expect(screen.getByRole('alert')).toHaveTextContent('Try again in 12 seconds again.');

      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('stops the timer of "Try again" when the tab closes', async () => {
      vi.useFakeTimers();
      refuseSync('Try again in 12 seconds.', { outcome: 'too-soon', retryAfterSeconds: 12 });
      const { unmount } = renderTab(SYNCED);
      await pressSync();
      expect(vi.getTimerCount()).toBe(1);

      unmount();

      expect(vi.getTimerCount()).toBe(0);
    });

    it('"not connected" goes when the machine is connected again', async () => {
      refuseSync('The machine is not connected.', { outcome: 'not-connected' });
      const { rerender } = renderTab(SYNCED, TOOLS, false);
      await pressSync();
      expect(screen.getByRole('alert')).toHaveTextContent('The machine is not connected.');

      rerender(tabWith(SYNCED, true));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('"not connected" stays when the screen showed the machine online at the Sync, until it shows it offline and online again', async () => {
      refuseSync('The machine is not connected.', { outcome: 'not-connected' });
      const { rerender } = renderTab(SYNCED, TOOLS, true);
      await pressSync();
      expect(screen.getByRole('alert')).toHaveTextContent('The machine is not connected.');

      rerender(tabWith(SYNCED, false));
      expect(screen.getByRole('alert')).toHaveTextContent('The machine is not connected.');

      rerender(tabWith(SYNCED, true));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('"not connected" goes when a newer good poll comes, also when the screen never showed the machine offline', async () => {
      refuseSync('The machine is not connected.', { outcome: 'not-connected' });
      const { rerender } = renderTab(SYNCED, TOOLS, true);
      await pressSync();

      // The control closed the connection between two polls, and the next poll connected again
      rerender(tabWith(SYNCED, true, POLLED_AT));
      expect(screen.getByRole('alert')).toHaveTextContent('The machine is not connected.');
      rerender(tabWith(SYNCED, true, '2026-11-21T08:06:02.000Z'));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('"program running" goes when a newer good poll comes', async () => {
      refuseSync(PROGRAM_RUNNING, { outcome: 'program-running' });
      const { rerender } = renderTab(SYNCED, TOOLS, true);
      await pressSync();

      rerender(tabWith(SYNCED, true, POLLED_AT));
      expect(screen.getByRole('alert')).toHaveTextContent(PROGRAM_RUNNING);
      rerender(tabWith(SYNCED, true, '2026-11-21T08:06:02.000Z'));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('"busy" goes when the read that ran ends, also when the server keeps no result of it', async () => {
      refuseSync('A read of the tool table runs now.', { outcome: 'busy' });
      const { rerender } = renderTab(SYNCED);
      await pressSync();
      expect(screen.getByRole('alert')).toHaveTextContent('A read of the tool table runs now.');

      rerender(tabWith({ ...SYNCED, running: true }));
      rerender(tabWith(SYNCED));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('"not connected" stays while the machine is still offline and no newer read comes', async () => {
      refuseSync('The machine is not connected.', { outcome: 'not-connected' });
      const { rerender } = renderTab(SYNCED, TOOLS, false);
      await pressSync();

      rerender(tabWith(SYNCED, false));

      expect(screen.getByRole('alert')).toHaveTextContent('The machine is not connected.');
    });
  });

  describe('the error "address changed"', () => {
    const ADDRESS_CHANGED = 'The address of the machine changed during the read. Chatter did not keep the result.';

    it('shows after an earlier read, when the status of the server without the forgotten read comes before the reply', async () => {
      let refuse: (error: Error) => void = () => {};
      syncTools.mockReturnValue(new Promise((_, reject) => { refuse = reject; }));
      const { rerender } = renderTab(SYNCED);
      fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
      // The server forgets the read of the old address, and sends its status before the reply
      rerender(tabWith(NOT_SYNCED));

      await act(async () => refuse(new ToolSyncError(ADDRESS_CHANGED, { outcome: 'address-changed' })));

      expect(screen.getByRole('alert')).toHaveTextContent(ADDRESS_CHANGED);
    });

    it('stays after the reply when the status without the forgotten read comes, until a newer read', async () => {
      refuseSync(ADDRESS_CHANGED, { outcome: 'address-changed' });
      const { rerender } = renderTab(SYNCED);
      await pressSync();

      rerender(tabWith(NOT_SYNCED));
      expect(screen.getByRole('alert')).toHaveTextContent(ADDRESS_CHANGED);

      rerender(tabWith(syncedAt('2026-11-21T08:20:00.000Z')));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('goes when the user presses Sync again, and the new Sync reads the tools', async () => {
      refuseSync(ADDRESS_CHANGED, { outcome: 'address-changed' });
      const { rerender } = renderTab(SYNCED);
      await pressSync();
      rerender(tabWith(NOT_SYNCED));
      syncTools.mockResolvedValue(syncedAt('2026-11-21T08:20:00.000Z'));

      await pressSync();

      expect(syncTools).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('Synced 08:20 AM')).toBeInTheDocument();
    });
  });

  it('has no Sync for a machine that sends its tool table in each poll', () => {
    renderTab(undefined);

    expect(screen.queryByRole('button', { name: 'Sync' })).not.toBeInTheDocument();
  });
});
