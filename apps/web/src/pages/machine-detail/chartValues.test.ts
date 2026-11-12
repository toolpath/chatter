import { describe, expect, it } from 'vitest';
import { testMachine } from '../../test/testMachine';
import { chartValuesFor } from './chartValues';

const idsFor = (data: Parameters<typeof testMachine>[1]) => chartValuesFor(testMachine({}, data)).map(value => value.id);

describe('chartValuesFor', () => {
  it('offers only the spindle speed when the machine sends nothing else', () => {
    expect(idsFor({ spindleSpeed: 1200 })).toEqual(['spindle-speed']);
  });

  it('offers the spindle load and the part count when the machine sends them', () => {
    expect(idsFor({ spindleSpeed: 1200, spindleLoad: 30, partCount: 7 })).toEqual(['spindle-speed', 'spindle-load', 'part-count']);
  });
});

describe('chart value formats', () => {
  it('gives each value its unit', () => {
    const [speed, load, parts] = chartValuesFor(testMachine({}, { spindleLoad: 30, partCount: 7 }));
    expect(speed.format(8000.4)).toBe('8,000 RPM');
    expect(load.format(32.6)).toBe('33%');
    expect(parts.format(48)).toBe('48 parts');
  });
});
