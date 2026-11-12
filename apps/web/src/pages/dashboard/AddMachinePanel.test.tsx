import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFocasStatus, type FocasLibraryStatus } from '../../api/focasLibrary';
import { AddMachinePanel, NO_FANUC_HERE } from './AddMachinePanel';

vi.mock('../../api/focasLibrary', () => ({
  fetchFocasStatus: vi.fn(),
  uploadFocasLibrary: vi.fn(),
  removeFocasLibrary: vi.fn(),
}));

const CAN_READ_FANUC: FocasLibraryStatus = {
  fileName: 'libfwlib32-linux-x64.so.1.0.5', problem: null, source: null, sha256: null, restartNeeded: false,
};
const CANNOT_READ_FANUC: FocasLibraryStatus = {
  ...CAN_READ_FANUC, fileName: null, problem: 'FOCAS is not available on macOS.',
};

const renderPanel = () => render(<AddMachinePanel onAdd={vi.fn()} onClose={vi.fn()} />);
/** Lets the FANUC status arrive before the test looks at the form */
const renderPanelWithStatus = () => act(async () => { renderPanel(); });
const fanucOption = () => screen.getByRole<HTMLOptionElement>('option', { name: 'FANUC CNC' });

describe('AddMachinePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('grays out FANUC, and tells why on hover, when this computer cannot run the FANUC library', async () => {
    vi.mocked(fetchFocasStatus).mockResolvedValue(CANNOT_READ_FANUC);
    await renderPanelWithStatus();

    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent(NO_FANUC_HERE);
    expect(fanucOption()).toBeDisabled();
    expect(fanucOption()).toHaveAttribute('title', NO_FANUC_HERE);
    expect(screen.getByRole('button', { name: 'Why FANUC is gray' })).toBeInTheDocument();
  });

  it('lets you pick FANUC when this computer can run the FANUC library', async () => {
    vi.mocked(fetchFocasStatus).mockResolvedValue(CAN_READ_FANUC);
    await renderPanelWithStatus();

    expect(fanucOption()).toBeEnabled();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('lets you pick FANUC when Chatter cannot load the FANUC status', async () => {
    vi.mocked(fetchFocasStatus).mockRejectedValue(new Error('Could not load the FANUC library status'));
    await renderPanelWithStatus();

    expect(fanucOption()).toBeEnabled();
  });

  it('goes back to the first machine type when FANUC turns gray after the user picked it', async () => {
    let answer: (status: FocasLibraryStatus) => void = () => {};
    vi.mocked(fetchFocasStatus).mockReturnValue(new Promise(resolve => { answer = resolve; }));
    renderPanel();
    fireEvent.change(screen.getByLabelText('Machine type'), { target: { value: 'fanuc' } });

    await act(async () => answer(CANNOT_READ_FANUC));

    expect(screen.getByLabelText('Machine type')).toHaveValue('brother');
  });

  it('closes with the X button', async () => {
    vi.mocked(fetchFocasStatus).mockResolvedValue(CAN_READ_FANUC);
    const onClose = vi.fn();
    await act(async () => {
      render(<AddMachinePanel onAdd={vi.fn()} onClose={onClose} />);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
