import {
  ALERT_CHECKS,
  ALERT_SUBJECT_IDS,
  ALERT_SUBJECTS,
  MACHINE_PLACEHOLDER,
  MAX_ALERT_NAME_LENGTH,
  MAX_ALERT_QUERY_LENGTH,
  ruleName,
  ruleQuery,
  type AlertCheck,
  type AlertSeverity,
  type AlertSubject,
} from '@local-chatter/shared';
import { cn, Switch } from '@toolpath/ui';
import { useId, useState } from 'react';
import { testAlertQuery, type QueryCheck } from '../../api/alertRules';
import { Button } from '../../components/ui/Button';
import { ChoiceMenu, type Choice } from '../../components/ui/ChoiceMenu';
import { DocsLink } from '../../components/ui/DocsLink';
import { Field, TextInput } from '../../components/ui/fields';
import { TrashIcon } from '../../components/ui/icons';
import { canBeCustomQuery, subjectPatch, type DraftRule, type RulePatch } from './alertRulesDraft';

type SimpleDraft = Extract<DraftRule, { kind: 'simple' }>;
type QueryDraft = Extract<DraftRule, { kind: 'query' }>;

const SUBJECT_CHOICES: Choice<AlertSubject>[] = ALERT_SUBJECT_IDS.map(id => ({ id, name: ALERT_SUBJECTS[id].name.toLowerCase() }));
const CHECK_CHOICES: Choice<AlertCheck>[] = ALERT_CHECKS.map(id => ({ id, name: id }));
const SEVERITY_CHOICES: Choice<AlertSeverity>[] = [
  { id: 'warning', name: 'warning' },
  { id: 'critical', name: 'critical alert' },
];
const SEVERITY_COLORS: Record<AlertSeverity, string> = { warning: 'text-idle-text', critical: 'text-alarm-soft' };

export interface AlertRuleRowProps {
  rule: DraftRule;
  /** The reason this rule cannot be saved, shown under it */
  problem: string | null;
  machineId: string;
  onChange: (patch: RulePatch) => void;
  onRemove: () => void;
  onMakeCustomQuery: () => void;
}

/** One rule: an on/off switch, the rule, and a trash button */
export function AlertRuleRow(props: AlertRuleRowProps) {
  const { rule, problem, onChange, onRemove } = props;
  const nameId = useId();
  const name = ruleName({ ...rule, id: rule.id ?? '' });
  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-lg border bg-zinc-950/40 px-3 py-2.5',
        problem ? 'border-alarm' : 'border-zinc-800',
        !rule.enabled && 'opacity-60',
      )}
    >
      <span id={nameId} className="sr-only">{name}</span>
      <div className="pt-1">
        <Switch
          aria-labelledby={nameId}
          checked={rule.enabled}
          onCheckedChange={enabled => onChange({ enabled })}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {rule.kind === 'simple' ? <SimpleRule {...props} rule={rule} /> : <QueryRule {...props} rule={rule} />}
        {problem && <p role="alert" className="m-0 text-[0.8125rem] text-alarm-soft">{problem}</p>}
      </div>
      <Button variant="quiet" size="icon" aria-label={`Remove the rule ${name}`} onClick={onRemove}>
        <TrashIcon />
      </Button>
    </li>
  );
}

/** The words before the subject */
const SENTENCE_STARTS = { value: 'When this machine has', state: 'When this machine is', event: 'When this machine reports' } as const;

/**
 * "When this machine has [spindle load] [above] [90]% for [1] min, raise a [warning]."
 * An event has no minutes: "When this machine reports [program ended], raise a [warning]."
 */
function SimpleRule({ rule, onChange, onMakeCustomQuery }: AlertRuleRowProps & { rule: SimpleDraft }) {
  const subject = ALERT_SUBJECTS[rule.subject];
  return (
    <>
      <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-7 text-zinc-100">
        {SENTENCE_STARTS[subject.kind]}
        <ChoiceMenu
          label="What to check" choices={SUBJECT_CHOICES} value={rule.subject}
          onChoose={id => onChange(subjectPatch(rule, id))}
        />
        {subject.kind === 'value' && (
          <>
            <ChoiceMenu label="Above or below" choices={CHECK_CHOICES} value={rule.check} onChoose={check => onChange({ check })} />
            <NumberBox label="Limit" value={rule.limit} wide onChange={limit => onChange({ limit })} />
            <span className={cn(subject.unitSuffix === '%' && '-ml-1')}>{subject.unitSuffix.trim()}</span>
          </>
        )}
        {subject.kind === 'event' ? (
          <>
            <span className="-ml-1">,</span>
            <Severity rule={rule} onChange={onChange} />
          </>
        ) : (
          <>
            for
            <MinutesAndSeverity rule={rule} onChange={onChange} />
          </>
        )}
      </p>
      <ExpertQuery rule={rule} onMakeCustomQuery={onMakeCustomQuery} />
    </>
  );
}

/** "[1] min, raise a [warning]." The end of every rule. */
function MinutesAndSeverity({ rule, onChange }: Pick<AlertRuleRowProps, 'onChange'> & { rule: DraftRule }) {
  return (
    <>
      <NumberBox label="Minutes" value={rule.forMinutes} onChange={forMinutes => onChange({ forMinutes })} />
      {'min, '}
      <Severity rule={rule} onChange={onChange} />
    </>
  );
}

