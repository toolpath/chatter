import { describe, expect, it } from 'vitest';
import { alarmHelp } from './alarmHelp';

describe('alarmHelp', () => {
  it('gives the kind of a Brother alarm from its first two letters, and what that kind means', () => {
    const help = alarmHelp('brother', 'SV00000005');

    expect(help).toMatch(/^Servo Alarm\. /);
    expect(help).toContain('a motor that moves an axis');
    expect(help).toContain('Brother manual');
  });

  it('gives the meaning of a Brother code that Chatter knows exactly', () => {
    expect(alarmHelp('brother', 'IO0500')).toMatch(/^E Stop\. /);
  });

  it('gives only the kind when Chatter has no words for what that kind means', () => {
    expect(alarmHelp('brother', 'FC00000001')).toMatch(/^Function Alarm\. Details:/);
  });

  it('tells where to look up a Haas alarm number', () => {
    expect(alarmHelp('haas', '108')).toContain('haascnc.com');
  });

  it('tells where to find more about a FANUC alarm', () => {
    expect(alarmHelp('fanuc', '1001 OVERTRAVEL')).toContain('maintenance manual');
  });

  it('says that an MTConnect code depends on the machine maker', () => {
    expect(alarmHelp('mtconnect', '2041')).toContain('machine maker');
  });

  it('says when the machine sent no alarm code', () => {
    expect(alarmHelp('brother', 'alarm')).toBe('The machine sent no alarm code.');
  });

  it('points a Siemens user to the alarm list of the control', () => {
    expect(alarmHelp('siemens', '700209 Door request')).toContain('Diagnostics > Alarm list');
  });
});
