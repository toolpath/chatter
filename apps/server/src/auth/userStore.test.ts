import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SettingsTable } from '../storage/settingsTable.js';
import { LastAdminError, UsernameTakenError, UserStore } from './userStore.js';

const HASH = 'scrypt:salt:hash';
const admin = (username = 'admin') => ({ username, passwordHash: HASH, role: 'admin' as const });
const operator = (username = 'sam') => ({ username, passwordHash: HASH, role: 'operator' as const });

describe('UserStore', () => {
  it('finds a user by username, in any case', () => {
    const users = UserStore.inMemory();
    users.add(operator('Sam'));

    expect(users.findByName('sAM')).toMatchObject({ username: 'Sam', role: 'operator', passwordHash: HASH });
    expect(users.findByName('jo')).toBeNull();
  });

  it('refuses a username that exists already, in any case', () => {
    const users = UserStore.inMemory();
    users.add(operator('sam'));

    expect(() => users.add(operator('SAM'))).toThrow(UsernameTakenError);
  });

  it('lists the users by username, without the password hashes', () => {
    const users = UserStore.inMemory();
    users.add(operator('sam'));
    users.add(admin('Jo'));

    const list = users.list();
    expect(list.map(user => user.username)).toEqual(['Jo', 'sam']);
    expect(list[0]).not.toHaveProperty('passwordHash');
  });

  it('makes the first admin only when no admin exists', () => {
    const users = UserStore.inMemory();
    users.add(operator());

    expect(users.addFirstAdmin({ username: 'admin', passwordHash: HASH })?.role).toBe('admin');
    expect(users.addFirstAdmin({ username: 'second', passwordHash: HASH })).toBeNull();
  });

  it('keeps at least one admin', () => {
    const users = UserStore.inMemory();
    const first = users.add(admin('first'));

    expect(() => users.setRole(first.id, 'viewer')).toThrow(LastAdminError);
    expect(() => users.remove(first.id)).toThrow(LastAdminError);

    const second = users.add(admin('second'));
    expect(users.setRole(first.id, 'viewer')).toBe(true);
    expect(() => users.remove(second.id)).toThrow(LastAdminError);
  });

  it('gives false for a user that does not exist', () => {
    const users = UserStore.inMemory();
    expect(users.setRole(99, 'viewer')).toBe(false);
    expect(users.remove(99)).toBe(false);
  });

  it('does not give the id of a removed user to a new user', () => {
    const users = UserStore.inMemory();
    users.add(admin());
    const sam = users.add(operator('sam'));
    users.remove(sam.id);

    expect(users.add(operator('jo')).id).not.toBe(sam.id);
  });

  it('removes only the admins at a password reset', () => {
    const users = UserStore.inMemory();
    users.add(admin());
    users.add(operator());

    users.removeAdmins();

    expect(users.hasAdmin()).toBe(false);
    expect(users.list().map(user => user.username)).toEqual(['sam']);
  });

  it('moves the one account of an older version into the users, as an admin', () => {
    const db = new Database(':memory:');
    const settings = new SettingsTable(db);
    settings.set({ username: 'owner', password_hash: HASH, session_secret: 'old secret' });

    const users = new UserStore(db);

    expect(users.findByName('owner')).toMatchObject({ role: 'admin', passwordHash: HASH });
    expect(settings.get('username')).toBeUndefined();
    expect(settings.get('password_hash')).toBeUndefined();
    expect(settings.get('session_secret')).toBeUndefined();
  });
});
