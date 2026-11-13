/**
 * The messages between the server and the FOCAS thread, and how the FOCAS thread answers them.
 * Nothing here needs a thread, so the tests run it directly.
 */

import type { Focas } from './focas.js';
import { FocasError } from './focasError.js';

/** The reads of one connection that the server can ask for */
export type FocasRead =
  | 'readStatus'
  | 'readSpindleSpeed'
  | 'readSpindleLoad'
  | 'readMacro'
  | 'readProgram'
  | 'readAlarms'
  | 'readOperatorMessages'
  | 'readSystemInfo'
  | 'readPathCount';

export type FocasCommand =
  | { kind: 'initialize'; libraryPath: string; startProcess: boolean }
  | { kind: 'connect'; host: string; port: number; timeoutSeconds: number }
  | { kind: 'disconnect'; session: number }
  | { kind: 'read'; session: number; read: FocasRead; args: number[] }
  /** End every connection and unload the library, when the server shuts down */
  | { kind: 'cleanup'; exitProcess: boolean };

export type FocasRequest = FocasCommand & { id: number };

export type FocasResponse =
  | { id: number; ok: true; value: unknown }
  /** code is the FOCAS return code, when the failure came from a cnc_* call */
  | { id: number; ok: false; message: string; code?: number };

/** One connection to a control, as the Focas class gives it */
export type FocasConnection = Pick<Focas, FocasRead | 'disconnect'>;

/** The parts of the FOCAS library that the FOCAS thread uses */
export interface FocasLibrary {
  /** Load the library. On Linux, startProcess also calls cnc_startupprocess, which only one thread of the server may do. */
  initialize(libraryPath: string, startProcess: boolean): void;
  connect(host: string, port: number, timeoutSeconds: number): FocasConnection;
  /** Unload the library. On Linux, exitProcess also calls cnc_exitprocess, which only the last thread may do. */
  cleanup(exitProcess: boolean): void;
}

const READS: ReadonlySet<string> = new Set<FocasRead>([
  'readStatus',
  'readSpindleSpeed',
  'readSpindleLoad',
  'readMacro',
  'readProgram',
  'readAlarms',
  'readOperatorMessages',
  'readSystemInfo',
  'readPathCount',
]);

/**
 * Answers the requests of the server, one at a time, on the FOCAS thread.
 * Each connection gets a number (a session), which the server sends with each read.
 */
export class FocasRequestHandler {
  private readonly connections = new Map<number, FocasConnection>();
  private nextSession = 1;

  constructor(private readonly library: FocasLibrary) {}

  handle(request: FocasRequest): FocasResponse {
    try {
      return { id: request.id, ok: true, value: this.run(request) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof FocasError) return { id: request.id, ok: false, message, code: error.code };
      return { id: request.id, ok: false, message };
    }
  }

  private run(command: FocasCommand): unknown {
    switch (command.kind) {
      case 'initialize':
        this.library.initialize(command.libraryPath, command.startProcess);
        return undefined;
      case 'connect': {
        const connection = this.library.connect(command.host, command.port, command.timeoutSeconds);
        const session = this.nextSession++;
        this.connections.set(session, connection);
        return session;
      }
      case 'disconnect': {
        const connection = this.connections.get(command.session);
        this.connections.delete(command.session);
        connection?.disconnect();
        return undefined;
      }
      case 'read':
        return this.read(command.session, command.read, command.args);
      case 'cleanup':
        this.cleanup(command.exitProcess);
        return undefined;
    }
  }

  /** Free the handle of each connection (cnc_freelibhndl) before the library goes */
  private cleanup(exitProcess: boolean): void {
    for (const connection of this.connections.values()) {
      try {
        connection.disconnect();
      } catch {
        // The server shuts down, so the other handles and the library still go
      }
    }
    this.connections.clear();
    this.library.cleanup(exitProcess);
  }

  private read(session: number, read: FocasRead, args: number[]): unknown {
    if (!READS.has(read)) throw new Error(`Unknown FOCAS read: ${read}`);
    const connection = this.connections.get(session);
    if (!connection) throw new Error('Not connected to CNC controller');
    const call = connection[read] as (...values: number[]) => unknown;
    return call.apply(connection, args);
  }
}
