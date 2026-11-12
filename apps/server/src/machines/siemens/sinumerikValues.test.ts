import { describe, expect, it } from 'vitest';
import {
  executionOf,
  modeName,
  programDisplayName,
  programStatusName,
  rParameterPath,
  sinumerikNodeId,
  splitAlarmText,
} from './sinumerikValues.js';

describe('sinumerikNodeId', () => {
  it('puts the NC variable in namespace 2', () => {
    expect(sinumerikNodeId('/Channel/State/chanStatus')).toBe('ns=2;s=/Channel/State/chanStatus');
  });
});

describe('rParameterPath', () => {
  it('reads R0 from row 1, because SINUMERIK rows start at 1', () => {
    expect(rParameterPath(0)).toBe('/Channel/Parameter/R[u1,1]');
    expect(rParameterPath(10)).toBe('/Channel/Parameter/R[u1,11]');
  });
});

describe('executionOf', () => {
  // Verified on a running 828D: 1 while the program runs
  it('gives the MTConnect words for reset, active and interrupted', () => {
    expect(executionOf(0)).toBe('READY');
    expect(executionOf(1)).toBe('ACTIVE');
    expect(executionOf(2)).toBe('INTERRUPTED');
  });

  it('names a status it does not know, and gives nothing for no status', () => {
    expect(executionOf(7)).toBe('UNKNOWN_7');
    expect(executionOf(undefined)).toBeUndefined();
  });
});

describe('programStatusName', () => {
  it('names each program status', () => {
    expect([1, 2, 3, 4, 5].map(programStatusName)).toEqual(['INTERRUPTED', 'STOPPED', 'RUNNING', 'WAITING', 'ABORTED']);
  });
});

describe('modeName', () => {
  it('gives the SINUMERIK mode names', () => {
    expect([0, 1, 2].map(modeName)).toEqual(['JOG', 'MDA', 'AUTO']);
  });
});

describe('programDisplayName', () => {
  it('gives the name that the operator sees', () => {
    expect(programDisplayName('/_N_WKS_DIR/_N_BRACKET_WPD/_N_OP10_MPF')).toBe('OP10.MPF');
    expect(programDisplayName('/_N_MPF_DIR/_N_TEST_mpf')).toBe('TEST.MPF');
  });

  it('keeps a name that is not a SINUMERIK path', () => {
    expect(programDisplayName('PART1.MPF')).toBe('PART1.MPF');
  });

  it('gives nothing for an empty name', () => {
    expect(programDisplayName('')).toBeUndefined();
    expect(programDisplayName(undefined)).toBeUndefined();
  });
});

describe('splitAlarmText', () => {
  it('takes the alarm number from the start of the message', () => {
    expect(splitAlarmText('700209 | [M,Door] Door request')).toEqual({ code: '700209', text: '[M,Door] Door request' });
    expect(splitAlarmText('10208 Continue program with NC start')).toEqual({ code: '10208', text: 'Continue program with NC start' });
  });

  it('gives only the text when the message has no number', () => {
    expect(splitAlarmText(' Door open ')).toEqual({ text: 'Door open' });
  });
});
