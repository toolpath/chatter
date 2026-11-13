import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api/client';
import { AppShell } from './components/layout/AppShell';
import { useMachineEvents } from './hooks/useMachineEvents';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import MachineDetailPage from './pages/machine-detail/MachineDetailPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import type { AddMachineRequest, Machine, MachineUpdate } from './types';

/** The error text of a failed call */
const messageOf = (err: unknown) => (err instanceof Error ? err.message : 'Unknown error');

function App() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Live machine status from the server (SSE).
  // It also shows each add, change, and removal, so no call below loads the list again.
  const { isLive, isLoaded } = useMachineEvents(setMachines);

  /** Throws on an error, so the add form can show it */
  const addMachine = async (machine: AddMachineRequest) => {
    const response = await api.machines.$post({ json: machine });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Could not add the machine');
    }
  };

  /** True when the server saved the update. On an error, it shows the error and returns false. */
  const updateMachine = async (id: string, updates: MachineUpdate): Promise<boolean> => {
    try {
      const response = await api.machine[':id'].$put({ param: { id }, json: updates });
      if (!response.ok) {
        const data = await response.json();
        throw new Error('error' in data ? data.error : 'Could not save the machine settings');
      }
      return true;
    } catch (err) {
      setError(messageOf(err));
      return false;
    }
  };

  const removeMachine = async (id: string) => {
    try {
      const response = await api.machine[':id'].$delete({ param: { id } });
      if (!response.ok) throw new Error('Could not remove the machine');
      return true;
    } catch (err) {
      setError(messageOf(err));
      return false;
    }
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell machines={machines} error={error} onCloseError={() => setError(null)} />}>
          <Route path="/" element={<DashboardPage machines={machines} isLive={isLive} isLoaded={isLoaded} addMachine={addMachine} />} />
          <Route
            path="/machine/:id"
            element={<MachineDetailPage machines={machines} isLoaded={isLoaded} onRemove={removeMachine} onUpdate={updateMachine} />}
          />
          <Route path="/settings" element={<SettingsPage machines={machines} />} />
          {/* The old address of the password page */}
          <Route path="/account" element={<Navigate to="/settings" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
