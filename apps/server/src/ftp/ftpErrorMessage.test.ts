import { describe, expect, it } from 'vitest';
import { ftpErrorMessage } from './ftpErrorMessage.js';

describe('ftpErrorMessage', () => {
  it('says nothing answered when the port is closed', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:21 (control socket)'), { code: 'ECONNREFUSED' });
    expect(ftpErrorMessage(error, '127.0.0.1', 21)).toBe(
      'Nothing answered on the FTP port at 127.0.0.1:21. Check that FTP is on at the machine and that the FTP port is right.',
    );
  });

  it('says the machine did not answer after a timeout', () => {
    expect(ftpErrorMessage(new Error('Timeout (control socket)'), '10.0.0.5', 21)).toMatch(/^The machine at 10\.0\.0\.5:21 did not answer/);
  });

  it('says the login failed for reply code 530', () => {
    const error = Object.assign(new Error('530 Login incorrect'), { code: 530 });
    expect(ftpErrorMessage(error, '10.0.0.5', 21)).toMatch(/did not accept the FTP username or password/);
  });

  it('keeps the FTP text for other errors', () => {
    expect(ftpErrorMessage(new Error('550 No such file'), 'h', 21)).toBe('FTP error: 550 No such file');
    expect(ftpErrorMessage('odd', 'h', 21)).toBe('FTP error: Unknown error');
  });
});
