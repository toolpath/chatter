import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Notice } from '../../components/ui/Notice';
import type { Machine, MachineUpdate } from '../../types';
import { editFormFromMachine, editFormToUpdate, withoutPasswordChange, type EditFormState } from './editForm';
import EditMachineForm from './EditMachineForm';

interface MachineSettingsSectionProps {
  machine: Machine;
  /** True when the server saved the update */
  onUpdate: (id: string, updates: MachineUpdate) => Promise<boolean>;
}

/** The settings that the server has, and which passwords it keeps */
interface SavedSettings {
  form: EditFormState;
  hasFtpPassword: boolean;
  hasOpcuaPassword: boolean;
}

function savedSettingsOf(machine: Machine): SavedSettings {
  return {
    form: editFormFromMachine(machine),
    hasFtpPassword: machine.hasFtpPassword ?? false,
    hasOpcuaPassword: machine.type === 'siemens' ? machine.hasOpcuaPassword ?? false : false,
  };
}

/** After a save, the server has the form. A new password is saved, and a removed one is gone. */
function savedSettingsAfter(form: EditFormState, before: SavedSettings): SavedSettings {
  const has = (newPassword: string, remove: boolean, hadPassword: boolean) => newPassword !== '' || (!remove && hadPassword);
  return {
    form: withoutPasswordChange(form),
    hasFtpPassword: has(form.ftpPassword, form.removeFtpPassword, before.hasFtpPassword),
    hasOpcuaPassword: has(form.opcuaPassword, form.removeOpcuaPassword, before.hasOpcuaPassword),
  };
}

/**
 * Change how ChatterBox reaches the machine. DeleteMachineSection deletes it.
 * Give it a new key for each machine, so the form fills again.
 */
export function MachineSettingsSection({ machine, onUpdate }: MachineSettingsSectionProps) {
  const [form, setForm] = useState(() => editFormFromMachine(machine));
  // The settings that the server has. After a save, they are the saved form, also before the new machine status comes.
  const [saved, setSaved] = useState(() => savedSettingsOf(machine));
  // A new machine status with other settings (for example from another browser) replaces them
  const fromMachine = JSON.stringify(savedSettingsOf(machine));
  const [lastFromMachine, setLastFromMachine] = useState(fromMachine);
  if (fromMachine !== lastFromMachine) {
    setLastFromMachine(fromMachine);
    setSaved(savedSettingsOf(machine));
  }
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setIsSaved(false);
    // On an error the form keeps the typed values, and the page shows the error
    const isAccepted = await onUpdate(machine.id, editFormToUpdate(form));
    setIsSaving(false);
    if (!isAccepted) return;
    setSaved(before => savedSettingsAfter(form, before));
    setForm(withoutPasswordChange);
    setIsSaved(true);
  };

  // Back to the settings that the server has, also just after a save
  const undo = () => {
    setForm(saved.form);
    setIsSaved(false);
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-5 p-4">
      <EditMachineForm
        machine={machine}
        hasFtpPassword={saved.hasFtpPassword}
        hasOpcuaPassword={saved.hasOpcuaPassword}
        saved={saved.form}
        form={form}
        setForm={setForm}
      />
      {isSaved && <Notice tone="success" title="The settings are saved" onClose={() => setIsSaved(false)} />}
      <div className="flex justify-end gap-2">
        <Button onClick={undo} disabled={isSaving}>Undo changes</Button>
        <Button type="submit" variant="primary" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </form>
  );
}
