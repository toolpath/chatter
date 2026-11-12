import { MAX_ALERT_RULES_PER_MACHINE } from '@local-chatter/shared';
import { useState } from 'react';
import { copyAlertRules, type CopiedRules } from '../../api/alertRules';
import { Button } from '../../components/ui/Button';
import { CloseButton } from '../../components/ui/CloseButton';
import { Modal } from '../../components/ui/Modal';
import { Notice } from '../../components/ui/Notice';
import type { Machine } from '../../types';

interface CopyRulesDialogProps {
  machineId: string;
  /** The machines that can get the rules: all machines but this one */
  otherMachines: Pick<Machine, 'id' | 'name'>[];
  /** Rules that are changed here but not saved. Copy uses the saved rules. */
  unsavedChanges: number;
  onClose: () => void;
}

/** Choose machines, and give them a copy of this machine's saved rules */
export function CopyRulesDialog({ machineId, otherMachines, unsavedChanges, onClose }: CopyRulesDialogProps) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [isCopying, setIsCopying] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const toggle = (id: string) => {
    setResult(null);
    setChosen(before => {
      const after = new Set(before);
      if (after.has(id)) after.delete(id);
      else after.add(id);
      return after;
    });
  };

  const copy = async () => {
    setIsCopying(true);
    try {
      setResult({ tone: 'success', text: copiedText(await copyAlertRules(machineId, [...chosen])) });
    } catch (error) {
      setResult({ tone: 'error', text: error instanceof Error ? error.message : 'Could not copy the alert rules' });
    } finally {
      setIsCopying(false);
    }
  };

  return (
    <Modal label="Copy rules to other machines" onClose={onClose}>
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-base font-bold">Copy rules to other machines</h2>
            <p className="m-0 mt-1 text-[0.8125rem] text-zinc-200">
              The machines get a copy of each rule. Their own rules stay. A rule that a machine already has is not copied again.
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        {unsavedChanges > 0 && (
          <Notice tone="info" title="Copy uses the saved rules">
            Save your changes first if you want to copy them.
          </Notice>
        )}
        {otherMachines.length === 0 ? (
          <p className="m-0 text-zinc-300">There are no other machines yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {otherMachines.map(machine => (
              <li key={machine.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-800">
                  <input
                    type="checkbox"
                    checked={chosen.has(machine.id)}
                    onChange={() => toggle(machine.id)}
                    disabled={isCopying}
                    className="size-4 accent-primary"
                  />
                  {machine.name}
                </label>
              </li>
            ))}
          </ul>
        )}
        {result && <Notice tone={result.tone} title={result.text} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={copy} disabled={isCopying || chosen.size === 0}>
            {isCopying ? 'Copying…' : `Copy to ${machineCountText(chosen.size)}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function machineCountText(count: number): string {
  return count === 1 ? '1 machine' : `${count} machines`;
}

function copiedText({ copied, notCopied }: CopiedRules): string {
  const copiedPart = copied === 0 && notCopied === 0
    ? 'The machines already have these rules. Nothing was copied.'
    : `${ruleCountText(copied)} copied.`;
  if (notCopied === 0) return copiedPart;
  return `${copiedPart} ${ruleCountText(notCopied)} not copied, because a machine can have at most ${MAX_ALERT_RULES_PER_MACHINE} rules.`;
}

function ruleCountText(count: number): string {
  return count === 1 ? '1 rule was' : `${count} rules were`;
}
