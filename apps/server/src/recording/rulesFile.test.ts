import { readFileSync } from 'node:fs';
import { HISTORY_VALUES } from '@local-chatter/shared';
import { describe, expect, it } from 'vitest';
import { historyMetricName } from './metricLines.js';
import { minuteAverageName } from './MetricsReader.js';

const RULES_FILE = new URL('../../../../vmalert/rules.yml', import.meta.url);

describe('vmalert/rules.yml', () => {
  const rules = readFileSync(RULES_FILE, 'utf8');

  it.each(HISTORY_VALUES)('saves the minute averages that the history route reads: %s', value => {
    const metric = historyMetricName(value);

    expect(rules).toContain(`- record: ${minuteAverageName(metric)}\n        expr: avg_over_time(${metric}[1m])`);
  });
});
