import koffi from 'koffi';
import { describe, expect, it } from 'vitest';
import { LOADELM, ODBACT, ODBALMMSG_DATA, ODBEXEPRG, ODBM, ODBSPLOAD, ODBST, ODBSYS, toFocasStatus, toSpindleLoadPercent, toSystemInfo } from './focas.js';

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
    expect(toFocasStatus(reply)).toMatchObject({ emergency: false, alarm: false, emergencyStatus: 0, alarmStatus: 0 });
    expect(toFocasStatus(reply).warning).toBeUndefined();
    expect(toFocasStatus({ ...reply, alarm: 1 }).warning).toBeUndefined();
  });

  it('does not take RESET (2) or WAIT (3) of ODBST.emergency for an emergency stop, and keeps the code', () => {
    expect(toFocasStatus({ ...reply, emergency: 2 })).toMatchObject({ emergency: false, emergencyStatus: 2 });
    expect(toFocasStatus({ ...reply, emergency: 3 })).toMatchObject({ emergency: false, emergencyStatus: 3 });
  });

  it('gives a warning, not an alarm, for the ODBST.alarm codes above ALM', () => {
    expect(toFocasStatus({ ...reply, alarm: 2 })).toMatchObject({ alarm: false, alarmStatus: 2, warning: 'Battery low' });
    expect(toFocasStatus({ ...reply, alarm: 3 })).toMatchObject({ alarm: false, alarmStatus: 3, warning: 'Fan' });
    expect(toFocasStatus({ ...reply, alarm: 8 })).toMatchObject({ alarm: false, warning: 'PMC alarm' });
    expect(toFocasStatus({ ...reply, alarm: 12 })).toMatchObject({ alarm: false, warning: 'Warning (status 12)' });
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

describe('the FOCAS long, 32 bits on every platform', () => {
  // The offsets that libfwlib32-linux-x64.so.1.0.5 writes to (see the comment above the structures in focas.ts).
  // koffi's own "long" would be 8 bytes on 64-bit Linux, and would move every field after it.
  it('puts ODBACT.data at offset 4, as cnc_acts writes it', () => {
    expect(koffi.offsetof(ODBACT, 'data')).toBe(4);
    expect(koffi.sizeof(ODBACT)).toBe(8);
  });

  it('puts ODBM.mcr_val at offset 4 and dec_val at offset 8, as cnc_rdmacro writes them', () => {
    expect(koffi.offsetof(ODBM, 'mcr_val')).toBe(4);
    expect(koffi.offsetof(ODBM, 'dec_val')).toBe(8);
  });

  it('puts ODBEXEPRG.o_num at offset 36, as cnc_exeprgname writes it', () => {
    expect(koffi.offsetof(ODBEXEPRG, 'o_num')).toBe(36);
  });

  it('gives each alarm of cnc_rdalmmsg 44 bytes', () => {
    expect(koffi.sizeof(ODBALMMSG_DATA)).toBe(44);
  });
});

describe('ODBSYS, the reply of cnc_sysinfo', () => {
  it('has the fields of every control but Series 15 at their places', () => {
    expect(koffi.sizeof(ODBSYS)).toBe(18);
    expect(koffi.offsetof(ODBSYS, 'cnc_type')).toBe(4);
    expect(koffi.offsetof(ODBSYS, 'mt_type')).toBe(6);
    expect(koffi.offsetof(ODBSYS, 'series')).toBe(8);
    expect(koffi.offsetof(ODBSYS, 'version')).toBe(12);
    expect(koffi.offsetof(ODBSYS, 'axes')).toBe(16);
  });

  it('gives the series and type as text, without the spaces', () => {
    const info = toSystemInfo({ max_axis: 32, cnc_type: ' 0', mt_type: ' T', series: 'D4F1', version: '0010' });
    expect(info).toEqual({ cncType: '0', mtType: 'T', series: 'D4F1', version: '0010', maxAxes: 32 });
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
