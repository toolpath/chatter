import { Menu } from '@toolpath/ui';
import { useState, type ComponentProps } from 'react';
import { useCan } from '../../components/CurrentUser';
import { Button } from '../../components/ui/Button';
import { DocsLink } from '../../components/ui/DocsLink';
import { ChevronDownIcon, PlusIcon } from '../../components/ui/icons';
import { Notice } from '../../components/ui/Notice';
import type { Machine } from '../../types';
import { AlertRuleRow } from './AlertRuleRow';
import { CopyRulesDialog } from './CopyRulesDialog';
import type { AlertRules } from './useAlertRules';

interface AlertRulesTabProps {
  machineId: string;
  otherMachines: Pick<Machine, 'id' | 'name'>[];
  rules: AlertRules;
}

/** The alert rules of one machine, as sentences. An admin changes the words, then clicks Save changes. */
export function AlertRulesTab({ machineId, otherMachines, rules }: AlertRulesTabProps) {
  const canChange = useCan('manage-machines');
  const [isCopyOpen, setIsCopyOpen] = useState(false);

  if (rules.failed) {
    return (
      <div className="flex flex-wrap items-center gap-3 p-4">
        <p className="m-0 text-alarm-soft">Could not load the alert rules.</p>
        <Button size="sm" onClick={rules.reload}>Try again</Button>
      </div>
    );
  }
  if (!rules.saved) return <p className="m-0 p-4 text-zinc-300">Loading the alert rules…</p>;

  const problemOf = (key: string) => (rules.problem?.key === key ? rules.problem.message : null);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[0.8125rem] text-zinc-200">
          Chatter checks these rules for this machine every 15 seconds.
          {canChange ? ' Click a word in a rule to change it.' : ' Only an admin can change them.'}
          {' '}<DocsLink page="guide/alerts">How alert rules work</DocsLink>
        </p>
        {canChange && (
          <div className="flex gap-2">
            <Button onClick={() => setIsCopyOpen(true)}>Copy rules to other machines</Button>
            <AddRuleMenu onAdd={rules.add} />
          </div>
        )}
      </div>

      {rules.draft.length === 0 ? (
        <p className="m-0 rounded-lg border border-dashed border-zinc-700 px-3 py-4 text-center text-zinc-300">
          This machine has no alert rules.{canChange && ' Click + Add rule to make one.'}
        </p>
      ) : (
        <ul aria-label="Alert rules" className="m-0 flex list-none flex-col gap-2 p-0">
          {rules.draft.map(rule => (
            <AlertRuleRow
              key={rule.key}
              rule={rule}
              canChange={canChange}
              problem={problemOf(rule.key)}
              machineId={machineId}
              onChange={patch => rules.change(rule.key, patch)}
              onRemove={() => rules.remove(rule.key)}
              onMakeCustomQuery={() => rules.makeCustomQuery(rule.key)}
            />
          ))}
        </ul>
      )}

      {rules.problem && rules.problem.key === null && <Notice tone="error" title={rules.problem.message} />}
      <SaveNotice rules={rules} />
      {canChange && rules.changes > 0 && <SaveBar rules={rules} />}

      {isCopyOpen && (
        <CopyRulesDialog
          machineId={machineId}
          otherMachines={otherMachines}
          unsavedChanges={rules.changes}
          onClose={() => setIsCopyOpen(false)}
        />
      )}
    </div>
  );
}

/** "+ Add rule", with a choice of a simple rule or a custom query */
function AddRuleMenu({ onAdd }: { onAdd: (kind: 'simple' | 'query') => void }) {
  const renderButton = (props: ComponentProps<'button'>) => <Button variant="primary" {...props} />;
  return (
    <Menu>
      <Menu.Trigger nativeButton render={renderButton}>
        <PlusIcon size={14} />
        Add rule
        <ChevronDownIcon size={14} />
      </Menu.Trigger>
      <Menu.Popover align="end" sideOffset={4} className="min-w-56 py-1 shadow-lg">
        <Menu.Item onClick={() => onAdd('simple')} className="flex-col items-start gap-0.5 px-3 py-2">
          <span className="text-sm font-bold">Simple rule</span>
          <span className="text-xs text-zinc-300">Choose the words, for example spindle load above 90%</span>
        </Menu.Item>
        <Menu.Item onClick={() => onAdd('query')} className="flex-col items-start gap-0.5 px-3 py-2">
          <span className="text-sm font-bold">Custom query</span>
          <span className="text-xs text-zinc-300">Write your own MetricsQL query</span>
        </Menu.Item>
      </Menu.Popover>
    </Menu>
  );
}

function SaveNotice({ rules }: { rules: AlertRules }) {
  if (!rules.notice) return null;
  const isLate = rules.notice === 'saved-vmalert-late';
  return (
    <Notice tone="success" title="The alert rules are saved" onClose={rules.clearNotice}>
      {isLate && 'vmalert did not answer now. It reads the new rules within 30 seconds.'}
    </Notice>
  );
}

/** "1 rule changed, not saved yet", with Undo changes and Save changes */
function SaveBar({ rules }: { rules: AlertRules }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2">
      <span className="text-sm font-semibold">
        {rules.changes === 1 ? '1 rule changed' : `${rules.changes} rules changed`}, not saved yet
      </span>
      <div className="flex gap-2">
        <Button onClick={rules.undo} disabled={rules.isSaving}>Undo changes</Button>
        <Button variant="primary" onClick={() => void rules.save()} disabled={rules.isSaving}>
          {rules.isSaving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
