import { Dialog } from '@toolpath/ui';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Notice } from '../../components/ui/Notice';
import type { Machine, MachineUpdate } from '../../types';
import { editFormFromMachine, editFormToUpdate, withoutPasswordChange } from './editForm';
import EditMachineForm from './EditMachineForm';

interface MachineSettingsTabProps {
  machine: Machine;
  /** True when the server saved the update */
  onUpdate: (id: string, updates: MachineUpdate) => Promise<boolean>;
  onRemove: () => Promise<void>;
}

/**
 * Change how ChatterBox reaches the machine, or remove the machine.
 * Give it a new key for each machine, so the form fills again.
 */
export function MachineSettingsTab({ machine, onUpdate, onRemove }: MachineSettingsTabProps) {
  const [form, setForm] = useState(() => editFormFromMachine(machine));
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const { confirm } = Dialog.useDialog();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setIsSaved(false);
    // On an error the form keeps the typed values, and the page shows the error
    const saved = await onUpdate(machine.id, editFormToUpdate(form));
    setIsSaving(false);
    if (!saved) return;
    setForm(withoutPasswordChange);
    setIsSaved(true);
  };

  const undo = () => {
    setForm(editFormFromMachine(machine));
    setIsSaved(false);
  };

  const remove = async () => {
    const accepted = await confirm(
      <Dialog variant="danger">
        <Dialog.Title>Remove {machine.name}?</Dialog.Title>
        <Dialog.Message>Chatter stops reading this machine and deletes its spindle speed history. You cannot undo this.</Dialog.Message>
        <Dialog.Actions>
          <Dialog.Dismiss>Keep the machine</Dialog.Dismiss>
          <Dialog.Confirm>Remove the machine</Dialog.Confirm>
        </Dialog.Actions>
      </Dialog>,
    );
    if (accepted) await onRemove();
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-5 p-4">
      <EditMachineForm
        machineType={machine.type}
        hasFtpPassword={machine.hasFtpPassword ?? false}
        hasOpcuaPassword={machine.type === 'siemens' ? machine.hasOpcuaPassword ?? false : false}
        form={form}
        setForm={setForm}
      />
      {isSaved && <Notice tone="success" title="The settings are saved" onClose={() => setIsSaved(false)} />}
      <div className="flex justify-end gap-2">
        <Button onClick={undo} disabled={isSaving}>Undo changes</Button>
        <Button type="submit" variant="primary" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save changes'}</Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-4">
        <div>
          <div className="font-bold">Remove this machine</div>
          <div className="text-[0.8125rem] text-zinc-200">Chatter stops reading it and deletes its spindle speed history.</div>
        </div>
        <Button variant="danger" onClick={remove}>Remove machine</Button>
      </div>
    </form>
  );
}
