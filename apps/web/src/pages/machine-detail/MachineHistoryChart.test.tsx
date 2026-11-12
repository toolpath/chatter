import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchValueHistory } from '../../api/history';
import { testMachine } from '../../test/testMachine';
import type { Machine } from '../../types';
import { chartValuesFor, shownChartValue, SPINDLE_SPEED } from './chartValues';
import MachineHistoryChart from './MachineHistoryChart';

/** The chart with the menu state that the machine page keeps */
function ChartWithMenu({ machine }: { machine: Machine }) {
  const [chosen, setChosen] = useState(SPINDLE_SPEED.id);
  const values = chartValuesFor(machine);
  return <MachineHistoryChart machine={machine} values={values} value={shownChartValue(values, chosen)} onChoose={setChosen} />;
}

vi.mock('../../api/history', () => ({ fetchValueHistory: vi.fn() }));

describe('MachineHistoryChart', () => {
  beforeEach(() => {
    vi.mocked(fetchValueHistory).mockReset().mockResolvedValue({ points: [], window: '5s' });
  });

  it('shows the spindle speed as a plain title when the machine sends no other value', () => {
    render(<ChartWithMenu machine={testMachine({}, { spindleSpeed: 1200 })} />);

    expect(screen.queryByRole('button', { name: /Value in the chart/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Spindle speed/ })).toBeInTheDocument();
  });

  it('loads the history of the value that the user picks', async () => {
    render(<ChartWithMenu machine={testMachine({}, { spindleSpeed: 1200, spindleLoad: 30 })} />);
    expect(fetchValueHistory).toHaveBeenCalledWith('m1', 'spindle-speed', '-10m', '5s');

    const valueButton = screen.getByRole('button', { name: 'Value in the chart: Spindle speed' });
    // The menu trigger is the button itself, not a second button around it
    expect(valueButton.parentElement?.closest('[role=button], button')).toBeNull();
    fireEvent.click(valueButton);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Spindle load' }));

    await waitFor(() => expect(fetchValueHistory).toHaveBeenCalledWith('m1', 'spindle-load', '-10m', '5s'));
    expect(screen.getByText('How hard the spindle worked in the last 10 minutes.')).toBeInTheDocument();
  });
});
