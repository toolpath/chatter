/**
 * A failed FOCAS call, with its return code. The code crosses from the FOCAS thread to the server's thread,
 * so the server can tell a lost connection from a value that the control does not have.
 * This file loads no library, so every thread and every test can use it.
 */

/** The control is busy. A call a moment later may work. */
export const EW_BUSY = -1;
/** The library handle is not valid any more */
export const EW_HANDLE = -8;
/** The socket to the control failed */
export const EW_SOCKET = -16;

export class FocasError extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
    this.name = 'FocasError';
  }
}

/** True when the connection to the control is gone, so the machine must connect again */
export function isConnectionLost(error: unknown): boolean {
  return error instanceof FocasError && (error.code === EW_SOCKET || error.code === EW_HANDLE);
}

/** True when the control was busy, so the same call may work a moment later */
export function isBusy(error: unknown): boolean {
  return error instanceof FocasError && error.code === EW_BUSY;
}
