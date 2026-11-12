import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scanRange } from '../../api/discovery';
import { fetchFocasStatus } from '../../api/focasLibrary';
import { CurrentUserContext } from '../../components/CurrentUser';
import { DashboardPage } from './DashboardPage';

vi.mock('../../api/discovery', () => ({
  fetchRangeGuesses: vi.fn().mockResolvedValue([]),
  scanRange: vi.fn(),
}));
vi.mock('../../api/focasLibrary', () => ({
  fetchFocasStatus: vi.fn(),
  uploadFocasLibrary: vi.fn(),
  removeFocasLibrary: vi.fn(),
}));

/** Renders the page, and lets the loads that it starts finish */
async function renderDashboard({ isLoaded = false } = {}) {
  const page = (
    <CurrentUserContext.Provider value={{ username: 'sam', role: 'admin' }}>
      <MemoryRouter>
        <DashboardPage machines={[]} isLive isLoaded={isLoaded} addMachine={vi.fn()} />
      </MemoryRouter>
    </CurrentUserContext.Provider>
  );
  await act(async () => {
    render(page);
  });
}

const click = (name: string) => act(async () => { fireEvent.click(screen.getByRole('button', { name })); });

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.mocked(fetchFocasStatus).mockResolvedValue({
      fileName: null, problem: null, source: null, sha256: null, restartNeeded: false,
    });
  });

  it('gives the search box the short hint Name, program or IP', async () => {
    await renderDashboard();

    expect(screen.getByPlaceholderText('Name, program or IP')).toBeInTheDocument();
  });

  it('opens the Add a machine form in a modal', async () => {
    await renderDashboard();

    await click('Add machine');

    expect(screen.getByRole('dialog', { name: 'Add a machine' })).toHaveAttribute('open');
    expect(screen.getByLabelText('Machine name')).toBeInTheDocument();
  });

  it('closes the modal with Cancel', async () => {
    await renderDashboard();
    await click('Add machine');

    await click('Cancel');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens Find machines in a modal, and closes it with the X button', async () => {
    await renderDashboard();

    await click('Find machines');
    expect(screen.getByRole('dialog', { name: 'Find machines on the network' })).toHaveAttribute('open');

    await click('Close');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens Find machines by itself on the first start, when there are no machines yet', async () => {
    await renderDashboard({ isLoaded: true });

    expect(screen.getByRole('dialog', { name: 'Find machines on the network' })).toHaveAttribute('open');
  });

  it('says that a scan can take up to 30 seconds while it runs', async () => {
    vi.mocked(scanRange).mockReturnValue(new Promise(() => {}));
    await renderDashboard();
    await click('Find machines');

    fireEvent.change(screen.getByLabelText('Address range'), { target: { value: '192.168.1' } });
    await click('Scan');

    expect(screen.getByText('Looking at 192.168.1.1 to 192.168.1.254. This can take up to 30 seconds.')).toBeInTheDocument();
  });
});
