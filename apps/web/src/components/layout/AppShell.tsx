import { Dialog } from '@toolpath/ui';
import { Outlet } from 'react-router-dom';
import type { Machine } from '../../types';
import { Notice } from '../ui/Notice';
import { Sidebar } from './Sidebar';

interface AppShellProps {
  machines: Machine[];
  /** An error from the last action, shown on every page until it is closed */
  error: string | null;
  onCloseError: () => void;
}

/** The side menu and the page next to it */
export function AppShell({ machines, error, onCloseError }: AppShellProps) {
  return (
    <Dialog.Provider>
      <div className="flex min-h-screen flex-col md:flex-row">
        <Sidebar machines={machines} />
        <main className="flex min-w-0 flex-1 flex-col gap-5 px-4 pt-6 pb-10 md:px-8">
          {error && (
            <Notice tone="error" title="That did not work" onClose={onCloseError}>
              {error}
            </Notice>
          )}
          <Outlet />
        </main>
      </div>
    </Dialog.Provider>
  );
}
