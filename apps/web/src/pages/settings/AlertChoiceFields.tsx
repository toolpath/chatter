import { ALERT_SEVERITIES, type AlertSeverity } from '@local-chatter/shared';
import { Field, SelectInput } from '../../components/ui/fields';
import type { ChannelFormState } from './channelFormState';
import { LEVEL_LABELS, machineNameOf, type MachineName } from './notificationLabels';

interface AlertChoiceFieldsProps {
  form: ChannelFormState;
  machines: MachineName[];
  onChange: (form: ChannelFormState) => void;
}

/** Which alerts the channel gets: the level, and all machines or only some */
export function AlertChoiceFields({ form, machines, onChange }: AlertChoiceFieldsProps) {
  const isPicking = form.machineIds !== null;
  const picked = form.machineIds ?? [];
  const choices = choicesOf(machines, picked);
  const setPicked = (id: string, isPicked: boolean) => onChange({
    ...form, machineIds: isPicked ? [...picked, id] : picked.filter(entry => entry !== id),
  });

  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 border-t border-zinc-800 p-0 pt-4">
      <legend className="float-left mb-1 p-0 text-sm font-bold">Which alerts</legend>
      <Field id="channel-level" label="Level" hint="Each alert sends 2 messages: one when it starts, and one when it ends.">
        <SelectInput
          id="channel-level"
          value={form.minSeverity}
          aria-describedby="channel-level-hint"
          onChange={event => onChange({ ...form, minSeverity: event.target.value as AlertSeverity })}
        >
          {ALERT_SEVERITIES.map(level => <option key={level} value={level}>{LEVEL_LABELS[level]}</option>)}
        </SelectInput>
      </Field>
      <div role="radiogroup" aria-label="Machines" className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-zinc-300">Machines</span>
        <Choice type="radio" name="channel-machines" label="All machines, also the machines that you add later" checked={!isPicking} onChange={() => onChange({ ...form, machineIds: null })} />
        <Choice type="radio" name="channel-machines" label="Pick machines" checked={isPicking} onChange={() => onChange({ ...form, machineIds: picked })} />
        {isPicking && (
          <div className="ml-6 flex flex-col gap-2">
            {choices.length === 0 && <span className="text-xs text-zinc-300">Chatter has no machines yet.</span>}
            {choices.map(machine => (
              <Choice
                key={machine.id}
                type="checkbox"
                label={machine.name}
                checked={picked.includes(machine.id)}
                onChange={isPicked => setPicked(machine.id, isPicked)}
              />
            ))}
          </div>
        )}
      </div>
    </fieldset>
  );
}

/** The machines of Chatter. A picked machine that someone removed stays in the list, until the admin takes it out. */
function choicesOf(machines: MachineName[], picked: string[]): MachineName[] {
  const removed = picked.filter(id => !machines.some(machine => machine.id === id));
  return [...machines, ...removed.map(id => ({ id, name: machineNameOf(id, machines) }))];
}

interface ChoiceProps {
  type: 'radio' | 'checkbox';
  name?: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Choice({ type, name, label, checked, onChange }: ChoiceProps) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type={type} name={name} className="size-4 accent-primary" checked={checked} onChange={event => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
