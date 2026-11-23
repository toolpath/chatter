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

  it('saves the trusted certificate of the control, and clears it', () => {
    repository.insertSiemens(newSiemensMachine({ id: 's1', name: 'S', host: 'h' }));
    expect(repository.loadSiemensMachines()[0].opcuaServerThumbprint).toBeUndefined();

    repository.setSiemensServerThumbprint('s1', 'c'.repeat(64));
    expect(repository.loadSiemensMachines()[0].opcuaServerThumbprint).toBe('c'.repeat(64));

    repository.setSiemensServerThumbprint('s1', null);
    expect(repository.loadSiemensMachines()[0].opcuaServerThumbprint).toBeUndefined();
  });

  it('keeps the trusted certificate when an update writes other settings', () => {
    repository.insertSiemens(newSiemensMachine({ id: 's1', name: 'S', host: 'h' }));
    repository.setSiemensServerThumbprint('s1', 'c'.repeat(64));
    repository.update('siemens', 's1', { name: 'Renamed', opcuaPassword: 'p' });
    expect(repository.loadSiemensMachines()[0].opcuaServerThumbprint).toBe('c'.repeat(64));
  });

  it('gives a Siemens machine of an older version no trusted certificate, so its next connect trusts the certificate that it gets', () => {
    const db = new Database(':memory:');
    // siemens_machines as the last release made it, with no opcua_server_thumbprint column
    db.exec(`CREATE TABLE siemens_machines (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, opcua_port INTEGER DEFAULT 4840,
      opcua_user TEXT DEFAULT '', opcua_password TEXT DEFAULT '', opcua_security TEXT DEFAULT 'none',
      ftp_port INTEGER DEFAULT 21, ftp_user TEXT DEFAULT 'anonymous', ftp_password TEXT DEFAULT '',
      macros TEXT DEFAULT '[]', created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec("INSERT INTO siemens_machines (id, name, host) VALUES ('s1', 'Old', '192.168.1.60')");

    applySchema(db);
    applySchema(db);

    const [machine] = new MachineRepository(db).loadSiemensMachines();
    expect(machine).toMatchObject({ id: 's1', name: 'Old', host: '192.168.1.60' });
    expect(machine.opcuaServerThumbprint).toBeUndefined();
    db.close();
  });

  it('deletes a machine', () => {
    repository.insertSiemens(newSiemensMachine({ id: 's1', name: 'S', host: 'h' }));
    repository.delete('siemens', 's1');
    expect(repository.loadSiemensMachines()).toEqual([]);
  });
});
