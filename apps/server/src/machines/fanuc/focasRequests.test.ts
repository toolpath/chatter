import { describe, expect, it, vi } from 'vitest';
import { FocasRequestHandler, type FocasConnection, type FocasLibrary } from './focasRequests.js';

function fakeConnection(name: string): FocasConnection {
  return {
    disconnect: vi.fn(),
    readStatus: vi.fn(() => ({ mode: name } as ReturnType<FocasConnection['readStatus']>)),
    readSpindleSpeed: vi.fn(() => ({ speed: 1200 })),
    readSpindleLoad: vi.fn(() => undefined),
    readMacro: vi.fn((number: number) => ({ number, value: 7, decimalPlaces: 0 })),
    readProgram: vi.fn(() => ({ name: 'O1', number: 1 })),
    readAlarms: vi.fn(() => []),
    readOperatorMessages: vi.fn(() => []),
  };
}

function handlerWith(connections: FocasConnection[]) {
  const library: FocasLibrary = {
    initialize: vi.fn(),
    connect: vi.fn(() => {
      const next = connections.shift();
      if (!next) throw new Error('Connection failed: Socket error');
      return next;
    }),
  };
  return { library, handler: new FocasRequestHandler(library) };
}

describe('FocasRequestHandler', () => {
  it('loads the library from the path that the server sends', () => {
    const { library, handler } = handlerWith([]);
    expect(handler.handle({ id: 1, kind: 'initialize', libraryPath: '/data/focas/lib.so' })).toEqual({ id: 1, ok: true, value: undefined });
    expect(library.initialize).toHaveBeenCalledWith('/data/focas/lib.so');
  });

  it('gives each connection its own session, and reads from that connection', () => {
    const { library, handler } = handlerWith([fakeConnection('A'), fakeConnection('B')]);
    const first = handler.handle({ id: 1, kind: 'connect', host: '10.0.0.1', port: 8193, timeoutSeconds: 10 });
    const second = handler.handle({ id: 2, kind: 'connect', host: '10.0.0.2', port: 8193, timeoutSeconds: 10 });
    expect(library.connect).toHaveBeenCalledWith('10.0.0.1', 8193, 10);
    expect(first).toEqual({ id: 1, ok: true, value: 1 });
    expect(second).toEqual({ id: 2, ok: true, value: 2 });

    expect(handler.handle({ id: 3, kind: 'read', session: 2, read: 'readStatus', args: [] }))
      .toEqual({ id: 3, ok: true, value: { mode: 'B' } });
  });

  it('passes the arguments of a read', () => {
    const { handler } = handlerWith([fakeConnection('A')]);
    handler.handle({ id: 1, kind: 'connect', host: 'h', port: 1, timeoutSeconds: 1 });
    expect(handler.handle({ id: 2, kind: 'read', session: 1, read: 'readMacro', args: [500] }))
      .toEqual({ id: 2, ok: true, value: { number: 500, value: 7, decimalPlaces: 0 } });
  });

  it('answers a failure with its message, and keeps answering', () => {
    const { handler } = handlerWith([]);
    expect(handler.handle({ id: 1, kind: 'connect', host: 'h', port: 1, timeoutSeconds: 1 }))
      .toEqual({ id: 1, ok: false, message: 'Connection failed: Socket error' });
    expect(handler.handle({ id: 2, kind: 'initialize', libraryPath: 'x' }).ok).toBe(true);
  });

  it('ends a connection, after which its session cannot read', () => {
    const connection = fakeConnection('A');
    const { handler } = handlerWith([connection]);
    handler.handle({ id: 1, kind: 'connect', host: 'h', port: 1, timeoutSeconds: 1 });

    expect(handler.handle({ id: 2, kind: 'disconnect', session: 1 }).ok).toBe(true);
    expect(connection.disconnect).toHaveBeenCalledTimes(1);
    expect(handler.handle({ id: 3, kind: 'read', session: 1, read: 'readStatus', args: [] }))
      .toEqual({ id: 3, ok: false, message: 'Not connected to CNC controller' });
  });

  it('refuses a read that is not a FOCAS read', () => {
    const { handler } = handlerWith([fakeConnection('A')]);
    handler.handle({ id: 1, kind: 'connect', host: 'h', port: 1, timeoutSeconds: 1 });
    const response = handler.handle({ id: 2, kind: 'read', session: 1, read: 'disconnect' as never, args: [] });
    expect(response).toEqual({ id: 2, ok: false, message: 'Unknown FOCAS read: disconnect' });
  });
});
