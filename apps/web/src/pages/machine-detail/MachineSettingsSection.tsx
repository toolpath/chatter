import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Notice } from '../../components/ui/Notice';
import type { Machine, MachineUpdate } from '../../types';
import { editFormFromMachine, editFormToUpdate, withoutPasswordChange } from './editForm';
import EditMachineForm from './EditMachineForm';

interface MachineSettingsSectionProps {
  machine: Machine;
  /** True when the server saved the update */
  onUpdate: (id: string, updates: MachineUpdate) => Promise<boolean>;
}

/**
 * Change how ChatterBox reaches the machine. DeleteMachineSection deletes it.
 * Give it a new key for each machine, so the form fills again.
 */
export function MachineSettingsSection({ machine, onUpdate }: MachineSettingsSectionProps) {
  const [form, setForm] = useState(() => editFormFromMachine(machine));
  // The settings that the server has. After a save, they are the saved form, also before the new machine status comes.
  const [saved, setSaved] = useState(() => editFormFromMachine(machine));
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
    setSaved(withoutPasswordChange(form));
    setForm(withoutPasswordChange);
    setIsSaved(true);
  };

  const undo = () => {
    setForm(editFormFromMachine(machine));
    setSaved(editFormFromMachine(machine));
    setIsSaved(false);
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-5 p-4">
      <EditMachineForm
        machineType={machine.type}
        hasFtpPassword={machine.hasFtpPassword ?? false}
        hasOpcuaPassword={machine.type === 'siemens' ? machine.hasOpcuaPassword ?? false : false}
        saved={saved}
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
