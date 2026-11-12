import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY_MESSAGE_MS, CommandLine } from './CommandLine';

const COMMAND = 'docker load -i images.tar';
const originalExecCommand = document.execCommand;

const clickCopy = () => act(async () => fireEvent.click(screen.getByRole('button', { name: `Copy ${COMMAND}` })));
const useClipboard = (writeText: () => Promise<void>) => vi.stubGlobal('navigator', { clipboard: { writeText } });
const useOldCopyCommand = (works: boolean) => {
  vi.stubGlobal('navigator', {});
  const execCommand = vi.fn().mockReturnValue(works);
  document.execCommand = execCommand;
  return execCommand;
};

describe('CommandLine', () => {
  beforeEach(() => {
    render(<CommandLine command={COMMAND} />);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.execCommand = originalExecCommand;
  });

  it('shows the command', () => {
    expect(screen.getByText(COMMAND)).toBeInTheDocument();
  });

  it('copies the command, and says so on the button and to screen readers', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    useClipboard(writeText);

    await clickCopy();

    expect(writeText).toHaveBeenCalledWith(COMMAND);
    expect(screen.getByText('Copied')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Copied to the clipboard');
  });

  it('still copies on a plain http page, where the browser has no clipboard API', async () => {
    const execCommand = useOldCopyCommand(true);

    await clickCopy();

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('tries the old copy command when the browser refuses the clipboard', async () => {
    const execCommand = useOldCopyCommand(true);
    useClipboard(vi.fn().mockRejectedValue(new Error('Not allowed')));

    await clickCopy();

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('says that the copy failed, and does not say Copied, when no way to copy works', async () => {
    useOldCopyCommand(false);

    await clickCopy();

    expect(screen.getByText('Copy failed')).toBeInTheDocument();
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Could not copy. Select the command and copy it.');
  });

  it('keeps the focus on the button after the old copy command', async () => {
    useOldCopyCommand(true);
    const button = screen.getByRole('button', { name: `Copy ${COMMAND}` });
    button.focus();

    await clickCopy();

    expect(button).toHaveFocus();
  });

  it('shows Copy again after a short time', async () => {
    vi.useFakeTimers();
    useClipboard(vi.fn().mockResolvedValue(undefined));

    await clickCopy();
    await act(async () => vi.advanceTimersByTime(COPY_MESSAGE_MS));

    expect(screen.getByText('Copy')).toBeInTheDocument();
  });
});
