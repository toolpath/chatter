import { describe, expect, it } from 'vitest';
import {
  hideMachineAddress, machineStatusFor, PERMISSIONS, ROLES, roleCan, seesMachineSettings, uploadSenderFieldsFor,
  type Permission, type Role,
} from './roles.js';

/** What each role can do, written out from the spec. A change to a role must change this table too. */
const SPEC: Record<Role, Permission[]> = {
  viewer: [],
  operator: ['read-files', 'send-files', 'sync-tools'],
  admin: ['read-files', 'send-files', 'sync-tools', 'manage-machines', 'manage-chatter', 'manage-updates'],
};

describe('roleCan', () => {
  it('gives each role exactly the permissions of the spec', () => {
    const table = Object.fromEntries(ROLES.map(role => [role, PERMISSIONS.filter(permission => roleCan(role, permission))]));
    expect(table).toEqual(SPEC);
  });

  it('lets an Operator and an Admin read program files, but not a Viewer', () => {
    expect(ROLES.map(role => [role, roleCan(role, 'read-files')])).toEqual([
      ['viewer', false],
      ['operator', true],
      ['admin', true],
    ]);
  });

  it('gives each role that can send files also the right to read them', () => {
    for (const role of ROLES) {
      if (roleCan(role, 'send-files')) expect(roleCan(role, 'read-files'), role).toBe(true);
    }
  });
});

describe('uploadSenderFieldsFor', () => {
  it('lets an Operator and an Admin see who sent a program, and only an Admin the address (decision D4)', () => {
    expect(ROLES.map(role => [role, uploadSenderFieldsFor(role)])).toEqual([
      ['viewer', { uploaded_by: false, address: false }],
      ['operator', { uploaded_by: true, address: false }],
      ['admin', { uploaded_by: true, address: true }],
    ]);
  });
});

/** A Siemens status with each field that a status can have, and an address and usernames that are easy to find */
const SIEMENS_STATUS = {
  id: 'm1', name: 'DMU', host: '192.168.1.60', type: 'siemens', connected: false, connecting: true, lastPollTime: null,
  errors: ['connect ECONNREFUSED 192.168.1.60:4840', 'FTP login of zq-ftp-user failed'],
  data: { program: 'O1000' }, macros: [{ location: 5, name: 'Parts' }], pollTimings: { lastMs: 3 },
  dataPort: 1, queryPort: 2, ftpPort: 21, ftpUser: 'zq-ftp-user', hasFtpPassword: true,
  opcuaPort: 4840, opcuaUser: 'zq-opcua-user', hasOpcuaPassword: true, opcuaSecurity: 'none', opcuaServerThumbprint: 'ab'.repeat(32),
  opcuaCertificateChanged: { presentedThumbprint: 'cd'.repeat(32), presentedSha1Thumbprint: 'ef'.repeat(20) },
  opcuaSecurityWarning: 'Security is None.',
};
const OTHER_TYPE_FIELDS = {
  mtConnectPort: 5000, mtConnectDeviceId: 'dev', agentType: 'mazak', focasPort: 8193,
  toolNumberVariable: 500, partCounterVariable: 501, ignoredMessageTypes: [1], defaultUnit: 'mm',
};

describe('seesMachineSettings', () => {
  it('gives the connection settings of a machine to an Operator and an Admin, but not to a Viewer (decision D4)', () => {
    expect(ROLES.map(role => [role, seesMachineSettings(role)])).toEqual([
      ['viewer', false],
      ['operator', true],
      ['admin', true],
    ]);
  });
});

describe('machineStatusFor', () => {
  it('gives an Operator and an Admin the whole status, as it is', () => {
    const status = { ...SIEMENS_STATUS, ...OTHER_TYPE_FIELDS };
    expect(machineStatusFor('operator', status)).toBe(status);
    expect(machineStatusFor('admin', status)).toBe(status);
  });

  it('gives a Viewer only the fields of the dashboard and the machine page, and the warnings', () => {
    const viewed = machineStatusFor('viewer', { ...SIEMENS_STATUS, ...OTHER_TYPE_FIELDS });
    expect(Object.keys(viewed).sort()).toEqual([
      'agentType', 'connected', 'connecting', 'data', 'defaultUnit', 'errors', 'id', 'lastPollTime', 'macros', 'name',
      'opcuaCertificateChanged', 'opcuaSecurityWarning', 'pollTimings', 'type',
    ]);
    expect(viewed).toMatchObject({
      data: SIEMENS_STATUS.data, macros: SIEMENS_STATUS.macros, opcuaSecurityWarning: 'Security is None.',
      opcuaCertificateChanged: SIEMENS_STATUS.opcuaCertificateChanged,
    });
  });

  it('removes the address and the usernames from the errors that a Viewer gets', () => {
    const viewed = machineStatusFor('viewer', SIEMENS_STATUS);
    expect(viewed.errors).toEqual(['connect ECONNREFUSED the machine address', 'FTP login of the user failed']);
    const text = JSON.stringify(viewed);
    for (const secret of ['192.168.1.60', ':4840', 'zq-ftp-user', 'zq-opcua-user', 'ab'.repeat(32)]) {
      expect(text).not.toContain(secret);
    }
  });

  it('adds no field that the status does not have', () => {
    expect(machineStatusFor('viewer', { id: 'm2', name: 'Speedio', host: '10.0.0.5', type: 'brother', errors: [] }))
      .toEqual({ id: 'm2', name: 'Speedio', type: 'brother', errors: [] });
  });
});

describe('hideMachineAddress', () => {
  const machine = { host: '192.168.1.6', ftpUser: 'cnc', opcuaUser: '' };

  it.each([
    ['connect ECONNREFUSED 192.168.1.6:10000', 'connect ECONNREFUSED the machine address'],
    ['No reply from 192.168.1.6', 'No reply from the machine address'],
    ['Timeout 192.168.1.6:21 and 192.168.1.6:8193', 'Timeout the machine address and the machine address'],
    // A different address that starts with the same digits stays
    ['connect ECONNREFUSED 192.168.1.60:10000', 'connect ECONNREFUSED 192.168.1.60:10000'],
    ['10.192.168.1.6', '10.192.168.1.6'],
    ['530 Login of cnc failed', '530 Login of the user failed'],
    // Only the whole word: "cnc" in "cncs" stays
    ['The cncs are offline', 'The cncs are offline'],
    ['No change', 'No change'],
  ])('%s', (text, hidden) => {
    expect(hideMachineAddress(text, machine)).toBe(hidden);
  });

  it('changes nothing for an empty username or no address', () => {
    expect(hideMachineAddress('a b', { host: '', ftpUser: '', opcuaUser: undefined })).toBe('a b');
    expect(hideMachineAddress('a b', {})).toBe('a b');
  });

  it('finds an address with dots as dots only', () => {
    expect(hideMachineAddress('192x168x1x6', machine)).toBe('192x168x1x6');
  });
});
