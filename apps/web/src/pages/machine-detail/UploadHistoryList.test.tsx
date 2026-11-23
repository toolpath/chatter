import type { Role } from '@local-chatter/shared';
import { Dialog } from '@toolpath/ui';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUploadEvent } from '../../api/machineFiles';
import { CurrentUserContext } from '../../components/CurrentUser';
import type { UploadEvent, UploadFile } from '../../types';
import { UploadHistoryList } from './UploadHistoryList';
import type { UploadHistory } from './useUploadHistory';
import type { UploadMessages } from './useUploadMessages';

vi.mock('../../api/machineFiles', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/machineFiles')>()),
  fetchUploadEvent: vi.fn(),
  sendUploadAgain: vi.fn(),
}));

const FILE: UploadFile = {
  id: 7, file_name: 'O2000.nc', created_at: '2026-11-19T09:00:00.000Z', updated_at: '2026-11-19T10:00:00.000Z', event_count: 1, last_path: '/',
};

function sendOf(fields: Partial<UploadEvent>): UploadEvent {
  return { id: 21, uploaded_at: '2026-11-19T10:00:00.000Z', remote_path: '/', target_name: null, action: 'sent', ...fields };
}

function historyWith(events: UploadEvent[]): UploadHistory {
  return {
    historyFiles: [FILE], loading: false, failed: false, selectedFileId: FILE.id, selectedEvents: events,
    select: vi.fn(), loadEvents: vi.fn(), refreshAll: vi.fn(),
  } as unknown as UploadHistory;
}

const MESSAGES = { setError: vi.fn(), setSuccess: vi.fn() } as unknown as UploadMessages;

/** The list of the versions of O2000.nc, as the user with this role sees it */
function renderVersions(role: Role, events: UploadEvent[]) {
  render(
    <CurrentUserContext.Provider value={{ username: 'sam', role }}>
      <Dialog.Provider>
        <UploadHistoryList machineId="m1" machineName="Mill 1" history={historyWith(events)} messages={MESSAGES} onUploaded={vi.fn()} />
      </Dialog.Provider>
    </CurrentUserContext.Provider>,
  );
  return screen.getByRole('list', { name: 'Versions of O2000.nc' });
}

describe('UploadHistoryList: who sent each version', () => {
  beforeEach(() => {
    vi.mocked(fetchUploadEvent).mockReset().mockReturnValue(new Promise(() => {}));
  });

  it('shows the user and the address of each send to an admin', () => {
    const versions = renderVersions('admin', [
      sendOf({ id: 22, uploaded_by: 'alice', address: '192.168.1.20' }),
      sendOf({ id: 21, uploaded_by: 'bob', address: '192.168.1.31' }),
    ]);
    const [newest, older] = within(versions).getAllByRole('listitem');
    expect(within(newest).getByText('Sent by alice from 192.168.1.20')).toBeInTheDocument();
    expect(within(older).getByText('Sent by bob from 192.168.1.31')).toBeInTheDocument();
  });

  it('shows the user, but not the address, to an operator', () => {
    // The server does not send the address to an operator. The screen also hides it if it comes.
    const versions = renderVersions('operator', [sendOf({ uploaded_by: 'alice', address: '192.168.1.20' })]);
    expect(within(versions).getByText('Sent by alice')).toBeInTheDocument();
    expect(within(versions).queryByText(/192\.168\.1\.20/)).not.toBeInTheDocument();
  });

  it('shows nothing about who sent a version to a viewer', () => {
    // The server does not send the user to a viewer. The screen also hides it if it comes.
    const versions = renderVersions('viewer', [
      sendOf({ id: 22, uploaded_by: 'alice', address: '192.168.1.20' }),
      sendOf({ id: 21 }),
    ]);
    expect(within(versions).getAllByRole('listitem')).toHaveLength(2);
    expect(within(versions).queryByText(/Sent by|alice|unknown|192\.168/)).not.toBeInTheDocument();
  });

  it.each<Role>(['admin', 'operator'])('tells an %s that the user of a send from an older version is unknown', role => {
    const versions = renderVersions(role, [
      sendOf({ id: 22, uploaded_by: 'alice', address: '192.168.1.20' }),
      sendOf({ id: 21, uploaded_by: null, address: null }),
    ]);
    const older = within(versions).getAllByRole('listitem')[1];
    expect(within(older).getByText('Sent by an unknown user')).toBeInTheDocument();
    expect(within(older).queryByText(/ from /)).not.toBeInTheDocument();
  });

  it('wraps a long username in the list, and keeps all of it', () => {
    const longName = 'a'.repeat(120);
    const versions = renderVersions('operator', [sendOf({ uploaded_by: longName })]);
    const who = within(versions).getByText(`Sent by ${longName}`);
    // A name with no space must break anywhere, or it pushes the text of the version out of the box
    expect(who).toHaveClass('[overflow-wrap:anywhere]');
  });

  it('shows a username with HTML characters as text', () => {
    const name = '<img src=x onerror=alert(1)>&amp;';
    const versions = renderVersions('admin', [sendOf({ uploaded_by: name, address: '10.0.0.5' })]);
    expect(within(versions).getByText(`Sent by ${name} from 10.0.0.5`)).toBeInTheDocument();
    expect(versions.querySelector('img')).toBeNull();
  });
});
