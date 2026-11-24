import type { UpdateState, UpdateStatus } from '@local-chatter/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Dialog } from '@toolpath/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkUpdateFile,
  downloadUpdate,
  fetchUpdatesReport,
  installUpdate,
  saveUpdateSettings,
  uploadUpdateFile,
  type UpdatesReport,
} from '../../api/updates';
import { POLL_MS, UpdatesTab } from './UpdatesTab';

vi.mock('../../api/updates', () => ({
  fetchUpdatesReport: vi.fn(),
  uploadUpdateFile: vi.fn(),
  checkUpdateFile: vi.fn(),
  installUpdate: vi.fn(),
  downloadUpdate: vi.fn(),
  saveUpdateSettings: vi.fn(),
}));

// jsdom has no PointerEvent, and the Switch of the Toolpath UI package makes one on a click
globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent;

const MB = 1024 * 1024;

function report(changes: Partial<UpdatesReport> = {}): UpdatesReport {
  return {
    version: '1.2.0',
    canUpdate: true,
    helper: { arch: 'armv7' },
    status: null,
    freeBytes: 2048 * MB,
    isReceiving: false,
    hasUpdateFile: false,
    isRequestPending: false,
    newest: { checkGitHub: true, version: null, error: null, checkedAt: null, isNewer: false },
    downloadError: null,
    serverTime: new Date().toISOString(),
    ...changes,
  };
}

function renderUpdatesTab() {
  render(
    <Dialog.Provider>
      <UpdatesTab />
    </Dialog.Provider>,
  );
}

async function renderTab(loaded: UpdatesReport) {
  vi.mocked(fetchUpdatesReport).mockResolvedValue(loaded);
  renderUpdatesTab();
  await screen.findByText('Installed version');
}

const UPDATE_FILE = new File(['update'], 'chatter-update-1.3.0-armv7.tar');
const pickUpdateFile = () => fireEvent.change(screen.getByLabelText('Update file to upload'), { target: { files: [UPDATE_FILE] } });

