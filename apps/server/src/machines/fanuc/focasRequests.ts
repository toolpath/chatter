/**
 * The messages between the server and the FOCAS thread, and how the FOCAS thread answers them.
 * Nothing here needs a thread, so the tests run it directly.
 */

import type { Focas } from './focas.js';

/** The reads of one connection that the server can ask for */
export type FocasRead =
  | 'readStatus'
  | 'readSpindleSpeed'
  | 'readSpindleLoad'
  | 'readMacro'
  | 'readProgram'
  | 'readAlarms'
  | 'readOperatorMessages';

export type FocasCommand =
  | { kind: 'initialize'; libraryPath: string }
  | { kind: 'connect'; host: string; port: number; timeoutSeconds: number }
  | { kind: 'disconnect'; session: number }
  | { kind: 'read'; session: number; read: FocasRead; args: number[] };

export type FocasRequest = FocasCommand & { id: number };

export type FocasResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; message: string };

/** One connection to a control, as the Focas class gives it */
export type FocasConnection = Pick<Focas, FocasRead | 'disconnect'>;

/** The parts of the FOCAS library that the FOCAS thread uses */
export interface FocasLibrary {
  initialize(libraryPath: string): void;
  connect(host: string, port: number, timeoutSeconds: number): FocasConnection;
}

const READS: ReadonlySet<string> = new Set<FocasRead>([
  'readStatus',
  'readSpindleSpeed',
  'readSpindleLoad',
  'readMacro',
  'readProgram',
  'readAlarms',
  'readOperatorMessages',
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
      return { id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  private run(command: FocasCommand): unknown {
    switch (command.kind) {
      case 'initialize':
        this.library.initialize(command.libraryPath);
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
    }
  }

  private read(session: number, read: FocasRead, args: number[]): unknown {
    if (!READS.has(read)) throw new Error(`Unknown FOCAS read: ${read}`);
    const connection = this.connections.get(session);
    if (!connection) throw new Error('Not connected to CNC controller');
    const call = connection[read] as (...values: number[]) => unknown;
    return call.apply(connection, args);
  }
}
