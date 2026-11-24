import type { AlertRule, Role } from '@local-chatter/shared';
import { Dialog } from '@toolpath/ui';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMachineAlerts, type MachineAlert } from '../../api/alerts';
import { fetchAlertRules } from '../../api/alertRules';
import { fetchFileBytes, fetchFileTree, fetchUploadEvent, fetchUploadEvents, fetchUploadFiles, uploadMachineFiles } from '../../api/machineFiles';
import { fetchValueHistory } from '../../api/history';
import { fetchMachineReport } from '../../api/reports';
import { fetchStateTimeline } from '../../api/stateTimeline';
import { CurrentUserContext } from '../../components/CurrentUser';
import { testMachine } from '../../test/testMachine';
import { SETTINGS_SECTION_IDS } from './SettingsTab';
import type { FTPTreeNode, Machine } from '../../types';
import MachineDetailPage from './MachineDetailPage';

vi.mock('../../api/alerts', () => ({ fetchMachineAlerts: vi.fn() }));
vi.mock('../../api/alertRules', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/alertRules')>()),
  fetchAlertRules: vi.fn(),
}));
vi.mock('../../api/reports', () => ({ fetchMachineReport: vi.fn() }));
vi.mock('../../api/machineFiles', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/machineFiles')>()),
  fetchFileTree: vi.fn(),
  fetchFileBytes: vi.fn(),
  fetchUploadFiles: vi.fn(),
  fetchUploadEvents: vi.fn(),
  fetchUploadEvent: vi.fn(),
  uploadMachineFiles: vi.fn(),
}));
// The chart has its own tests. Here it has no values.
vi.mock('../../api/history', () => ({ fetchValueHistory: vi.fn() }));
vi.mock('../../api/diagnostics', () => ({
  fetchMachineHealth: vi.fn().mockResolvedValue({ offlineSince: null, lastError: null, events: [], lastPollTime: null, serverTime: '2026-11-21T10:05:00.000Z' }),
  testMachineConnection: vi.fn(),
  reconnectMachine: vi.fn(),
}));
vi.mock('../../api/stateTimeline', () => ({ fetchStateTimeline: vi.fn() }));
/** Each render of the header: the machine and its count of firing alerts */
const headerRenders: { machineId: string; firingCount: number }[] = [];
vi.mock('./MachineHeader', async importOriginal => {
  const { MachineHeader } = await importOriginal<typeof import('./MachineHeader')>();
  return {
    MachineHeader: (props: Parameters<typeof MachineHeader>[0]) => {
      headerRenders.push({ machineId: props.machine.id, firingCount: props.firingCount });
      return <MachineHeader {...props} />;
    },
  };
});

/** The address of the page now, so a test can read the tab in it */
let shownAddress = '';
/** Goes to another address, or back (-1) and forward (1) in the history, as the browser buttons do */
let goTo: NavigateFunction = () => {};
function AddressSpy() {
  const location = useLocation();
  shownAddress = `${location.pathname}${location.search}${location.hash}`;
  goTo = useNavigate();
  return null;
}
const go = (to: string | number) => act(() => { void (typeof to === 'number' ? goTo(to) : goTo(to)); });

function renderPage({
  address = '/machine/m1',
  role = 'admin' as Role,
  machine = testMachine(),
  machines = [machine],
  onRemove = vi.fn(),
}: { address?: string; role?: Role; machine?: Machine; machines?: Machine[]; onRemove?: (id: string) => Promise<boolean> } = {}) {
  const page = (shownMachines: Machine[]) => (
    <CurrentUserContext.Provider value={{ username: 'sam', role }}>
      <Dialog.Provider>
        <MemoryRouter initialEntries={[address]}>
          <Routes>
            <Route
              path="/machine/:id"
              element={<MachineDetailPage machines={shownMachines} isLoaded onRemove={onRemove} onUpdate={vi.fn()} />}
            />
          </Routes>
          <AddressSpy />
        </MemoryRouter>
      </Dialog.Provider>
    </CurrentUserContext.Provider>
  );
  const { rerender } = render(page(machines));
  /** The server sends new machine values. The address and the history stay. */
  return { showMachines: (next: Machine[]) => rerender(page(next)) };
}

const SENT_FILES = [
  { id: 1, file_name: 'O1000.nc', created_at: '2026-11-19T09:00:00.000Z', updated_at: '2026-11-19T09:00:00.000Z', event_count: 1, last_path: '/' },
  { id: 2, file_name: 'O2000.nc', created_at: '2026-11-19T10:00:00.000Z', updated_at: '2026-11-19T10:00:00.000Z', event_count: 2, last_path: '/' },
];

const OFFLINE_RULE: AlertRule = {
  id: 'r1', kind: 'simple', enabled: true, subject: 'not-connected', check: 'above', limit: 0, forMinutes: 10, severity: 'warning',
};

function firingAlert(name: string): MachineAlert {
  return { name, machineId: 'm1', labels: { severity: 'critical' }, annotations: {}, start: '2026-11-20T09:00:00.000Z', end: null, firing: true };
}

const tabNames = () => screen.getAllByRole('tab').map(tab => tab.textContent);
const openPanel = () => screen.getByRole('tabpanel');

