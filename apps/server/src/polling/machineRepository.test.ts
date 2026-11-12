import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { applySchema } from '../storage/schema.js';
import { MachineRepository } from './machineRepository.js';
import { newSiemensMachine } from './machineSettings.js';

describe('MachineRepository with Siemens machines', () => {
  let repository: MachineRepository;

  beforeEach(() => {
    const db = new Database(':memory:');
    applySchema(db);
    repository = new MachineRepository(db);
  });

  it('saves a new machine and loads it back', () => {
    repository.insertSiemens(newSiemensMachine({
      id: 's1', name: 'DNM 6700', host: '192.168.1.60', opcuaUser: 'OpcUaClient', opcuaPassword: 'secret',
      opcuaSecurity: 'signAndEncrypt', macros: [{ location: 5, name: 'Stock' }],
    }));

    expect(repository.loadSiemensMachines()).toEqual([{
      id: 's1', name: 'DNM 6700', host: '192.168.1.60', opcuaPort: 4840, opcuaUser: 'OpcUaClient', opcuaPassword: 'secret',
      opcuaSecurity: 'signAndEncrypt', ftpPort: 21, ftpUser: 'anonymous', ftpPassword: '', macros: [{ location: 5, name: 'Stock' }],
    }]);
  });

  it('writes each OPC UA setting of an update', () => {
    repository.insertSiemens(newSiemensMachine({ id: 's1', name: 'S', host: '192.168.1.60' }));
    repository.update('siemens', 's1', { opcuaPort: 4841, opcuaUser: 'u', opcuaPassword: 'p', opcuaSecurity: 'signAndEncrypt' });

    expect(repository.loadSiemensMachines()[0]).toMatchObject({
      opcuaPort: 4841, opcuaUser: 'u', opcuaPassword: 'p', opcuaSecurity: 'signAndEncrypt',
    });
  });

  it('removes the password with an empty one', () => {
    repository.insertSiemens(newSiemensMachine({ id: 's1', name: 'S', host: 'h', opcuaUser: 'u', opcuaPassword: 'p' }));
    repository.update('siemens', 's1', { opcuaPassword: '' });
    expect(repository.loadSiemensMachines()[0].opcuaPassword).toBeUndefined();
  });

  it('deletes a machine', () => {
    repository.insertSiemens(newSiemensMachine({ id: 's1', name: 'S', host: 'h' }));
    repository.delete('siemens', 's1');
    expect(repository.loadSiemensMachines()).toEqual([]);
  });
});
