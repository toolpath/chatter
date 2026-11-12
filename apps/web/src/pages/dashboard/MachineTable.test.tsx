import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { testMachine } from '../../test/testMachine';
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
});
