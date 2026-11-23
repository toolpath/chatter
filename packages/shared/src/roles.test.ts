import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES, roleCan, uploadSenderFieldsFor, type Permission, type Role } from './roles.js';

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
