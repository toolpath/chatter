import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { MACHINE_EVENTS, type Machine, type MachineRemovedEvent } from '../types';
import { api, requestLoginCheck } from '../api/client';

interface MachineEventsState {
  /** True while the live connection is open */
  isLive: boolean;
  /** True after the first full machine list came */
  isLoaded: boolean;
}

function parseEventData<T>(event: Event): T {
  return JSON.parse((event as MessageEvent<string>).data) as T;
}

/** Put the changed machine in place of the old one, or add it at the end */
function replaceOrAppendMachine(machines: Machine[], changed: Machine): Machine[] {
  const isKnown = machines.some(machine => machine.id === changed.id);
  if (!isKnown) return [...machines, changed];
  return machines.map(machine => (machine.id === changed.id ? changed : machine));
}

/**
 * Keep the machine list current with the server's live events (SSE).
 * The browser reconnects by itself, and the server then sends the full list again.
 */
export function useMachineEvents(setMachines: Dispatch<SetStateAction<Machine[]>>): MachineEventsState {
  const [isLive, setIsLive] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const eventSource = new EventSource(api.events.$url());

    eventSource.addEventListener('open', () => setIsLive(true));

    eventSource.addEventListener(MACHINE_EVENTS.list, event => {
      setMachines(parseEventData<Machine[]>(event));
      setIsLoaded(true);
    });
    eventSource.addEventListener(MACHINE_EVENTS.changed, event => {
      const changed = parseEventData<Machine>(event);
      setMachines(machines => replaceOrAppendMachine(machines, changed));
    });
    eventSource.addEventListener(MACHINE_EVENTS.removed, event => {
      const { id } = parseEventData<MachineRemovedEvent>(event);
      setMachines(machines => machines.filter(machine => machine.id !== id));
    });

    // The browser stops for good after an error reply, such as 401 when the login is gone
    eventSource.addEventListener('error', () => {
      setIsLive(false);
      if (eventSource.readyState === EventSource.CLOSED) requestLoginCheck();
    });

    return () => eventSource.close();
  }, [setMachines]);

  return { isLive, isLoaded };
}
