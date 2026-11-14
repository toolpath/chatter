import { describe, expect, it } from 'vitest';
import { fanucAlarmCode } from './fanucAlarmCodes.js';

describe('fanucAlarmCode', () => {
  it('tells PS0401 from SV0401 on a 30i or a 0i, as the alarm screen does', () => {
    expect(fanucAlarmCode(401, 3, '31')).toBe('PS0401');
    expect(fanucAlarmCode(401, 6, '31')).toBe('SV0401');
    expect(fanucAlarmCode(401, 6, '0')).toBe('SV0401');
  });

  it('gives the letters of each alarm type', () => {
    expect(fanucAlarmCode(500, 4, '30')).toBe('OT0500');
    expect(fanucAlarmCode(1001, 15, '0')).toBe('EX1001');
    expect(fanucAlarmCode(1, 19, '0')).toBe('PC0001');
    expect(fanucAlarmCode(1, 9, '32')).toBe('SP0001');
  });

  it('gives a #3000 macro alarm its number, after MC', () => {
    // A 0i-M showed #3000=86 (PATH OBSTRUCTED) as alarm number 3086
    expect(fanucAlarmCode(3086, 8, '0')).toBe('MC3086');
  });

  it('gives the number alone for a type that is not known', () => {
    expect(fanucAlarmCode(401, 14, '31')).toBe('401');
    expect(fanucAlarmCode(401, 42, '31')).toBe('401');
    expect(fanucAlarmCode(401, undefined, '31')).toBe('401');
  });

  it('gives the number alone when the series is not known or has other alarm types (16i/18i/21i)', () => {
    expect(fanucAlarmCode(401, 6, undefined)).toBe('401');
    expect(fanucAlarmCode(401, 6, '16')).toBe('401');
    expect(fanucAlarmCode(100, 0, '18')).toBe('100');
  });
});
