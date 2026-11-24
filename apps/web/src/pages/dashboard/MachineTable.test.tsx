import { machineStatusFor } from '@local-chatter/shared';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { testMachine } from '../../test/testMachine';
import type { Machine } from '../../types';
import { MachineTable } from './MachineTable';

describe('MachineTable', () => {
  it('shows a machine that is connecting as Connecting, with no values and no error from a try that failed', () => {
    const machine = testMachine(
      { name: 'Speedio', connected: false, connecting: true, errors: ['Connection timeout'] },
      { program: 'O1234', spindleSpeed: 8000 },
    );
    render(<MemoryRouter><MachineTable machines={[machine]} now={Date.now()} /></MemoryRouter>);

    const row = screen.getByRole('row', { name: /Speedio/ });
    expect(within(row).getByText('Connecting')).toBeInTheDocument();
    expect(within(row).queryByText('O1234')).not.toBeInTheDocument();
    expect(within(row).queryByText('8,000')).not.toBeInTheDocument();
    expect(within(row).queryByText('Connection timeout')).not.toBeInTheDocument();
  });

  it('shows the type with the IP address to an Operator, and the type only to a Viewer, who gets no address (D4)', () => {
    const machine = testMachine({ name: 'Speedio' });
    const { unmount } = render(<MemoryRouter><MachineTable machines={[machine]} now={Date.now()} /></MemoryRouter>);
    expect(within(screen.getByRole('row', { name: /Speedio/ })).getByText('192.168.1.50')).toBeInTheDocument();
    unmount();

    render(<MemoryRouter><MachineTable machines={[machineStatusFor('viewer', machine) as Machine]} now={Date.now()} /></MemoryRouter>);
    const row = screen.getByRole('row', { name: /Speedio/ });
    expect(row).not.toHaveTextContent(/undefined|·/);
    expect(row).toHaveTextContent('Brother CNC');
  });
});
