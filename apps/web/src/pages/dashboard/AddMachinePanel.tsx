import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { CloseButton } from '../../components/ui/CloseButton';
import { Field, SelectInput, TextInput } from '../../components/ui/fields';
import { InfoTip } from '../../components/ui/InfoTip';
import { Notice } from '../../components/ui/Notice';
import { Panel } from '../../components/ui/Panel';
import { machineTypeLabel } from '../../machines/machineStatus';
import { isValidIPv4, type AddMachineRequest, type SupportedMachineType } from '../../types';
import { fetchFocasStatus } from '../../api/focasLibrary';
import { FocasLibrary } from '../settings/FocasLibrary';
import { useServerReport } from '../settings/useServerReport';
import { errorMessageOf } from '../../utils/errorMessage';

const MACHINE_TYPES: SupportedMachineType[] = ['brother', 'haas', 'mtconnect', 'fanuc', 'siemens'];
const DEFAULT_MACHINE_TYPE: SupportedMachineType = 'brother';

/** Why FANUC is gray in the list of machine types */
export const NO_FANUC_HERE = 'This computer cannot run the FANUC FOCAS2 library, so Chatter cannot read FANUC machines.';

interface AddMachinePanelProps {
  onAdd: (machine: AddMachineRequest) => Promise<void>;
  onClose: () => void;
}

/** The problem with the typed values, or null when they are good */
function addMachineProblem(name: string, host: string): string | null {
  if (!name || !host) return 'Type a name and an IP address';
  if (!isValidIPv4(host)) return 'Type the IP address as 4 numbers, for example 192.168.1.50';
  return null;
}

/**
 * False only when the server says that it cannot run the FANUC library.
 * When the status does not load, FANUC stays on: the server still checks the machine.
 */
function useCanReadFanuc(): boolean {
  const { report } = useServerReport(fetchFocasStatus);
  return !report?.problem;
}

/** The form that adds a machine. The ports and the FTP login are set later, on the machine page. */
export function AddMachinePanel({ onAdd, onClose }: AddMachinePanelProps) {
  const [machineType, setMachineType] = useState<SupportedMachineType>(DEFAULT_MACHINE_TYPE);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canReadFanuc = useCanReadFanuc();

  // The FANUC status can arrive after the user picked FANUC
  useEffect(() => {
    if (!canReadFanuc && machineType === 'fanuc') setMachineType(DEFAULT_MACHINE_TYPE);
  }, [canReadFanuc, machineType]);

  const trimmedName = name.trim();
  const trimmedHost = host.trim();
  const showHostProblem = trimmedHost !== '' && !isValidIPv4(trimmedHost);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = addMachineProblem(trimmedName, trimmedHost);
    setError(problem);
    if (problem) return;

    setIsSubmitting(true);
    try {
      await onAdd({ type: machineType, name: trimmedName, host: trimmedHost });
      onClose();
    } catch (err) {
      setError(errorMessageOf(err, 'Could not add the machine'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Panel
      title="Add a machine"
      description="You can set the ports and the FTP login on the machine page after this."
      actions={<CloseButton onClick={onClose} />}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-5 py-4">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(12.5rem,1fr))] gap-3.5">
          <Field id="machine-type" label="Machine type">
            <div className="flex items-center gap-1">
              <SelectInput
                id="machine-type"
                className="min-w-0 flex-1"
                value={machineType}
                onChange={event => setMachineType(event.target.value as SupportedMachineType)}
                disabled={isSubmitting}
              >
                {MACHINE_TYPES.map(type => (
                  <MachineTypeOption key={type} type={type} offReason={type === 'fanuc' && !canReadFanuc ? NO_FANUC_HERE : undefined} />
                ))}
              </SelectInput>
              {!canReadFanuc && <InfoTip label="Why FANUC is gray" opensTo="left">{NO_FANUC_HERE}</InfoTip>}
            </div>
          </Field>
          <Field id="machine-name" label="Machine name">
            <TextInput
              id="machine-name"
              placeholder="Speedio S300"
              value={name}
              onChange={event => setName(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </Field>
          <Field id="machine-host" label="IP address" hint={showHostProblem ? 'This is not an IP address yet' : undefined}>
            <TextInput
              id="machine-host"
              mono
              placeholder="192.168.1.50"
              value={host}
              onChange={event => setHost(event.target.value)}
              disabled={isSubmitting}
              aria-invalid={showHostProblem}
              aria-describedby={showHostProblem ? 'machine-host-hint' : undefined}
              required
            />
          </Field>
        </div>
        {machineType === 'fanuc' && (
          <section aria-label="FANUC library" className="border-t border-zinc-800 pt-4">
            <FocasLibrary />
          </section>
        )}
        {error && <Notice tone="error" title={error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Adding…' : 'Add machine'}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * One machine type in the list. With a reason, it is gray: this computer cannot read that type.
 * Most browsers show no hover text on a list item, so the form also has an "i" button with the reason.
 */
function MachineTypeOption({ type, offReason }: { type: SupportedMachineType; offReason?: string }) {
  return (
    <option value={type} disabled={Boolean(offReason)} title={offReason}>
      {machineTypeLabel(type)}
    </option>
  );
}
