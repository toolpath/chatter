import { describe, expect, it } from 'vitest';
import { testMachine } from '../../test/testMachine';
import { jobValuesOf } from './jobValues';

const labelsOf = (machine: Parameters<typeof jobValuesOf>[0]) => jobValuesOf(machine).map(item => item.label);

describe('jobValuesOf', () => {
  it('shows a dash for each value when the machine is offline', () => {
    const values = jobValuesOf(testMachine({ connected: false }, { program: 'O1234' }));
    expect(values.map(item => item.value)).toEqual(['—', '—', '—', '—', '—']);
  });

  it('shows a dash for each value while the machine is connecting, also when the network connection is open', () => {
    const values = jobValuesOf(testMachine({ connected: true, connecting: true }, { program: 'O1234' }));
    expect(values.map(item => item.value)).toEqual(['—', '—', '—', '—', '—']);
  });

  it('gives the job values with the part fraction', () => {
    const values = jobValuesOf(testMachine({}, { mode: 'MEM', program: 'O1234', partCount: 5, partGoal: 10, spindleSpeed: 8000, toolNumber: 3 }));
    expect(values).toEqual([
      { label: 'Mode', value: 'MEM' },
      { label: 'Program', value: 'O1234' },
      { label: 'Parts', value: '5 / 10', fraction: 0.5, chartValue: 'part-count' },
      { label: 'Spindle', value: '8,000 rpm', chartValue: 'spindle-speed' },
      { label: 'Tool', value: 'T3' },
    ]);
  });

  it('adds the spindle load after the spindle speed, with a bar that is full at 100%', () => {
    const values = jobValuesOf(testMachine({}, { spindleSpeed: 8000, spindleLoad: 37.4 }));
    expect(values).toContainEqual({ label: 'Spindle load', value: '37%', fraction: 0.374, chartValue: 'spindle-load' });
    expect(values.map(item => item.label).slice(3, 5)).toEqual(['Spindle', 'Spindle load']);

    const overload = jobValuesOf(testMachine({}, { spindleLoad: 130 }));
    expect(overload).toContainEqual({ label: 'Spindle load', value: '130%', fraction: 1, chartValue: 'spindle-load' });
  });

  it('leaves out the spindle load when the machine does not send it, because some machines cannot', () => {
    expect(labelsOf(testMachine({}, { spindleSpeed: 8000 }))).not.toContain('Spindle load');
  });

  it('adds "Execution" for MTConnect and the operator message for FANUC', () => {
    expect(labelsOf(testMachine({ type: 'mtconnect' } as never))).toContain('Execution');
    expect(labelsOf(testMachine({ type: 'fanuc' } as never, { operatorMessage: 'Check coolant' }))).toContain('Operator message');
  });

  it('adds the warning of a FANUC control, such as a low battery', () => {
    const machine = testMachine({ type: 'fanuc' } as never, { warning: 'Battery low' });
    expect(jobValuesOf(machine)).toContainEqual({ label: 'Warning', value: 'Battery low' });
    expect(labelsOf(testMachine({ type: 'fanuc' } as never))).not.toContain('Warning');
  });

  it('adds each macro variable by name, or by location', () => {
    const machine = testMachine({ macros: [{ location: 500, name: 'Offset' }, { location: 501 }] }, { Offset: 1.5 });
    expect(jobValuesOf(machine).slice(-2)).toEqual([
      { label: 'Offset', value: '1.5' },
      { label: 'Macro 501', value: '—' },
    ]);
  });

  it('adds the Siemens program state, tool name and feed override, and names R parameters', () => {
    const machine = testMachine(
      { type: 'siemens', macros: [{ location: 5 }, { location: 7, name: 'Stock' }] } as never,
      { programStatus: 'RUNNING', toolName: 'VF-6.0-UNI', feedOverride: 99.6, macro_5: 1.5, Stock: 12.5 },
    );
    expect(jobValuesOf(machine).slice(-5)).toEqual([
      { label: 'Program state', value: 'RUNNING' },
      { label: 'Tool name', value: 'VF-6.0-UNI' },
      { label: 'Feed override', value: '100%' },
      { label: 'R5', value: '1.5' },
      { label: 'Stock', value: '12.5' },
    ]);
  });

  it('leaves out the row of the value that the chart shows, so it is not on the page twice', () => {
    const machine = testMachine({}, { spindleSpeed: 8000, spindleLoad: 37, partCount: 5 });
    expect(labelsOf(machine)).toEqual(expect.arrayContaining(['Parts', 'Spindle', 'Spindle load']));
    expect(jobValuesOf(machine, 'spindle-speed').map(item => item.label)).not.toContain('Spindle');
    expect(jobValuesOf(machine, 'spindle-load').map(item => item.label)).toEqual(expect.arrayContaining(['Spindle', 'Parts']));
    expect(jobValuesOf(machine, 'spindle-load').map(item => item.label)).not.toContain('Spindle load');
    expect(jobValuesOf(machine, 'part-count').map(item => item.label)).not.toContain('Parts');
  });

  it('also leaves out the chart value when the machine is offline', () => {
    expect(jobValuesOf(testMachine({ connected: false }), 'spindle-speed').map(item => item.label)).toEqual(['Mode', 'Program', 'Parts', 'Tool']);
  });
});