describe('MachineDetailPage', () => {
  beforeEach(() => {
    vi.mocked(fetchMachineAlerts).mockReset().mockResolvedValue([]);
    headerRenders.length = 0;
    vi.mocked(fetchValueHistory).mockReset().mockResolvedValue({ points: [], window: '5s' });
    vi.mocked(fetchStateTimeline).mockReset().mockResolvedValue([]);
    // The chart measures its box, and jsdom has no ResizeObserver
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.mocked(fetchAlertRules).mockReset().mockResolvedValue([]);
    vi.mocked(fetchMachineReport).mockReset().mockReturnValue(new Promise(() => {}));
    vi.mocked(fetchFileTree).mockReset().mockResolvedValue({ nodes: [], isCutShort: false });
    vi.mocked(fetchFileBytes).mockReset().mockReturnValue(new Promise(() => {}));
    vi.mocked(fetchUploadFiles).mockReset().mockResolvedValue([]);
    vi.mocked(fetchUploadEvents).mockReset().mockResolvedValue([
      { id: 21, uploaded_at: '2026-11-19T10:00:00.000Z', remote_path: '/', target_name: null, action: 'sent' },
    ]);
    vi.mocked(fetchUploadEvent).mockReset().mockReturnValue(new Promise(() => {}));
    vi.mocked(uploadMachineFiles).mockReset().mockResolvedValue({ ok: true, result: { success: [{ filename: 'O1000.nc' }] } });
  });

  describe('the tabs', () => {
    it('puts the tabs directly under the header, and starts with Dashboard, Report and Files', () => {
      renderPage();

      expect(tabNames().slice(0, 3)).toEqual(['Dashboard', 'Report', 'Files']);
      expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
      // Nothing of the machine values is above the tabs
      const tablist = screen.getByRole('tablist', { name: 'Machine sections' });
      const currentJob = screen.getByRole('region', { name: 'Current job' });
      expect(tablist.compareDocumentPosition(currentJob) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows the current job, the chart and the alerts in the Dashboard tab', async () => {
      renderPage();

      const panel = openPanel();
      expect(panel).toHaveAttribute('aria-labelledby', screen.getByRole('tab', { name: 'Dashboard' }).id);
      expect(within(panel).getByRole('region', { name: 'Current job' })).toBeInTheDocument();
      expect(within(panel).getByRole('region', { name: 'Spindle speed chart' })).toBeInTheDocument();
      expect(within(panel).getByRole('region', { name: 'Alerts' })).toBeInTheDocument();
      expect(within(panel).queryByRole('region', { name: 'Report' })).not.toBeInTheDocument();
    });

    it('shows the report only in the Report tab', () => {
      renderPage();
      expect(screen.queryByRole('region', { name: 'Report' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Report' }));

      expect(within(openPanel()).getByRole('region', { name: 'Report' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Current job' })).not.toBeInTheDocument();
    });

    it('keeps the open tab in the address, so a link or a reload opens the same tab', () => {
      renderPage();

      fireEvent.click(screen.getByRole('tab', { name: 'Report' }));

      expect(shownAddress).toBe('/machine/m1?tab=report');
    });

    it('opens the tab that the address names', () => {
      renderPage({ address: '/machine/m1?tab=report' });

      expect(screen.getByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true');
      expect(within(openPanel()).getByRole('region', { name: 'Report' })).toBeInTheDocument();
    });

    it('opens the Dashboard for an unknown tab name', () => {
      renderPage({ address: '/machine/m1?tab=nonsense' });

      expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
    });
    it('fixes the address when the tab is not there, so the tab cannot open later by itself', () => {
      const { showMachines } = renderPage({ address: '/machine/m1?tab=tools' });
      expect(shownAddress).toBe('/machine/m1');

      showMachines([testMachine({}, { toolTable: { 1: { toolNum: 1 } } })]);

      expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
    });

    it('fixes the address for an unknown tab name', () => {
      renderPage({ address: '/machine/m1?tab=nonsense' });

      expect(shownAddress).toBe('/machine/m1');
    });

    it('goes back and forward between the tabs that the user opened', () => {
      renderPage();
      fireEvent.click(screen.getByRole('tab', { name: 'Report' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Files' }));

      go(-1);
      expect(screen.getByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true');
      expect(shownAddress).toBe('/machine/m1?tab=report');

      go(-1);
      expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');

      go(1);
      expect(screen.getByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true');
      expect(within(openPanel()).getByRole('region', { name: 'Report' })).toBeInTheDocument();
    });

    it('adds no history step for a click on the open tab', () => {
      renderPage();
      fireEvent.click(screen.getByRole('tab', { name: 'Report' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Report' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Report' }));

      go(-1);

      expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
      expect(shownAddress).toBe('/machine/m1');
    });

    it('opens the first tab again for the next machine', async () => {
      vi.mocked(fetchUploadFiles).mockResolvedValue(SENT_FILES);
      renderPage({ machines: [testMachine(), testMachine({ id: 'm2', name: 'Mill 2' })] });
      fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Upload history 2' }));

      go('/machine/m2');
      expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
      go('/machine/m2?tab=files');

      expect(screen.getByRole('button', { name: 'On the machine' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('the state of the tabs', () => {
    const pressed = (group: string) =>
      within(screen.getByRole('group', { name: group })).getAllByRole('button').find(button => button.getAttribute('aria-pressed') === 'true')?.textContent;
    const chart = () => screen.getByRole('region', { name: 'Spindle speed chart' });

    /** The button is on: it has no aria-disabled, and it is not disabled */
    const expectOn = (button: HTMLElement) => {
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
      expect(button).toBeEnabled();
    };

    it('keeps the time range of the chart when the user opens another tab and comes back', () => {
      renderPage();
      fireEvent.click(within(within(chart()).getByRole('group', { name: 'Time range' })).getByRole('button', { name: '7d' }));

      fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));

      expect(within(chart()).getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('keeps the time of the chart after a move back in time', () => {
      renderPage();
      // A sideways scroll of a quarter of the range back
      fireEvent.wheel(within(chart()).getByRole('group', { name: 'Chart: drag or scroll sideways to move in time' }), { deltaX: -80, deltaY: 0 });
      const movedText = within(chart()).getByText(/from .* to /, { selector: 'span' }).textContent;
      expectOn(within(chart()).getByRole('button', { name: 'Now' }));

      fireEvent.click(screen.getByRole('tab', { name: 'Report' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));

      expectOn(within(chart()).getByRole('button', { name: 'Now' }));
      expect(within(chart()).getByText(/from .* to /, { selector: 'span' }).textContent).toBe(movedText);
    });

    it('keeps the view history of the chart when the user opens another tab and comes back', () => {
      renderPage();
      fireEvent.click(within(within(chart()).getByRole('group', { name: 'Time range' })).getByRole('button', { name: '7d' }));

      fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
      fireEvent.click(within(chart()).getByRole('button', { name: 'Previous view' }));

      expect(within(chart()).getByRole('button', { name: '10m' })).toHaveAttribute('aria-pressed', 'true');
      expect(within(chart()).getByRole('button', { name: 'Next view' })).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('starts a new view history of the chart for the next machine', () => {
      renderPage({ machines: [testMachine(), testMachine({ id: 'm2', name: 'Mill 2' })] });
      fireEvent.click(within(chart()).getByRole('button', { name: '7d' }));
      expect(within(chart()).getByRole('button', { name: 'Previous view' })).not.toHaveAttribute('aria-disabled', 'true');

      go('/machine/m2');

      expect(within(chart()).getByRole('button', { name: '10m' })).toHaveAttribute('aria-pressed', 'true');
      expect(within(chart()).getByRole('button', { name: 'Previous view' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('keeps the time range of the report when the user opens another tab and comes back', () => {
      renderPage({ address: '/machine/m1?tab=report' });
      fireEvent.click(within(screen.getByRole('region', { name: 'Report' })).getByRole('button', { name: '7d' }));

      fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Report' }));

      expect(pressed('Time range')).toBe('7d');
    });

    it('starts the chart and the report again for the next machine', () => {
      renderPage({ address: '/machine/m1?tab=report', machines: [testMachine(), testMachine({ id: 'm2', name: 'Mill 2' })] });
      fireEvent.click(screen.getByRole('button', { name: '7d' }));

      go('/machine/m2?tab=report');

      expect(pressed('Time range')).toBe('24h');
    });
  });

  describe('the Files tab', () => {
    const openFilesTab = async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
      await waitFor(() => expect(fetchUploadFiles).toHaveBeenCalled());
    };
    const viewSwitch = () => screen.getByRole('group', { name: 'Files to show' });

    it('lists no files and loads no upload history on a visit to the other tabs', async () => {
      renderPage();
      await waitFor(() => expect(fetchMachineAlerts).toHaveBeenCalled());
      fireEvent.click(screen.getByRole('tab', { name: 'Report' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
      await screen.findByText(/Click a word in a rule to change it/);

      expect(fetchFileTree).not.toHaveBeenCalled();
      expect(fetchUploadFiles).not.toHaveBeenCalled();
    });

    it('loads the files and the upload history once, at the first open of the tab', async () => {
      renderPage();
      await openFilesTab();
      await waitFor(() => expect(fetchFileTree).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Files' }));

      expect(fetchFileTree).toHaveBeenCalledTimes(1);
      expect(fetchUploadFiles).toHaveBeenCalledTimes(1);
    });

    // The server cuts a list at 5000 entries, at 200 folders, after 2 minutes, or after a folder list that is too long.
    // The user must know that files can be missing.
    const CUT_SHORT_NOTE = 'List cut short. The machine has too many files or folders, answers too slowly, or stopped a folder list. Chatter shows only part of the list.';
    const PROGRAM = { name: 'O1000', path: '/O1000', type: 'file', size: 10 } as FTPTreeNode;

    it('tells the user when the server cut the file list short', async () => {
      vi.mocked(fetchFileTree).mockResolvedValue({ nodes: [PROGRAM], isCutShort: true });
      renderPage();
      await openFilesTab();

      expect(await screen.findByText(CUT_SHORT_NOTE)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'O1000' })).toBeInTheDocument();
    });

    it('shows no cut-short note for a complete file list', async () => {
      vi.mocked(fetchFileTree).mockResolvedValue({ nodes: [PROGRAM], isCutShort: false });
      renderPage();
      await openFilesTab();

      await screen.findByRole('button', { name: 'O1000' });
      expect(screen.queryByText(CUT_SHORT_NOTE)).not.toBeInTheDocument();
    });

    it('removes the cut-short note when the next list is complete', async () => {
      vi.mocked(fetchFileTree).mockResolvedValueOnce({ nodes: [PROGRAM], isCutShort: true });
      renderPage();
      await openFilesTab();
      await screen.findByText(CUT_SHORT_NOTE);

      fireEvent.click(screen.getByRole('button', { name: 'Load the files again' }));

      await waitFor(() => expect(screen.queryByText(CUT_SHORT_NOTE)).not.toBeInTheDocument());
      expect(fetchFileTree).toHaveBeenCalledTimes(2);
    });

    // An old note must not stay next to an error: the user would think that the list is there
    it('shows the error and removes the cut-short note when the next list fails', async () => {
      vi.mocked(fetchFileTree)
        .mockResolvedValueOnce({ nodes: [PROGRAM], isCutShort: true })
        .mockRejectedValueOnce(new Error('The machine did not answer'));
      renderPage();
      await openFilesTab();
      await screen.findByText(CUT_SHORT_NOTE);

      fireEvent.click(screen.getByRole('button', { name: 'Load the files again' }));

      expect(await screen.findByText('Could not load the files: The machine did not answer')).toBeInTheDocument();
      expect(screen.queryByText(CUT_SHORT_NOTE)).not.toBeInTheDocument();
    });

    it('loads the files at once when the address opens the Files tab', async () => {
      renderPage({ address: '/machine/m1?tab=files' });

      await waitFor(() => expect(fetchFileTree).toHaveBeenCalledWith('m1', '/'));
      expect(fetchUploadFiles).toHaveBeenCalledWith('m1');
    });

    it('holds the files on the machine and the upload history, with a switch between them', async () => {
      vi.mocked(fetchUploadFiles).mockResolvedValue(SENT_FILES);
      renderPage();
      await openFilesTab();

      expect(screen.queryByRole('tab', { name: /Upload history/ })).not.toBeInTheDocument();
      const onMachine = within(viewSwitch()).getByRole('button', { name: 'On the machine' });
      const uploads = await within(viewSwitch()).findByRole('button', { name: 'Upload history 2' });
      expect(onMachine).toHaveAttribute('aria-pressed', 'true');
      expect(uploads).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('navigation', { name: 'Folders' })).toBeInTheDocument();

      fireEvent.click(uploads);

      expect(uploads).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('Every file sent to Mill 1. Chatter keeps each version.')).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: 'O2000.nc' })).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Folders' })).not.toBeInTheDocument();
    });

    it('has no count on the Files tab', async () => {
      vi.mocked(fetchUploadFiles).mockResolvedValue(SENT_FILES);
      renderPage();
      await openFilesTab();

      expect(screen.getByRole('tab', { name: 'Files' })).toHaveTextContent(/^Files$/);
    });

    it.each(['On the machine', 'Upload history 0'])('lets an operator send files from the %s view', async view => {
      renderPage({ role: 'operator' });
      await openFilesTab();
      fireEvent.click(within(viewSwitch()).getByRole('button', { name: view }));

      fireEvent.click(screen.getByRole('button', { name: 'Send files' }));

      expect(screen.getByText('Send files to')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Send files' })).toHaveLength(1);
    });

    it.each([
      ['an operator', 'operator' as Role, 1],
      ['a viewer', 'viewer' as Role, 0],
    ])('shows Send again in the upload history to %s only when the role can send files', async (_who, role, count) => {
      vi.mocked(fetchUploadFiles).mockResolvedValue(SENT_FILES);
      renderPage({ role, address: '/machine/m1?tab=files' });
      fireEvent.click(await within(viewSwitch()).findByRole('button', { name: 'Upload history 2' }));
      const o2000Row = screen.getByRole('cell', { name: 'O2000.nc' }).closest('tr') as HTMLElement;

      expect(within(o2000Row).queryAllByRole('button', { name: 'Send again' })).toHaveLength(count);
      fireEvent.click(within(o2000Row).getByRole('button', { name: 'Versions' }));
      await screen.findByRole('list', { name: 'Versions of O2000.nc' });
      expect(screen.queryAllByRole('button', { name: 'Send this version again' })).toHaveLength(count);
    });

    it.each([
      ['an operator', 'operator' as Role, 1],
      ['a viewer', 'viewer' as Role, 0],
    ])('lets %s download and read a file on the machine only when the role can read files', async (_who, role, count) => {
      vi.mocked(fetchFileTree).mockResolvedValue({ nodes: [{ name: 'O1000.NC', path: '/O1000.NC', type: 'file', size: 6 } as FTPTreeNode], isCutShort: false });
      renderPage({ role, address: '/machine/m1?tab=files' });
      const row = (await screen.findByRole('cell', { name: 'O1000.NC' })).closest('tr') as HTMLElement;

      // The name, the size and the date stay for each role
      expect(within(row).getByText('O1000.NC')).toBeInTheDocument();
      expect(within(row).queryAllByRole('link', { name: 'Download O1000.NC' })).toHaveLength(count);
      expect(within(row).queryAllByRole('button', { name: 'O1000.NC' })).toHaveLength(count);
    });

    it.each([
      ['an operator', 'operator' as Role, 1],
      ['a viewer', 'viewer' as Role, 0],
    ])('shows the text of a sent version to %s only when the role can read files', async (_who, role, count) => {
      vi.mocked(fetchUploadFiles).mockResolvedValue(SENT_FILES);
      renderPage({ role, address: '/machine/m1?tab=files' });
      fireEvent.click(await within(viewSwitch()).findByRole('button', { name: 'Upload history 2' }));
      const o2000Row = screen.getByRole('cell', { name: 'O2000.nc' }).closest('tr') as HTMLElement;
      fireEvent.click(within(o2000Row).getByRole('button', { name: 'Versions' }));

      // The dates and the paths of the versions stay for each role
      const versions = await screen.findByRole('list', { name: 'Versions of O2000.nc' });
      expect(within(versions).getAllByRole('listitem')).toHaveLength(1);
      expect(within(versions).getByText(/newest/)).toBeInTheDocument();
      expect(screen.queryAllByLabelText('The text of the picked version')).toHaveLength(count);
      // The text loads in an effect, which React can run after the list shows
      await waitFor(() => expect(fetchUploadEvent).toHaveBeenCalledTimes(count));
    });

    it.each([
      ['an admin', 'admin' as Role, { uploaded_by: 'alice', address: '192.168.1.20' }, ['Sent by alice from 192.168.1.20']],
      ['an operator', 'operator' as Role, { uploaded_by: 'alice' }, ['Sent by alice']],
      ['a viewer', 'viewer' as Role, {}, []],
    ])('shows %s who sent each version, as the server sends it for the role', async (_who, role, sender, lines) => {
      vi.mocked(fetchUploadFiles).mockResolvedValue(SENT_FILES);
      vi.mocked(fetchUploadEvents).mockResolvedValue([
        { id: 21, uploaded_at: '2026-11-19T10:00:00.000Z', remote_path: '/', target_name: null, action: 'sent', ...sender },
      ]);
      renderPage({ role, address: '/machine/m1?tab=files' });
      fireEvent.click(await within(viewSwitch()).findByRole('button', { name: 'Upload history 2' }));
      fireEvent.click(within(screen.getByRole('cell', { name: 'O2000.nc' }).closest('tr') as HTMLElement).getByRole('button', { name: 'Versions' }));

      const versions = await screen.findByRole('list', { name: 'Versions of O2000.nc' });
      expect(within(versions).queryAllByText(/^Sent by/).map(line => line.textContent)).toEqual(lines);
    });

    it('shows the versions to a viewer as plain items, and says why there is no text', async () => {
      vi.mocked(fetchUploadFiles).mockResolvedValue(SENT_FILES);
      renderPage({ role: 'viewer', address: '/machine/m1?tab=files' });
      fireEvent.click(await within(viewSwitch()).findByRole('button', { name: 'Upload history 2' }));
      fireEvent.click(within(screen.getByRole('cell', { name: 'O2000.nc' }).closest('tr') as HTMLElement).getByRole('button', { name: 'Versions' }));

      const versions = await screen.findByRole('list', { name: 'Versions of O2000.nc' });
      expect(within(versions).queryAllByRole('button')).toHaveLength(0);
      expect(versions.querySelector('[aria-pressed]')).toBeNull();
      expect(screen.getByText('Your role cannot read the text of a program. Ask an admin.')).toBeInTheDocument();
    });

    it('shows the versions to an operator as buttons, with no line about the role', async () => {
      vi.mocked(fetchUploadFiles).mockResolvedValue(SENT_FILES);
      renderPage({ role: 'operator', address: '/machine/m1?tab=files' });
      fireEvent.click(await within(viewSwitch()).findByRole('button', { name: 'Upload history 2' }));
      fireEvent.click(within(screen.getByRole('cell', { name: 'O2000.nc' }).closest('tr') as HTMLElement).getByRole('button', { name: 'Versions' }));

      const versions = await screen.findByRole('list', { name: 'Versions of O2000.nc' });
      expect(within(versions).getByRole('button', { pressed: true })).toHaveTextContent(/newest/);
      expect(screen.queryByText(/Your role cannot read the text/)).not.toBeInTheDocument();
    });

    it('shows the text of the picked version to an operator, with Send this version again', async () => {
      vi.mocked(fetchUploadFiles).mockResolvedValue(SENT_FILES);
      vi.mocked(fetchUploadEvent).mockResolvedValue({
        id: 21, uploaded_at: '2026-11-19T10:00:00.000Z', remote_path: '/', target_name: null, action: 'sent', file_name: 'O2000.nc', file_content: 'G00 X0',
      });
      renderPage({ role: 'operator', address: '/machine/m1?tab=files' });
      fireEvent.click(await within(viewSwitch()).findByRole('button', { name: 'Upload history 2' }));
      fireEvent.click(within(screen.getByRole('cell', { name: 'O2000.nc' }).closest('tr') as HTMLElement).getByRole('button', { name: 'Versions' }));

      await waitFor(() => expect(screen.getByLabelText('The text of the picked version')).toHaveTextContent('G00 X0'));
      expect(fetchUploadEvent).toHaveBeenCalledWith('m1', 21);

      fireEvent.click(screen.getByRole('button', { name: 'Send this version again' }));

      // The operator confirms before Chatter sends it
      expect(await screen.findByText('Send O2000.nc again?')).toBeInTheDocument();
    });

    it('opens the text of a file on the machine for an operator, with a download link', async () => {
      vi.mocked(fetchFileTree).mockResolvedValue({ nodes: [{ name: 'O1000.NC', path: '/O1000.NC', type: 'file', size: 6 } as FTPTreeNode], isCutShort: false });
      vi.mocked(fetchFileBytes).mockResolvedValue(new TextEncoder().encode('G00 X0'));
      renderPage({ role: 'operator', address: '/machine/m1?tab=files' });
      const row = (await screen.findByRole('cell', { name: 'O1000.NC' })).closest('tr') as HTMLElement;
      expect(within(row).getByRole('link', { name: 'Download O1000.NC' })).toHaveAttribute('href', expect.stringContaining('/machine/m1/files/download'));

      fireEvent.click(within(row).getByRole('button', { name: 'O1000.NC' }));

      expect(await screen.findByRole('region', { name: 'Text of O1000.NC' })).toHaveTextContent('G00 X0');
      expect(fetchFileBytes).toHaveBeenCalledWith('m1', '/O1000.NC', expect.any(Number), expect.any(AbortSignal));
    });

    it.each([
      ['a viewer', 'viewer' as Role, 1],
      ['an operator', 'operator' as Role, 0],
    ])('says once above the files on the machine why %s has no download', async (_who, role, count) => {
      vi.mocked(fetchFileTree).mockResolvedValue({
        nodes: [
          { name: 'O1000.NC', path: '/O1000.NC', type: 'file', size: 6 } as FTPTreeNode,
          { name: 'O2000.NC', path: '/O2000.NC', type: 'file', size: 6 } as FTPTreeNode,
        ],
        isCutShort: false,
      });
      renderPage({ role, address: '/machine/m1?tab=files' });
      const table = (await screen.findByRole('cell', { name: 'O1000.NC' })).closest('table') as HTMLElement;

      expect(screen.queryAllByText('Your role cannot read the text of a program. Ask an admin.')).toHaveLength(count);
      expect(within(table).queryByText(/Your role cannot read/)).not.toBeInTheDocument();
    });

    it('shows no Send files button to a viewer', async () => {
      renderPage({ role: 'viewer' });
      await openFilesTab();

      expect(viewSwitch()).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Send files' })).not.toBeInTheDocument();
    });

    /** Opens Send files, picks one file, and sends it */
    const sendOneFile = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send files' }));
      await sendPickedFile();
    };
    /** In the open Send files panel: picks one file and sends it */
    const sendPickedFile = async () => {
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [new File(['G0'], 'O1000.nc')] } });
      fireEvent.click(screen.getByRole('button', { name: 'Send 1 file' }));
      await waitFor(() => expect(uploadMachineFiles).toHaveBeenCalled());
    };

    it('loads the files and the upload history again after an upload', async () => {
      renderPage({ role: 'operator' });
      await openFilesTab();
      await waitFor(() => expect(fetchFileTree).toHaveBeenCalledTimes(1));
      const historyLoads = vi.mocked(fetchUploadFiles).mock.calls.length;

      await sendOneFile();

      await waitFor(() => expect(fetchFileTree).toHaveBeenCalledTimes(2));
      expect(fetchFileTree).toHaveBeenLastCalledWith('m1', '/');
      await waitFor(() => expect(fetchUploadFiles).toHaveBeenCalledTimes(historyLoads + 1));
    });

    it('sends to the folder that was open, also from the Upload history view', async () => {
      vi.mocked(fetchFileTree).mockImplementation(async (_id, path) => ({
        nodes: path === '/' ? [{ name: 'PROGRAMS', path: '/PROGRAMS', type: 'directory', size: 0 } as FTPTreeNode] : [],
        isCutShort: false,
      }));
      renderPage({ role: 'operator' });
      await openFilesTab();
      fireEvent.click(await screen.findByRole('button', { name: 'PROGRAMS' }));
      await waitFor(() => expect(fetchFileTree).toHaveBeenLastCalledWith('m1', '/PROGRAMS'));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Send files' })).toBeEnabled());
      fireEvent.click(within(viewSwitch()).getByRole('button', { name: /Upload history/ }));

      fireEvent.click(screen.getByRole('button', { name: 'Send files' }));
      expect(screen.getByText('Send files to').textContent).toBe('Send files to /PROGRAMS');
      await sendPickedFile();
      expect(vi.mocked(uploadMachineFiles).mock.calls[0][2]).toBe('/PROGRAMS');
    });

    it('shows the result of the upload above the files, and the user can close it', async () => {
      renderPage({ role: 'operator' });
      await openFilesTab();

      await sendOneFile();

      const notice = await screen.findByRole('status');
      expect(notice).toHaveTextContent('Sent 1 file to /');
      fireEvent.click(within(notice).getByRole('button', { name: 'Close this notice' }));
      expect(screen.queryByText('Sent 1 file to /')).not.toBeInTheDocument();
    });

    it('shows the error when the upload does not work', async () => {
      vi.mocked(uploadMachineFiles).mockResolvedValue({ ok: false, result: { error: 'No space on the machine' } });
      renderPage({ role: 'operator' });
      await openFilesTab();

      await sendOneFile();

      expect(await screen.findByText('No space on the machine')).toBeInTheDocument();
    });
  });

  describe('the Tool table tab', () => {
    const NOT_SYNCED = { lastSyncAt: null, lastAttemptAt: null, error: null, running: false };

    it('is there for a Brother before the first tool read, with no count, and offers Sync', () => {
      renderPage({ machine: testMachine({}, { toolSync: NOT_SYNCED }) });
      expect(tabNames()).toEqual(['Dashboard', 'Report', 'Files', 'Tool table', 'Settings']);

      fireEvent.click(screen.getByRole('tab', { name: 'Tool table' }));

      expect(screen.getByText('Not synced yet')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument();
    });
  });

  describe('the Settings tab', () => {
    const toolMachine = () => testMachine({}, { toolTable: { 1: { toolNum: 1 }, 2: { toolNum: 2 } } });

    it('is the last tab, after the tool table, for each role', () => {
      for (const role of ['admin', 'operator', 'viewer'] as const) {
        renderPage({ role, machine: toolMachine() });
        expect(tabNames()).toEqual(['Dashboard', 'Report', 'Files', 'Tool table 2', 'Settings']);
        cleanup();
      }
    });

    it('shows an admin five panels, Machine, Connection, Alert rules, Advanced and Delete machine, with no side menu', async () => {
      vi.mocked(fetchAlertRules).mockResolvedValue([OFFLINE_RULE]);
      renderPage();

      fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));

      const machineSection = screen.getByRole('region', { name: 'Machine' });
      expect(within(machineSection).getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
      const rulesSection = screen.getByRole('region', { name: 'Alert rules' });
      expect(await within(rulesSection).findByText(/Click a word in a rule to change it/)).toBeInTheDocument();
      expect(fetchAlertRules).toHaveBeenCalledWith('m1');
      const panel = screen.getByRole('tabpanel', { name: 'Settings' });
      expect(within(panel).getAllByRole('region').map(region => region.id).filter(Boolean)).toEqual([
        machineSection.id, SETTINGS_SECTION_IDS.connection, rulesSection.id, SETTINGS_SECTION_IDS.advanced, SETTINGS_SECTION_IDS.deleteMachine,
      ]);
      expect(screen.queryByRole('navigation', { name: 'Settings sections' })).not.toBeInTheDocument();
    });

    it('keeps the backup and restore of the history closed under Advanced, until the admin opens it', () => {
      renderPage();
      fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));

      const advanced = within(screen.getByRole('region', { name: 'Advanced' }));
      const disclosure = advanced.getByText('Advanced').closest('details')!;
      expect(disclosure.open).toBe(false);
      fireEvent.click(advanced.getByText('Advanced'));
      expect(disclosure.open).toBe(true);
      expect(advanced.getByRole('button', { name: 'Back up history' })).toBeInTheDocument();
      expect(advanced.getByRole('button', { name: 'Restore history' })).toBeInTheDocument();
    });

    it.each(['operator', 'viewer'] as const)('has no Advanced panel for a user who cannot manage machines (%s)', role => {
      renderPage({ role });
      fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
      expect(screen.queryByRole('region', { name: 'Advanced' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Back up history' })).not.toBeInTheDocument();
    });

    // The alert rules are settings. The server gives them only to a role with manage-machines (decision D4).
    it.each(['operator', 'viewer'] as const)('does not load the alert rules for %s, and shows only the connection, with no error', role => {
      renderPage({ role });

      fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));

      const panel = screen.getByRole('tabpanel', { name: 'Settings' });
      expect(within(panel).getAllByRole('region').map(region => region.id)).toEqual([SETTINGS_SECTION_IDS.connection]);
      expect(within(panel).queryByText(/alert rules/i)).not.toBeInTheDocument();
      expect(fetchAlertRules).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    });

    it('shows no rules of the old machine when the user goes to another machine', async () => {
      vi.mocked(fetchAlertRules).mockImplementation(id => (id === 'm1' ? Promise.resolve([OFFLINE_RULE]) : new Promise(() => {})));
      renderPage({
        address: '/machine/m1?tab=settings',
        machines: [testMachine({ id: 'm1', name: 'Mill 1' }), testMachine({ id: 'm2', name: 'Mill 2' })],
      });
      expect(await screen.findByRole('switch', { name: 'Not connected' })).toBeInTheDocument();

      go('/machine/m2?tab=settings');

      expect(screen.getByText('Loading the alert rules…')).toBeInTheDocument();
      expect(screen.queryByRole('switch', { name: 'Not connected' })).not.toBeInTheDocument();
      expect(fetchAlertRules).toHaveBeenLastCalledWith('m2');
    });
  });

  describe('deleting the machine', () => {
    const LABEL = 'Type DELETE to enable the Delete button';
    const openDeleteDialog = () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
      const section = screen.getByRole('region', { name: 'Delete machine' });
      fireEvent.click(within(section).getByRole('button', { name: 'Delete this machine' }));
      return screen.findByRole('alertdialog');
    };
    const confirmButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Delete the machine' });

    it('has its own panel, and is not in the machine form', () => {
      renderPage();

      fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));

      expect(within(screen.getByRole('region', { name: 'Delete machine' })).getByRole('button', { name: 'Delete this machine' })).toBeInTheDocument();
      expect(within(screen.getByRole('region', { name: 'Machine' })).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    });

    it('names the box with its title, for a screen reader', async () => {
      renderPage();

      await openDeleteDialog();

      expect(screen.getByRole('alertdialog', { name: `Delete ${testMachine().name}?` })).toBeInTheDocument();
    });

    it('lets the admin delete the machine only after they type "delete", in any case and with spaces around it', async () => {
      renderPage({ onRemove: vi.fn().mockResolvedValue(true) });
      const dialog = await openDeleteDialog();
      const box = within(dialog).getByLabelText(LABEL);

      expect(confirmButton(dialog)).toBeDisabled();
      fireEvent.change(box, { target: { value: 'remove' } });
      expect(confirmButton(dialog)).toBeDisabled();
      fireEvent.change(box, { target: { value: 'Delete' } });
      expect(confirmButton(dialog)).toBeEnabled();
      fireEvent.change(box, { target: { value: '  DELETE  ' } });
      expect(confirmButton(dialog)).toBeEnabled();
    });

    it('deletes the machine and goes to the machine list', async () => {
      const onRemove = vi.fn().mockResolvedValue(true);
      renderPage({ onRemove });
      const dialog = await openDeleteDialog();

      fireEvent.change(within(dialog).getByLabelText(LABEL), { target: { value: 'DELETE' } });
      fireEvent.click(confirmButton(dialog));

      await waitFor(() => expect(onRemove).toHaveBeenCalledWith('m1'));
      await waitFor(() => expect(shownAddress).toBe('/'));
    });

    it('stays on the machine page when the delete fails', async () => {
      const onRemove = vi.fn().mockResolvedValue(false);
      renderPage({ onRemove });
      const dialog = await openDeleteDialog();

      fireEvent.change(within(dialog).getByLabelText(LABEL), { target: { value: 'DELETE' } });
      fireEvent.click(confirmButton(dialog));

      await waitFor(() => expect(onRemove).toHaveBeenCalled());
      expect(shownAddress).toMatch(/^\/machine\/m1/);
    });

    it('keeps the machine when the admin closes the box, and starts empty when they open it again', async () => {
      const onRemove = vi.fn().mockResolvedValue(true);
      renderPage({ onRemove });
      let dialog = await openDeleteDialog();
      fireEvent.change(within(dialog).getByLabelText(LABEL), { target: { value: 'DELETE' } });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Keep the machine' }));
      fireEvent.click(within(screen.getByRole('region', { name: 'Delete machine' })).getByRole('button', { name: 'Delete this machine' }));
      dialog = await screen.findByRole('alertdialog');

      expect(within(dialog).getByLabelText(LABEL)).toHaveValue('');
      expect(confirmButton(dialog)).toBeDisabled();
      expect(onRemove).not.toHaveBeenCalled();
    });

    it.each(['operator', 'viewer'] as const)('is not there for a user who cannot manage machines (%s)', role => {
      renderPage({ role });

      fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));

      expect(screen.queryByRole('region', { name: 'Delete machine' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    });
  });

  describe('the link from the alerts to the rules', () => {
    const scrolledTo: Element[] = [];
    beforeEach(() => {
      scrolledTo.length = 0;
      // jsdom does not scroll
      Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
        scrolledTo.push(this);
      };
    });
    afterEach(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    });

    it.each(['operator', 'viewer'] as const)('is not there for %s, who cannot read the rules', async role => {
      renderPage({ role });

      const alerts = screen.getByRole('region', { name: 'Alerts' });
      expect(await within(alerts).findByText(/No alerts in the last 7 days/)).toBeInTheDocument();
      expect(within(alerts).queryByRole('link')).not.toBeInTheDocument();
      expect(within(alerts).queryByText(/Alert rules/)).not.toBeInTheDocument();
    });

    // Older links and bookmarks can open the rules as an Operator or a Viewer. The page then shows the connection.
    it.each(['operator', 'viewer'] as const)('opens Settings with no error for %s, from an old link to the rules', role => {
      renderPage({ role, address: '/machine/m1?tab=settings#settings-alert-rules' });

      expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
      const panel = screen.getByRole('tabpanel', { name: 'Settings' });
      expect(within(panel).getAllByRole('region').map(region => region.id)).toEqual([SETTINGS_SECTION_IDS.connection]);
      expect(scrolledTo).toEqual([]);
      expect(fetchAlertRules).not.toHaveBeenCalled();
    });

    // These tests of an Admin also check that the link is there for an Admin. Keep them.

    it('opens Settings at the alert rules', async () => {
      renderPage();

      fireEvent.click(await screen.findByRole('link', { name: 'Settings › Alert rules' }));

      expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
      const rulesSection = screen.getByRole('region', { name: 'Alert rules' });
      expect(shownAddress).toBe(`/machine/m1?tab=settings#${rulesSection.id}`);
      await waitFor(() => expect(scrolledTo).toContain(rulesSection));
    });

    it('goes back to the Dashboard from the alert rules', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('link', { name: 'Settings › Alert rules' }));

      go(-1);

      expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('region', { name: 'Alerts' })).toBeInTheDocument();
    });

    it('scrolls to the alert rules again when they load, because the page is longer then', async () => {
      let loadRules: (rules: AlertRule[]) => void = () => {};
      vi.mocked(fetchAlertRules).mockReturnValue(new Promise(resolve => { loadRules = resolve; }));
      renderPage({ address: '/machine/m1?tab=settings#settings-alert-rules' });
      const rulesSection = screen.getByRole('region', { name: 'Alert rules' });
      await waitFor(() => expect(scrolledTo).toEqual([rulesSection]));

      loadRules([OFFLINE_RULE]);

      await screen.findByText(/Click a word in a rule to change it/);
      // The second scroll is in an effect that runs after the rules show, so wait for it
      await waitFor(() => expect(scrolledTo).toEqual([rulesSection, rulesSection]));
    });

    it('does not move the page when the rules load after the user scrolled', async () => {
      let loadRules: (rules: AlertRule[]) => void = () => {};
      vi.mocked(fetchAlertRules).mockReturnValue(new Promise(resolve => { loadRules = resolve; }));
      renderPage({ address: '/machine/m1?tab=settings#settings-alert-rules' });
      const rulesSection = screen.getByRole('region', { name: 'Alert rules' });
      await waitFor(() => expect(scrolledTo).toEqual([rulesSection]));

      fireEvent.wheel(document.body, { deltaY: -200 });
      loadRules([OFFLINE_RULE]);

      await screen.findByText(/Click a word in a rule to change it/);
      expect(scrolledTo).toEqual([rulesSection]);
    });

    it('scrolls again for the next link, also after the user scrolled', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('link', { name: 'Settings › Alert rules' }));
      const rulesSection = screen.getByRole('region', { name: 'Alert rules' });
      await waitFor(() => expect(scrolledTo).toEqual([rulesSection]));
      fireEvent.wheel(document.body, { deltaY: -200 });

      go(-1);
      fireEvent.click(await screen.findByRole('link', { name: 'Settings › Alert rules' }));

      await waitFor(() => expect(scrolledTo).toEqual([rulesSection, screen.getByRole('region', { name: 'Alert rules' })]));
    });
  });

  describe('the firing alerts', () => {
    const header = () => screen.getByRole('heading', { level: 1, name: 'Mill 1' }).parentElement as HTMLElement;

    it('shows a badge next to the machine name and a count on the Dashboard tab, from one load of the alerts', async () => {
      vi.mocked(fetchMachineAlerts).mockResolvedValue([firingAlert('Spindle load'), firingAlert('Offline')]);
      renderPage();

      expect(await within(header()).findByRole('link', { name: '2 alerts firing' })).toBeInTheDocument();
      // A browser joins inline text with no space, so the text itself must hold the space (jsdom adds one for each element)
      expect(screen.getByRole('tab', { name: /^Dashboard/ }).textContent).toBe('Dashboard 2 alerts firing');
      expect(screen.getByText('2 firing now')).toBeInTheDocument();
      expect(fetchMachineAlerts).toHaveBeenCalledTimes(1);
    });

    it('says "1 alert firing" for one alert', async () => {
      vi.mocked(fetchMachineAlerts).mockResolvedValue([firingAlert('Offline')]);
      renderPage();

      expect(await within(header()).findByRole('link', { name: '1 alert firing' })).toBeInTheDocument();
    });

    it('opens the Dashboard tab from the badge', async () => {
      vi.mocked(fetchMachineAlerts).mockResolvedValue([firingAlert('Offline')]);
      renderPage({ address: '/machine/m1?tab=report' });

      fireEvent.click(await screen.findByRole('link', { name: '1 alert firing' }));

      expect(screen.getByRole('tab', { name: /^Dashboard/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('region', { name: 'Alerts' })).toBeInTheDocument();
    });

    it('goes back to the tab before after a click on the badge', async () => {
      vi.mocked(fetchMachineAlerts).mockResolvedValue([firingAlert('Offline')]);
      renderPage();
      fireEvent.click(screen.getByRole('tab', { name: 'Report' }));

      fireEvent.click(await screen.findByRole('link', { name: '1 alert firing' }));
      expect(screen.getByRole('tab', { name: /^Dashboard/ })).toHaveAttribute('aria-selected', 'true');
      go(-1);

      expect(screen.getByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true');
    });

    it('adds no history step for a click on the badge when the Dashboard is open', async () => {
      vi.mocked(fetchMachineAlerts).mockResolvedValue([firingAlert('Offline')]);
      renderPage({ address: '/machine/m1?tab=report' });
      fireEvent.click(screen.getByRole('tab', { name: /^Dashboard/ }));
      const badge = await screen.findByRole('link', { name: '1 alert firing' });
      fireEvent.click(badge);
      fireEvent.click(badge);

      go(-1);

      expect(screen.getByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true');
    });

    it('never shows the firing alerts of one machine on the page of the next machine', async () => {
      vi.mocked(fetchMachineAlerts).mockImplementation(async machineId => (machineId === 'm1' ? [firingAlert('Offline')] : new Promise(() => {})));
      renderPage({ machines: [testMachine(), testMachine({ id: 'm2', name: 'Mill 2' })] });
      await within(header()).findByRole('link', { name: '1 alert firing' });

      go('/machine/m2');

      expect(screen.getByRole('heading', { level: 1, name: 'Mill 2' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /firing/ })).not.toBeInTheDocument();
      // Also not for one render: the old count would flash on the screen
      expect(headerRenders.filter(shown => shown.machineId === 'm2').map(shown => shown.firingCount)).not.toContain(1);
    });

    it('shows no badge and no count when no alert fires', async () => {
      vi.mocked(fetchMachineAlerts).mockResolvedValue([{ ...firingAlert('Offline'), firing: false, end: '2026-11-20T09:05:00.000Z' }]);
      renderPage();

      await screen.findByText('Offline');
      expect(screen.queryByRole('link', { name: /firing/ })).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Dashboard' })).toBeInTheDocument();
    });

    it('updates the badge when the alerts load again after 15 seconds', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      try {
        renderPage();
        await waitFor(() => expect(fetchMachineAlerts).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole('link', { name: /firing/ })).not.toBeInTheDocument();
        vi.mocked(fetchMachineAlerts).mockResolvedValue([firingAlert('Offline')]);

        await vi.advanceTimersByTimeAsync(15_000);

        expect(await within(header()).findByRole('link', { name: '1 alert firing' })).toBeInTheDocument();
        expect(fetchMachineAlerts).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
        vi.restoreAllMocks();
      }
    });
  });

  describe('a Siemens control', () => {
    it('shows a Viewer the changed certificate and the security warning above the tabs, with no button', () => {
      const machine = testMachine({
        type: 'siemens', opcuaPort: 4840, opcuaSecurity: 'none', opcuaUser: 'OpcUaClient', connected: false,
        opcuaCertificateChanged: { presentedThumbprint: 'ab'.repeat(32), presentedSha1Thumbprint: 'cd'.repeat(20) },
        opcuaSecurityWarning: 'Security is None.',
      } as never);
      renderPage({ role: 'viewer', machine });

      const banner = screen.getByRole('alert', { name: 'Certificate changed' });
      expect(within(banner).getByText('AB:'.repeat(32).slice(0, -1))).toBeInTheDocument();
      expect(within(banner).queryByRole('button')).not.toBeInTheDocument();
      expect(screen.getByRole('status', { name: 'Security warning' })).toHaveTextContent('Security is None.');
      const tablist = screen.getByRole('tablist', { name: 'Machine sections' });
      expect(banner.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});
