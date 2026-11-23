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
  const saved = { ...EMPTY_EDIT_FORM, host: '192.168.1.50' };
  const textOf = (form: typeof saved, hasSavedPassword: boolean) => ftpPasswordHint(form, hasSavedPassword, saved).text;

  it('says when no password is saved', () => {
    expect(textOf(saved, false)).toBe('No password is saved.');
  });

  it('says that an empty box keeps the saved password', () => {
    expect(ftpPasswordHint(saved, true, saved)).toEqual({ text: 'A password is saved. Leave this empty to keep it.', mustTypeAgain: false });
  });

  it('says that the saved password will be removed', () => {
    expect(textOf({ ...saved, removeFtpPassword: true }, true)).toBe('The saved password is removed when you click Save changes.');
  });

  it('says that a typed password will be saved', () => {
    expect(textOf({ ...saved, ftpPassword: 'x' }, true)).toBe('This new password is saved when you click Save changes.');
  });

  it('asks for the saved password again after a new IP address or FTP port, as the server does', () => {
    const typeAgain = {
      text: 'Type the password again. You changed the IP address or the FTP port. Chatter does not send a saved password to a new address.',
      mustTypeAgain: true,
    };
    expect(ftpPasswordHint({ ...saved, host: '192.168.1.99' }, true, saved)).toEqual(typeAgain);
    expect(ftpPasswordHint({ ...saved, ftpPort: 2121 }, true, saved)).toEqual(typeAgain);
  });

  it('does not ask again for spaces around the IP address, a new username, or a new port of the OPC UA password', () => {
    expect(ftpPasswordHint({ ...saved, host: ' 192.168.1.50 ' }, true, saved).mustTypeAgain).toBe(false);
    expect(ftpPasswordHint({ ...saved, ftpUser: 'operator' }, true, saved).mustTypeAgain).toBe(false);
    expect(ftpPasswordHint({ ...saved, opcuaPort: 4841 }, true, saved).mustTypeAgain).toBe(false);
  });

  it('does not ask again when the user types or removes the password, or when none is saved', () => {
    const moved = { ...saved, host: '192.168.1.99' };
    expect(ftpPasswordHint({ ...moved, ftpPassword: 'x' }, true, saved).mustTypeAgain).toBe(false);
    expect(ftpPasswordHint({ ...moved, removeFtpPassword: true }, true, saved).mustTypeAgain).toBe(false);
    expect(ftpPasswordHint(moved, false, saved).mustTypeAgain).toBe(false);
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
    expect(opcuaPasswordHint(EMPTY_EDIT_FORM, true, EMPTY_EDIT_FORM).text).toBe('A password is saved. Leave this empty to keep it.');
    expect(opcuaPasswordHint({ ...EMPTY_EDIT_FORM, removeOpcuaPassword: true }, true, EMPTY_EDIT_FORM).text)
      .toBe('The saved password is removed when you click Save changes.');
  });

  it('asks for the saved OPC UA password again after a new OPC UA port, and not after a new FTP port', () => {
    expect(opcuaPasswordHint({ ...EMPTY_EDIT_FORM, opcuaPort: 4841 }, true, EMPTY_EDIT_FORM).text)
      .toBe('Type the password again. You changed the IP address or the OPC UA port. Chatter does not send a saved password to a new address.');
    expect(opcuaPasswordHint({ ...EMPTY_EDIT_FORM, ftpPort: 2121 }, true, EMPTY_EDIT_FORM).mustTypeAgain).toBe(false);
  });
});
