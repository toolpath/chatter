import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import type { AlertRule } from '@local-chatter/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { RulesFileWriter, rulesFileText } from './rulesFile.js';

const highLoad: AlertRule = {
  id: 'r1', kind: 'simple', enabled: true, subject: 'spindle-load', check: 'above', limit: 90, forMinutes: 1, severity: 'warning',
};
const offline: AlertRule = {
  id: 'r2', kind: 'simple', enabled: true, subject: 'not-connected', check: 'above', limit: 0, forMinutes: 10, severity: 'critical',
};
const custom: AlertRule = {
  id: 'r3', kind: 'query', enabled: true, name: 'Odd: "name" #1', query: 'chatter_alarm{machine="$machine"} == 1', forMinutes: 0, severity: 'warning',
};

describe('rulesFileText', () => {
  it('makes one vmalert group for each machine, with the machine label on each rule', () => {
    const file = parse(rulesFileText(new Map([['haas_1', [highLoad, offline]], ['brother_2', [custom]]])));

    expect(file.groups).toEqual([
      {
        name: 'machine-haas_1',
        interval: '15s',
        rules: [
          {
            alert: 'Spindle load above 90%',
            expr: 'chatter_spindle_load{machine="haas_1"} > 90',
            for: '1m',
            labels: { machine: 'haas_1', severity: 'warning', rule_id: 'r1' },
            annotations: { summary: 'Spindle load is {{ $value }}%' },
          },
          {
            alert: 'Not connected',
            expr: 'chatter_connected{machine="haas_1"} == 0',
            for: '10m',
            labels: { machine: 'haas_1', severity: 'critical', rule_id: 'r2' },
            annotations: { summary: 'Not connected for 10 min or more' },
          },
        ],
      },
      {
        name: 'machine-brother_2',
        interval: '15s',
        rules: [
          {
            alert: 'Odd: "name" #1',
            expr: 'chatter_alarm{machine="brother_2"} == 1',
            for: '0m',
            labels: { machine: 'brother_2', severity: 'warning', rule_id: 'r3' },
            annotations: { summary: 'The query value is {{ $value }}' },
          },
        ],
      },
    ]);
  });

  it('leaves out rules that are off, and machines with no rule on', () => {
    const file = parse(rulesFileText(new Map([['haas_1', [{ ...highLoad, enabled: false }]]])));
    expect(file.groups).toEqual([]);
  });
});

describe('RulesFileWriter', () => {
  let folder: string;

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('makes the folder, writes the file and leaves no temp file', async () => {
    folder = path.join(await mkdtemp(path.join(os.tmpdir(), 'chatter-rules-')), 'alert-rules');
    const writer = new RulesFileWriter(folder);

    await writer.write('groups: []\n');
    await writer.write('groups: [] # again\n');

    expect(await readFile(writer.filePath, 'utf8')).toBe('groups: [] # again\n');
    expect(await readdir(folder)).toEqual(['rules.yml']);
  });
});
