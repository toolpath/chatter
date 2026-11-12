import koffi from 'koffi';
import { describe, expect, it } from 'vitest';
import { LOADELM, ODBSPLOAD, ODBST, toFocasStatus, toSpindleLoadPercent } from './focas.js';

describe('ODBST, the reply of cnc_statinfo', () => {
  // The layout of 0i, 16i/18i/21i, 30i/31i/32i and Power Mate i in fwlib32.h: 9 shorts.
  // (Series 15 has another layout. A wrong layout reads each field from the wrong place.)
  it('has the fields of the 0i and 30i controls at their places', () => {
    expect(koffi.sizeof(ODBST)).toBe(18);
    expect(koffi.offsetof(ODBST, 'aut')).toBe(4);
    expect(koffi.offsetof(ODBST, 'run')).toBe(6);
    expect(koffi.offsetof(ODBST, 'motion')).toBe(8);
    expect(koffi.offsetof(ODBST, 'mstb')).toBe(10);
    expect(koffi.offsetof(ODBST, 'emergency')).toBe(12);
    expect(koffi.offsetof(ODBST, 'alarm')).toBe(14);
    expect(koffi.offsetof(ODBST, 'edit')).toBe(16);
  });
});

describe('toFocasStatus', () => {
  const reply = { hdck: 0, tmmode: 0, aut: 1, run: 3, motion: 1, mstb: 0, emergency: 0, alarm: 0, edit: 0 };

  it('gives START while a program runs', () => {
    expect(toFocasStatus(reply).runState).toBe('START');
    expect(toFocasStatus({ ...reply, run: 2 }).runState).toBe('HOLD');
  });

  it('gives the mode names of the 0i and 30i controls, where 2 is not used and 3 is EDIT', () => {
    expect(toFocasStatus(reply).mode).toBe('MEMORY');
    expect(toFocasStatus({ ...reply, aut: 3 }).mode).toBe('EDIT');
    expect(toFocasStatus({ ...reply, aut: 5 }).mode).toBe('JOG');
    expect(toFocasStatus({ ...reply, aut: 10 }).mode).toBe('REMOTE');
    expect(toFocasStatus({ ...reply, aut: 2 }).mode).toBe('UNKNOWN_2');
  });

  it('gives the emergency stop and the alarm from their own fields', () => {
    expect(toFocasStatus({ ...reply, emergency: 1 }).emergency).toBe(true);
    expect(toFocasStatus({ ...reply, alarm: 1 }).alarm).toBe(true);
    expect(toFocasStatus(reply)).toMatchObject({ emergency: false, alarm: false });
  });
});

describe('ODBSPLOAD, the reply of cnc_rdspmeter', () => {
  // fwlib32.h: LOADELM { long data; short dec; short unit; char name, suff1, suff2, reserve }.
  // Chatter reads a long as 32 bits, the same as for cnc_acts.
  it('has the load meter first and the speed meter after it, 12 bytes each', () => {
    expect(koffi.sizeof(LOADELM)).toBe(12);
    expect(koffi.offsetof(LOADELM, 'dec')).toBe(4);
    expect(koffi.offsetof(LOADELM, 'unit')).toBe(6);
    expect(koffi.offsetof(LOADELM, 'name')).toBe(8);
    expect(koffi.sizeof(ODBSPLOAD)).toBe(24);
    expect(koffi.offsetof(ODBSPLOAD, 'spspeed')).toBe(12);
  });
});

describe('toSpindleLoadPercent', () => {
  const meter = (data: number, dec: number, unit = 0) => ({
    spload: { data, dec, unit, name: 83, suff1: 49, suff2: 0, reserve: 0 },
    spspeed: { data: 0, dec: 0, unit: 2, name: 83, suff1: 49, suff2: 0, reserve: 0 },
  });

  it('gives the load in percent from the number and its decimal places', () => {
    expect(toSpindleLoadPercent(1, meter(375, 1))).toBe(37.5);
    expect(toSpindleLoadPercent(1, meter(0, 0))).toBe(0);
  });

  it('gives no load when the control read no spindle, for example an analog spindle', () => {
    expect(toSpindleLoadPercent(0, meter(375, 1))).toBeUndefined();
  });

  it('gives no load when the unit is not percent', () => {
    expect(toSpindleLoadPercent(1, meter(375, 1, 1))).toBeUndefined();
  });
});