describe('UpdatesTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows the installed version and the free space on the card', async () => {
    await renderTab(report());

    expect(screen.getByText('1.2.0')).toBeInTheDocument();
    expect(screen.getByText('2 GB')).toBeInTheDocument();
  });

  it('shows the manual steps for the Docker package, and no update buttons, on a normal computer', async () => {
    await renderTab(report({ helper: null, freeBytes: null }));

    expect(screen.getByText(/download the Docker package of the new version/i)).toBeInTheDocument();
    expect(screen.getByText('docker load -i images.tar')).toBeInTheDocument();
    expect(screen.getAllByText('docker compose up -d')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: /update|upload|install/i })).not.toBeInTheDocument();
  });

  it('says that the update keeps the data, and to back up first', async () => {
    await renderTab(report({ helper: null, freeBytes: null }));

    expect(screen.getByText('Your machines, users and history are kept.')).toBeInTheDocument();
    expect(screen.getByText(/back up your data first/i)).toBeInTheDocument();
  });

  it('links to the back-up steps in the docs', async () => {
    await renderTab(report({ helper: null, freeBytes: null }));

    const link = screen.getByRole('link', { name: 'Back up' });
    expect(link).toHaveAttribute('href', 'https://toolpath.github.io/chatter/guide/update#back-up');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('says to keep a copy of the alert rules too', async () => {
    await renderTab(report({ helper: null, freeBytes: null }));

    expect(screen.getAllByText('vmalert/rules.yml')).not.toHaveLength(0);
  });

  it('says to keep the .env file in the chatter folder, so the CHATTER_BIND_ADDRESS setting stays', async () => {
    await renderTab(report({ helper: null, freeBytes: null }));

    expect(screen.getByText('.env')).toBeInTheDocument();
    expect(screen.getByText(/Keep it in the/).textContent).toMatch(/Do you have a \.env file\? Keep it in the chatter folder\./);
  });

  it('also shows the commands for Chatter installed with only the docker-compose.yml file', async () => {
    await renderTab(report({ helper: null, freeBytes: null }));

    expect(screen.getByText('docker compose pull')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy docker compose pull' })).toBeInTheDocument();
  });

  it('says that a development build cannot update', async () => {
    await renderTab(report({ version: 'edge-1a2b3c4', canUpdate: false }));

    expect(screen.getByText('edge-1a2b3c4')).toBeInTheDocument();
    expect(screen.getByText('Development build: it cannot update from here')).toBeInTheDocument();
    // Only the helper log can be read: no update button
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Show the log']);
  });

  it('shows why the report did not load', async () => {
    vi.mocked(fetchUpdatesReport).mockRejectedValue(new Error('Could not load the updates'));
    renderUpdatesTab();

    expect(await screen.findByText('Could not load the updates')).toBeInTheDocument();
  });

  describe('upload', () => {
    it('uploads the update file and shows how much is sent', async () => {
      await renderTab(report());
      let finish!: (loaded: UpdatesReport) => void;
      vi.mocked(uploadUpdateFile).mockImplementation((_file, onProgress) => {
        onProgress(0.42);
        return new Promise(resolve => (finish = resolve));
      });

      pickUpdateFile();

      expect(uploadUpdateFile).toHaveBeenCalledWith(UPDATE_FILE, expect.any(Function));
      expect(await screen.findByText('Uploading… 42%')).toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: 'Upload' })).toHaveAttribute('value', '0.42');
      finish(report());
      expect(await screen.findByRole('button', { name: 'Upload update file' })).toBeEnabled();
    });

    it('shows why the upload failed', async () => {
      await renderTab(report());
      vi.mocked(uploadUpdateFile).mockRejectedValue(new Error('Not enough free space'));

      pickUpdateFile();

      expect(await screen.findByText('Not enough free space')).toBeInTheDocument();
    });

    it('allows no upload while another update file comes in', async () => {
      await renderTab(report({ isReceiving: true }));

      expect(screen.getByRole('button', { name: 'Upload update file' })).toBeDisabled();
    });
  });

  describe('check and install', () => {
    const status = (state: UpdateState, changes: Partial<UpdateStatus> = {}): UpdateStatus => ({
      state, version: '1.3.0', heartbeat: new Date().toISOString(), freeBytes: 1024 * MB, ...changes,
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('asks the helper to check the update file', async () => {
      await renderTab(report({ hasUpdateFile: true }));
      vi.mocked(checkUpdateFile).mockResolvedValue(report({ isRequestPending: true }));

      fireEvent.click(screen.getByRole('button', { name: 'Check the update file' }));

      expect(checkUpdateFile).toHaveBeenCalled();
      expect(await screen.findByText('Waiting for the update helper…')).toBeInTheDocument();
    });

    it('shows no check button without an update file', async () => {
      await renderTab(report());
      expect(screen.queryByRole('button', { name: 'Check the update file' })).not.toBeInTheDocument();
    });

    it('installs a file that passed the check, after you confirm', async () => {
      await renderTab(report({ status: status('ready') }));
      vi.mocked(installUpdate).mockResolvedValue(report({ status: status('installing') }));
      expect(screen.getByText('Version 1.3.0 passed the check')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Install version 1.3.0' }));
      expect(await screen.findByText('Chatter stops for some minutes. Machine data is not saved during that time. File transfers stop.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Install' }));

      expect(await screen.findByText('Installing version 1.3.0…')).toBeInTheDocument();
      expect(installUpdate).toHaveBeenCalled();
    });

    it('offers no install of the old file when a new update file came in, and asks for a check', async () => {
      await renderTab(report({ status: status('ready'), hasUpdateFile: true }));

      expect(screen.queryByRole('button', { name: 'Install version 1.3.0' })).not.toBeInTheDocument();
      expect(screen.getByText('A new update file needs a check')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Check the update file' })).toBeEnabled();
    });

    it('installs nothing when you do not confirm', async () => {
      await renderTab(report({ status: status('ready') }));

      fireEvent.click(screen.getByRole('button', { name: 'Install version 1.3.0' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

      await act(() => Promise.resolve());
      expect(installUpdate).not.toHaveBeenCalled();
    });

    it('asks for the status each few seconds while it installs, also while Chatter restarts', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      await renderTab(report({ status: status('installing') }));
      vi.mocked(fetchUpdatesReport)
        .mockRejectedValueOnce(new Error('Chatter is not there'))
        .mockResolvedValueOnce(report({ version: '1.3.0', status: status('done', { freedBytes: 300 * MB }) }));

      await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
      expect(screen.getByText(/^Chatter restarts…/)).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS));

      expect(screen.getByText('Version 1.3.0 is installed')).toBeInTheDocument();
      expect(screen.getByText('The update gave back 300 MB of space.')).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
      expect(fetchUpdatesReport).toHaveBeenCalledTimes(3);
    });

    it.each([
      ['refused', 'The update file did not pass the check'],
      ['failed', 'The update failed. The old version runs, and nothing changed.'],
      ['rolled-back', 'The new version did not start, so the old version and its data came back'],
    ] as const)('shows the result %s with its reason', async (state, title) => {
      await renderTab(report({ status: status(state, { reason: 'The signature is wrong.' }) }));

      expect(screen.getByText(title)).toBeInTheDocument();
      expect(screen.getByText('The signature is wrong.')).toBeInTheDocument();
    });
  });

  describe('progress of a check or an install', () => {
    /** The time of the browser. The clock of the Pi is 1 hour later, so a test fails if the page uses the browser clock. */
    const BROWSER_NOW = Date.parse('2026-11-10T12:00:00.000Z');
    const PI_CLOCK_AHEAD_MS = 60 * 60_000;
    /** A time of the Pi clock, some seconds before the current time of the test */
    const piTime = (secondsAgo = 0) => new Date(Date.now() + PI_CLOCK_AHEAD_MS - secondsAgo * 1000).toISOString();

    const busyReport = (state: UpdateState, changes: Partial<UpdateStatus> = {}) => report({
      serverTime: piTime(),
      status: { state, version: '1.3.0', heartbeat: piTime(5), freeBytes: 1024 * MB, ...changes },
    });

    /** Renders the page. The clock stays still until the test lets time go by. */
    async function renderAt(loaded: UpdatesReport) {
      vi.mocked(fetchUpdatesReport).mockImplementation(async () => loaded);
      renderUpdatesTab();
      await act(() => vi.advanceTimersByTimeAsync(0));
    }

    /** Lets time go by. The server answers each poll with a new report from `next`. */
    async function wait(ms: number, next?: () => UpdatesReport) {
      if (next) vi.mocked(fetchUpdatesReport).mockImplementation(async () => next());
      await act(() => vi.advanceTimersByTimeAsync(ms));
    }

    /**
     * Stops the clock before each test makes its reports. With the real clock, the clock can move
     * between piTime() for serverTime and piTime(5) for heartbeat, and the page then shows "4 s ago".
     */
    beforeEach(() => {
      vi.useFakeTimers({ now: BROWSER_NOW });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('tells the step, the start, and the last sign of life of the helper, with the clock of the Pi', async () => {
      await renderAt(busyReport('installing', { step: 'loading', part: 2, parts: 3, startedAt: piTime(3 * 60) }));

      expect(screen.getByText('Installing version 1.3.0…')).toBeInTheDocument();
      expect(screen.getByText('Now: the helper loads image 2 of 3.')).toBeInTheDocument();
      expect(screen.getByText('Started 3 min ago.')).toBeInTheDocument();
      expect(screen.getByText('Last sign of life: 5 s ago.')).toBeInTheDocument();
      expect(screen.getByText('On a Pi, an install can take up to about 10 minutes.')).toBeInTheDocument();
    });

    it('counts on between the polls', async () => {
      const loaded = busyReport('checking', { step: 'files', startedAt: piTime(59) });
      await renderAt(loaded);
      expect(screen.getByText('Started less than 1 min ago.')).toBeInTheDocument();
      expect(screen.getByText('Now: the helper unpacks the files and examines their checksums.')).toBeInTheDocument();
      expect(screen.getByText('On a Pi, a check can take up to about 10 minutes.')).toBeInTheDocument();

      await wait(2000, () => loaded);

      expect(screen.getByText('Started 1 min ago.')).toBeInTheDocument();
      expect(screen.getByText('Last sign of life: 7 s ago.')).toBeInTheDocument();
    });

    it('counts from the first status that the page saw when the helper gives no start time (an old card)', async () => {
      await renderAt(busyReport('checking'));
      expect(screen.getByText('Started less than 1 min ago.')).toBeInTheDocument();
      expect(screen.queryByText(/^Now:/)).not.toBeInTheDocument();

      await wait(2 * 60_000, () => busyReport('checking'));

      expect(screen.getByText('Started 2 min ago.')).toBeInTheDocument();
      expect(screen.getByText('Last sign of life: 5 s ago.')).toBeInTheDocument();
    });

    it('says that Chatter restarts while it does not answer during an install, then shows the result', async () => {
      await renderAt(busyReport('installing', { step: 'backing-up', startedAt: piTime(60) }));

      await wait(POLL_MS, () => {
        throw new Error('Chatter is not there');
      });
      expect(screen.getByText('Chatter restarts… 1 min')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      await wait(4 * 60_000);
      expect(screen.getByText('Chatter restarts… 5 min')).toBeInTheDocument();

      await wait(POLL_MS, () => report({ version: '1.3.0', status: { state: 'done', version: '1.3.0', heartbeat: piTime(), freeBytes: 0 } }));
      expect(screen.getByText('Version 1.3.0 is installed')).toBeInTheDocument();
    });

    it('tells what to do when Chatter does not come back in 20 minutes', async () => {
      await renderAt(busyReport('installing'));

      await wait(POLL_MS, () => {
        throw new Error('Chatter is not there');
      });
      expect(screen.queryByText('Chatter did not come back in 20 minutes')).not.toBeInTheDocument();
      await wait(20 * 60_000);

      expect(screen.getByText('Chatter did not come back in 20 minutes')).toBeInTheDocument();
      expect(screen.getByText('journalctl -u chatter-update')).toBeInTheDocument();
    });

    it('shows no restart message when Chatter does not answer during a check', async () => {
      await renderAt(busyReport('checking'));

      await wait(POLL_MS, () => {
        throw new Error('no network');
      });

      expect(screen.queryByText(/^Chatter restarts/)).not.toBeInTheDocument();
      expect(screen.getByText('Checking the update file…')).toBeInTheDocument();
    });
  });

  describe('the newest release on GitHub', () => {
    const NEWER = { checkGitHub: true, version: '1.3.0', error: null, checkedAt: new Date().toISOString(), isNewer: true };

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows the newest version, and downloads it', async () => {
      await renderTab(report({ newest: NEWER }));
      vi.mocked(downloadUpdate).mockResolvedValue(report({ newest: NEWER, isReceiving: true }));
      expect(screen.getByText('1.3.0 is available')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Download version 1.3.0' }));

      expect(downloadUpdate).toHaveBeenCalled();
      expect(await screen.findByText('An update file is coming in…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Upload update file' })).toBeDisabled();
    });

    it('asks for the status each few seconds while it downloads', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      await renderTab(report({ newest: NEWER, isReceiving: true }));
      vi.mocked(fetchUpdatesReport).mockResolvedValue(report({ newest: NEWER, hasUpdateFile: true }));

      await act(() => vi.advanceTimersByTimeAsync(POLL_MS));

      expect(screen.getByRole('button', { name: 'Check the update file' })).toBeInTheDocument();
    });

    it('shows why a download failed', async () => {
      await renderTab(report({ newest: NEWER, downloadError: 'The download failed: GitHub replied with HTTP 404' }));
      expect(screen.getByText('The download failed: GitHub replied with HTTP 404')).toBeInTheDocument();
    });

    it('offers no download when this Chatter is the newest', async () => {
      await renderTab(report({ newest: { ...NEWER, version: '1.2.0', isNewer: false } }));

      expect(screen.getByText('You have the newest version')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();
    });

    it('shows why the check failed', async () => {
      await renderTab(report({ newest: { ...NEWER, version: null, isNewer: false, error: 'Could not check: no internet' } }));
      expect(screen.getByText('Could not check: no internet')).toBeInTheDocument();
    });

    it('turns the check on GitHub off', async () => {
      await renderTab(report({ newest: NEWER }));
      const off = { checkGitHub: false, version: null, error: null, checkedAt: null, isNewer: false };
      vi.mocked(saveUpdateSettings).mockResolvedValue(report({ newest: off }));
      const toggle = screen.getByRole('switch', { name: 'Check for updates on GitHub' });
      expect(toggle).toBeChecked();

      fireEvent.click(toggle);

      expect(saveUpdateSettings).toHaveBeenCalledWith({ checkGitHub: false });
      expect(await screen.findByText('The check is off')).toBeInTheDocument();
    });
  });
});
