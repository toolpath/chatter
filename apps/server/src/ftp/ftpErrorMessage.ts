/** basic-ftp gives the FTP reply code here, for example 530 for a failed login */
interface FtpFailure {
  code?: string | number;
  message?: string;
}

/** A message for the user that says why the machine's FTP server did not answer, and what to check */
export function ftpErrorMessage(error: unknown, host: string, port: number): string {
  const { code, message = '' } = (error ?? {}) as FtpFailure;
  const address = `${host}:${port}`;
  if (code === 'ECONNREFUSED') {
    return `Nothing answered on the FTP port at ${address}. Check that FTP is on at the machine and that the FTP port is right.`;
  }
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || /timeout/i.test(message)) {
    return `The machine at ${address} did not answer. Check the IP address, the FTP port and the network.`;
  }
  if (code === 530) {
    return 'The machine did not accept the FTP username or password. Check them in Machine settings.';
  }
  return `FTP error: ${message || 'Unknown error'}`;
}
