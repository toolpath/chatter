import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFocasStatus, removeFocasLibrary, uploadFocasLibrary, type FocasLibraryStatus } from '../../api/focasLibrary';
import { FocasLibrary } from './FocasLibrary';

vi.mock('../../api/focasLibrary', () => ({
  fetchFocasStatus: vi.fn(),
  uploadFocasLibrary: vi.fn(),
  removeFocasLibrary: vi.fn(),
}));

const FILE_NAME = 'libfwlib32-linux-x64.so.1.0.5';
const NONE: FocasLibraryStatus = { fileName: FILE_NAME, problem: null, source: null, sha256: null, restartNeeded: false };
const UPLOADED: FocasLibraryStatus = { ...NONE, source: 'uploaded', sha256: 'ab12' };

function chooseFile() {
  const file = new File(['library'], FILE_NAME);
  fireEvent.change(screen.getByLabelText('FANUC library file'), { target: { files: [file] } });
  return file;
}

describe('FocasLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchFocasStatus).mockResolvedValue(NONE);
  });

  it('names the file that this computer needs, and warns before the upload', async () => {
    render(<FocasLibrary />);

    expect(await screen.findByText(FILE_NAME)).toBeInTheDocument();
    expect(screen.getByText(/Chatter runs the code in this file/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload the file' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove the file' })).toBeNull();
  });

  it('uploads the chosen file, and shows its fingerprint', async () => {
    vi.mocked(uploadFocasLibrary).mockResolvedValue(UPLOADED);
    render(<FocasLibrary />);
    await screen.findByText(FILE_NAME);

    const file = chooseFile();

    expect(await screen.findByText(`Chatter has the FANUC library ${FILE_NAME}`)).toBeInTheDocument();
    expect(screen.getByText('ab12')).toBeInTheDocument();
    expect(uploadFocasLibrary).toHaveBeenCalledWith(file);
  });

  it('shows the reason of the server when it refuses the file', async () => {
    vi.mocked(uploadFocasLibrary).mockRejectedValue(new Error(`This is a Linux library for 32-bit ARM. This computer needs ${FILE_NAME}.`));
    render(<FocasLibrary />);
    await screen.findByText(FILE_NAME);

    chooseFile();

    expect(await screen.findByText(/library for 32-bit ARM/)).toBeInTheDocument();
  });

  it('removes an uploaded file, and asks for a restart when the server says so', async () => {
    vi.mocked(fetchFocasStatus).mockResolvedValue(UPLOADED);
    vi.mocked(removeFocasLibrary).mockResolvedValue({ ...NONE, restartNeeded: true });
    render(<FocasLibrary />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove the file' }));

    expect(await screen.findByText('Restart Chatter to use this change')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload the file' })).toBeInTheDocument();
  });

  it('explains why a computer cannot read FANUC machines, with no upload', async () => {
    vi.mocked(fetchFocasStatus).mockResolvedValue({ ...NONE, fileName: null, problem: 'FANUC FOCAS on ARM is 32-bit only.' });
    render(<FocasLibrary />);

    expect(await screen.findByText('FANUC FOCAS on ARM is 32-bit only.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
