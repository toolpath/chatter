import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { CloseButton } from '../../components/ui/CloseButton';
import { Field, TextInput } from '../../components/ui/fields';
import { Notice } from '../../components/ui/Notice';
import { Panel } from '../../components/ui/Panel';
import { machineTypeLabel } from '../../machines/machineStatus';
import type { AddMachineRequest, FoundMachine, Machine } from '../../types';
import { errorMessageOf } from '../../utils/errorMessage';
import { foundKeyOf, isAlreadyAdded, rangeWords } from './foundMachines';
import { useNetworkScan, type NetworkScan } from './useNetworkScan';

type AddMachine = (machine: AddMachineRequest) => Promise<void>;

interface FindMachinesPanelProps {
  machines: Machine[];
  onAdd: AddMachine;
  /** Scan the guessed ranges at once, without a click (the first start) */
  autoStart: boolean;
  onClose?: () => void;
}

/** Looks for machines on the network, and adds the ones the user picks */
export function FindMachinesPanel({ machines, onAdd, autoStart, onClose }: FindMachinesPanelProps) {
  const scan = useNetworkScan(autoStart);
  const isScanning = scan.scanningRange !== null;
  const trimmedRange = scan.range.trim();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmedRange) scan.scan([trimmedRange]);
  };

  return (
    <Panel
      title="Find machines on the network"
      description="Chatter looks for Brother, Haas, MTConnect, FANUC and Siemens machines at their usual ports."
      actions={onClose && <CloseButton onClick={onClose} />}
    >
      <form onSubmit={handleSubmit} className="flex flex-wrap items-start gap-3 px-5 pt-4">
        <Field
          id="scan-range"
          label="Address range"
          hint="The first three numbers of the machine IP addresses. Chatter checks .1 to .254."
          className="w-72"
        >
          <TextInput
            id="scan-range"
            mono
            list="scan-range-guesses"
            placeholder="192.168.1"
            value={scan.range}
            onChange={event => scan.setRange(event.target.value)}
            aria-describedby="scan-range-hint"
            disabled={isScanning}
          />
        </Field>
        <datalist id="scan-range-guesses">
          {scan.guesses.map(range => <option key={range} value={range} />)}
        </datalist>
        <Button type="submit" variant="primary" disabled={isScanning || !trimmedRange} className="mt-5">
          {isScanning ? 'Scanning…' : 'Scan'}
        </Button>
      </form>
      <ScanResults scan={scan} machines={machines} onAdd={onAdd} />
    </Panel>
  );
}

interface ScanResultsProps {
  scan: NetworkScan;
  machines: Machine[];
  onAdd: AddMachine;
}

function ScanResults({ scan, machines, onAdd }: ScanResultsProps) {
  const { scanningRange, scannedRanges, found, error } = scan;
  const foundNothing = !scanningRange && scannedRanges.length > 0 && found.length === 0 && !error;
  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <p role="status" className="m-0 text-zinc-200">{scanMessage(scan)}</p>
      {error && <Notice tone="error" title={error} />}
      {found.length > 0 && (
        <ul className="m-0 flex list-none flex-col divide-y divide-zinc-800 rounded-lg border border-zinc-800 p-0">
          {found.map(foundMachine => (
            <FoundMachineRow
              key={foundKeyOf(foundMachine)}
              found={foundMachine}
              isAdded={isAlreadyAdded(foundMachine, machines)}
              onAdd={onAdd}
            />
          ))}
        </ul>
      )}
      {foundNothing && (
        <p className="m-0 text-zinc-300">Check that the machines are on. Or close this box, and click Add machine to type an IP address.</p>
      )}
    </div>
  );
}

function scanMessage({ scanningRange, scannedRanges, found }: NetworkScan): string {
  if (scanningRange) return `Looking at ${rangeWords(scanningRange)}. This can take up to 30 seconds.`;
  if (scannedRanges.length === 0) return 'Type an address range, then click Scan.';
  const scannedRangeList = scannedRanges.join(', ');
  if (found.length === 0) return `No new machines found in ${scannedRangeList}.`;
  const machineWord = found.length === 1 ? 'machine' : 'machines';
  return `Found ${found.length} ${machineWord} in ${scannedRangeList}. Check the names, then add the ones you want.`;
}

interface FoundMachineRowProps {
  found: FoundMachine;
  isAdded: boolean;
  onAdd: AddMachine;
}

function FoundMachineRow({ found, isAdded, onAdd }: FoundMachineRowProps) {
  const [name, setName] = useState(found.machine.name);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const address = foundKeyOf(found);
  const nameId = `found-${address}-name`;

  const addFoundMachine = async () => {
    setIsAdding(true);
    setError(null);
    try {
      await onAdd({ ...found.machine, name: name.trim() || found.machine.name });
    } catch (err) {
      setError(errorMessageOf(err, 'Could not add the machine'));
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-60 flex-1 flex-col gap-1">
        <label htmlFor={nameId} className="sr-only">Name of the machine at {address}</label>
        <TextInput id={nameId} className="max-w-sm" value={name} onChange={event => setName(event.target.value)} disabled={isAdded || isAdding} />
        <span className="text-xs text-zinc-300">
          {machineTypeLabel(found.machine.type)} · <span className="font-mono">{address}</span> · {found.detail}
        </span>
        {error && <span role="alert" className="text-xs text-alarm-soft">{error}</span>}
      </div>
      {!found.isConfirmed && (
        <span className="rounded bg-idle/15 px-1.5 py-0.5 text-xs font-semibold text-idle-text">Not checked</span>
      )}
      {isAdded ? (
        <span className="min-w-24 text-center font-semibold text-primary-text">Added</span>
      ) : (
        <Button variant="secondary" onClick={addFoundMachine} disabled={isAdding} className="min-w-24">
          {isAdding ? 'Adding…' : 'Add'}
        </Button>
      )}
    </li>
  );
}
