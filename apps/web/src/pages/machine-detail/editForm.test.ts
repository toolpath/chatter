import { describe, expect, it } from 'vitest';
import { EMPTY_EDIT_FORM, editFormFromMachine, editFormToUpdate, ftpPasswordHint, opcuaPasswordHint, withoutPasswordChange } from './editForm';
import { testMachine } from '../../test/testMachine';
import type { MacroConfig } from '../../types';

describe('editFormToUpdate', () => {
  it('does not send a macro row that has no location yet', () => {
    const macros = [{ location: 500, name: 'Parts' }, { location: '' as unknown as number, name: '' }] as MacroConfig[];

    expect(editFormToUpdate({ ...EMPTY_EDIT_FORM, macros }).macros).toEqual([{ location: 500, name: 'Parts' }]);
  });

  it('makes the message types numbers and drops bad entries', () => {
    const update = editFormToUpdate({ ...EMPTY_EDIT_FORM, ignoredMessageTypes: ['2', 'x', '7'] });

    expect(update.ignoredMessageTypes).toEqual([2, 7]);
  });
});

describe('the FTP password in editFormToUpdate', () => {
  it('does not send a password when the box is empty, so the saved one stays', () => {
    const update = editFormToUpdate(EMPTY_EDIT_FORM);

    expect(update).not.toHaveProperty('ftpPassword');
    expect(update).not.toHaveProperty('removeFtpPassword');
  });

  it('sends a typed password', () => {
    expect(editFormToUpdate({ ...EMPTY_EDIT_FORM, ftpPassword: 'new-secret' }).ftpPassword).toBe('new-secret');
  });

  it('sends an empty password to remove the saved one', () => {
    expect(editFormToUpdate({ ...EMPTY_EDIT_FORM, removeFtpPassword: true }).ftpPassword).toBe('');
  });

  it('sends a typed password also after "Remove password"', () => {
    const form = { ...EMPTY_EDIT_FORM, ftpPassword: 'new-secret', removeFtpPassword: true };

    expect(editFormToUpdate(form).ftpPassword).toBe('new-secret');
  });
});

describe('withoutPasswordChange', () => {
  it('clears the typed password and the remove choice', () => {
    const form = { ...EMPTY_EDIT_FORM, name: 'Speedio', ftpPassword: 'new-secret', removeFtpPassword: true };

    expect(withoutPasswordChange(form)).toEqual({ ...EMPTY_EDIT_FORM, name: 'Speedio' });
  });
});

describe('ftpPasswordHint', () => {
  it('says when no password is saved', () => {
    expect(ftpPasswordHint(EMPTY_EDIT_FORM, false)).toBe('No password is saved.');
  });

  it('says that an empty box keeps the saved password', () => {
    expect(ftpPasswordHint(EMPTY_EDIT_FORM, true)).toBe('A password is saved. Leave this empty to keep it.');
  });

  it('says that the saved password will be removed', () => {
    expect(ftpPasswordHint({ ...EMPTY_EDIT_FORM, removeFtpPassword: true }, true))
      .toBe('The saved password is removed when you click Save changes.');
  });

  it('says that a typed password will be saved', () => {
    expect(ftpPasswordHint({ ...EMPTY_EDIT_FORM, ftpPassword: 'x' }, true))
      .toBe('This new password is saved when you click Save changes.');
  });
});

describe('the Siemens settings in the edit form', () => {
  const siemens = testMachine({
    type: 'siemens', opcuaPort: 4841, opcuaUser: 'OpcUaClient', hasOpcuaPassword: true, opcuaSecurity: 'signAndEncrypt',
  } as never);

  it('fills the OPC UA settings from the machine, with the password box empty', () => {
    expect(editFormFromMachine(siemens)).toMatchObject({
      opcuaPort: 4841, opcuaUser: 'OpcUaClient', opcuaPassword: '', removeOpcuaPassword: false, opcuaSecurity: 'signAndEncrypt',
    });
  });

  it('uses port 4840, anonymous and no security for a machine that has none set', () => {
    expect(editFormFromMachine(testMachine({ type: 'siemens' } as never)))
      .toMatchObject({ opcuaPort: 4840, opcuaUser: '', opcuaSecurity: 'none' });
  });

  it('keeps the saved OPC UA password when the box is empty, and sends a typed or removed one', () => {
    const form = editFormFromMachine(siemens);
    expect(editFormToUpdate(form)).not.toHaveProperty('opcuaPassword');
    expect(editFormToUpdate(form)).not.toHaveProperty('removeOpcuaPassword');
    expect(editFormToUpdate({ ...form, opcuaPassword: 'new' }).opcuaPassword).toBe('new');
    expect(editFormToUpdate({ ...form, removeOpcuaPassword: true }).opcuaPassword).toBe('');
  });

  it('keeps the two passwords apart', () => {
    const update = editFormToUpdate({ ...EMPTY_EDIT_FORM, ftpPassword: 'ftp', removeOpcuaPassword: true });
    expect(update).toMatchObject({ ftpPassword: 'ftp', opcuaPassword: '' });
  });

  it('clears both typed passwords after a save', () => {
    const form = { ...EMPTY_EDIT_FORM, ftpPassword: 'a', opcuaPassword: 'b', removeOpcuaPassword: true };
    expect(withoutPasswordChange(form)).toEqual(EMPTY_EDIT_FORM);
  });

  it('tells what happens to the OPC UA password', () => {
    expect(opcuaPasswordHint(EMPTY_EDIT_FORM, true)).toBe('A password is saved. Leave this empty to keep it.');
    expect(opcuaPasswordHint({ ...EMPTY_EDIT_FORM, removeOpcuaPassword: true }, true))
      .toBe('The saved password is removed when you click Save changes.');
  });
});