/** "raise a [warning]." */
function Severity({ rule, onChange }: Pick<AlertRuleRowProps, 'onChange'> & { rule: DraftRule }) {
  return (
    <>
      raise a
      <ChoiceMenu
        label="Level" choices={SEVERITY_CHOICES} value={rule.severity}
        onChoose={severity => onChange({ severity })} className={SEVERITY_COLORS[rule.severity]}
      />
      <span className="-ml-1">.</span>
    </>
  );
}

/** The query that Chatter makes from the words. An admin can turn it into a custom query, to change it. */
function ExpertQuery({ rule, onMakeCustomQuery }: Pick<AlertRuleRowProps, 'onMakeCustomQuery'> & { rule: SimpleDraft }) {
  const query = ruleQuery({ ...rule, id: rule.id ?? '' }, MACHINE_PLACEHOLDER);
  return (
    <details className="text-xs text-zinc-300">
      <summary className="w-fit cursor-pointer hover:text-zinc-100">Expert: show the query</summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="rounded bg-zinc-950 px-2 py-1 font-mono text-zinc-100">{query}</code>
        {canBeCustomQuery(rule) ? (
          <Button size="sm" variant="quiet" onClick={onMakeCustomQuery}>Change to a custom query</Button>
        ) : (
          <span>An event rule cannot change to a custom query. A custom query sends an &quot;OK&quot; message after each event.</span>
        )}
      </div>
    </details>
  );
}

/** A rule with a query that the user wrote: a name, the query, a Test button, the minutes and the level */
function QueryRule({ rule, problem, machineId, onChange }: AlertRuleRowProps & { rule: QueryDraft }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-bold">Custom query</span>
        {rule.name.trim() && <span className="text-zinc-300">{rule.name.trim()}</span>}
      </div>
      <Field id={`${id}-name`} label="Name">
        <TextInput
          id={`${id}-name`} value={rule.name} placeholder="For example: Slow spindle" maxLength={MAX_ALERT_NAME_LENGTH}
          onChange={event => onChange({ name: event.target.value })}
        />
      </Field>
      <Field id={`${id}-query`} label="Query" hint={<QueryHint />}>
        {/* The test result wraps to its own line under the box */}
        <div className="flex flex-wrap gap-2">
          <TextInput
            id={`${id}-query`} mono value={rule.query} maxLength={MAX_ALERT_QUERY_LENGTH} spellCheck={false} className="min-w-0 flex-1"
            aria-describedby={`${id}-query-hint`} onChange={event => onChange({ query: event.target.value })}
          />
          <TestQueryButton machineId={machineId} query={rule.query} hideResult={problem !== null} />
        </div>
      </Field>
      <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-7 text-zinc-100">
        When the query gives a result for
        <MinutesAndSeverity rule={rule} onChange={onChange} />
      </p>
    </div>
  );
}

/** The hint under the query box, with a link to the docs page of examples */
function QueryHint() {
  return (
    <>
      {MACHINE_PLACEHOLDER} stands for this machine. The alert fires while the query gives a result.{' '}
      <DocsLink page="guide/custom-alert-queries">How to write a query, with examples</DocsLink>
    </>
  );
}

interface TestQueryButtonProps {
  machineId: string;
  query: string;
  /** True while the row shows why it cannot be saved. That text often says the same. */
  hideResult: boolean;
}

/** Runs the query once on VictoriaMetrics, and tells what came back */
function TestQueryButton({ machineId, query, hideResult }: TestQueryButtonProps) {
  const [result, setResult] = useState<{ query: string; check: QueryCheck } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const test = async () => {
    setIsTesting(true);
    try {
      setResult({ query, check: await testAlertQuery(machineId, query) });
    } catch (error) {
      setResult({ query, check: { ok: false, error: error instanceof Error ? error.message : 'Could not test the query' } });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <>
      <Button onClick={test} disabled={isTesting || !query.trim()}>{isTesting ? 'Testing…' : 'Test'}</Button>
      {/* The result is about the query that was tested. It goes away when the query changes. */}
      {result && result.query === query && !hideResult && <QueryCheckText check={result.check} />}
    </>
  );
}

function QueryCheckText({ check }: { check: QueryCheck }) {
  const text = !check.ok
    ? check.error
    : check.resultCount === 0
      ? 'Now: no result, so the alert does not fire now.'
      : `Now: ${check.resultCount} ${check.resultCount === 1 ? 'result' : 'results'}, first value ${check.firstValue ?? '–'}. The alert fires.`;
  return (
    <p role="status" className={cn('m-0 basis-full text-[0.8125rem]', check.ok ? 'text-zinc-200' : 'text-alarm-soft')}>
      {text}
    </p>
  );
}

interface NumberBoxProps {
  label: string;
  value: number;
  /** For a limit such as 10000 RPM */
  wide?: boolean;
  onChange: (value: number) => void;
}

/** A small number box in the rule. An empty box gives NaN, so the check before Save finds it. */
function NumberBox({ label, value, wide = false, onChange }: NumberBoxProps) {
  return (
    <input
      type="number"
      aria-label={label}
      value={Number.isNaN(value) ? '' : value}
      onChange={event => onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))}
      className={cn(
        'h-6 rounded border border-zinc-700 bg-zinc-950 px-1 text-center font-mono text-sm font-bold text-zinc-50',
        'hover:border-zinc-500',
        wide ? 'w-20' : 'w-12',
      )}
    />
  );
}
