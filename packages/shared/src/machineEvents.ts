// ============================================
// Live machine events (server-sent events on GET /api/events)
// ============================================

/**
 * The event names.
 * - list: every machine. The server sends it first, and again after each reconnect.
 * - changed: one machine whose status changed. The data is that machine.
 * - removed: one machine that was removed. The data is a MachineRemovedEvent.
 */
export const MACHINE_EVENTS = {
  list: 'machines',
  changed: 'machine',
  removed: 'machine-removed',
} as const;

export interface MachineRemovedEvent {
  id: string;
}
