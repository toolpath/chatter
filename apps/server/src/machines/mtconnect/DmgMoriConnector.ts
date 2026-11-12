import { MTConnectConnector } from './MTConnectConnector.js';
import type { MTConnectMachineConfig } from '../../types/index.js';

/**
 * DMG Mori MTConnect connector.
 *
 * DMG Mori agents use the standard MTConnect data items and EXECUTION values
 * (READY, ACTIVE, STOPPED, ...), so this connector reads them the same way as the
 * generic connector. An alarm is an emergency stop or a Fault condition, not an idle machine.
 * The poller creates this class for machines with agent type 'dmg_mori'.
 */
export class DmgMoriConnector extends MTConnectConnector {
  constructor(config: MTConnectMachineConfig) {
    super({ ...config, agentType: 'dmg_mori' });
  }
}
