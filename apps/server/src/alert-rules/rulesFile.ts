import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { ALERT_SUBJECTS, ruleName, ruleQuery, type AlertRule } from '@local-chatter/shared';

/** The file in the shared folder. vmalert reads every .yml file in that folder. */
export const RULES_FILE_NAME = 'rules.yml';
/** vmalert checks the rules this often */
const CHECK_INTERVAL = '15s';

const HEADER = [
  '# Chatter makes this file from the alert rules on each machine page.',
  '# Do not change it here: Chatter writes it again after each change and at each start.',
  '',
].join('\n');

interface VmalertRule {
  alert: string;
  expr: string;
  for: string;
  labels: Record<string, string>;
  annotations: { summary: string };
}

/**
 * The vmalert rules file: one group for each machine, with the rules that are on.
 * The "machine" label puts each alert on the page of its machine, also when a custom query drops that label.
 * It is YAML made by a library, so a rule name with odd characters cannot break the file.
 */
export function rulesFileText(rulesByMachine: Map<string, AlertRule[]>): string {
  const groups = [...rulesByMachine]
    .map(([machineId, rules]) => ({
      name: `machine-${machineId}`,
      interval: CHECK_INTERVAL,
      rules: rules.filter(rule => rule.enabled).map(rule => vmalertRule(rule, machineId)),
    }))
    .filter(group => group.rules.length > 0);
  return HEADER + stringify({ groups });
}

function vmalertRule(rule: AlertRule, machineId: string): VmalertRule {
  return {
    alert: ruleName(rule),
    expr: ruleQuery(rule, machineId),
    for: `${rule.forMinutes}m`,
    labels: { machine: machineId, severity: rule.severity, rule_id: rule.id },
    annotations: { summary: summaryOf(rule) },
  };
}

/** The text under the alert name in the Alerts panel. vmalert puts the value in place of {{ $value }}. */
function summaryOf(rule: AlertRule): string {
  if (rule.kind === 'query') return 'The query value is {{ $value }}';
  const subject = ALERT_SUBJECTS[rule.subject];
  if (subject.kind === 'value') return `${subject.name} is {{ $value }}${subject.unitSuffix}`;
  return rule.forMinutes > 0 ? `${subject.name} for ${rule.forMinutes} min or more` : subject.name;
}

/** Writes the rules file in the folder that vmalert also reads */
export class RulesFileWriter {
  constructor(private readonly folder: string) {}

  get filePath(): string {
    return path.join(this.folder, RULES_FILE_NAME);
  }

  /**
   * First a temp file, then a rename, so vmalert never reads half a file.
   * The temp name does not end in .yml, so vmalert does not read it.
   */
  async write(text: string): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    const tempPath = path.join(this.folder, `.${RULES_FILE_NAME}.${process.pid}.tmp`);
    await writeFile(tempPath, text, 'utf8');
    await rename(tempPath, this.filePath);
  }
}
