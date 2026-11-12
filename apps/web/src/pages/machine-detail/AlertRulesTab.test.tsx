import type { AlertRule, Role } from '@local-chatter/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copyAlertRules, fetchAlertRules, RuleSaveError, saveAlertRules, testAlertQuery } from '../../api/alertRules';
import { CurrentUserContext } from '../../components/CurrentUser';
import { AlertRulesTab } from './AlertRulesTab';
import { useAlertRules } from './useAlertRules';

vi.mock('../../api/alertRules', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/alertRules')>()),
  fetchAlertRules: vi.fn(),
  saveAlertRules: vi.fn(),
  copyAlertRules: vi.fn(),
  testAlertQuery: vi.fn(),
}));

// jsdom has no PointerEvent, and the Switch of the Toolpath UI package makes one on a click
globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent;

const OFFLINE: AlertRule = {
  id: 'r1', kind: 'simple', enabled: true, subject: 'not-connected', check: 'above', limit: 0, forMinutes: 10, severity: 'warning',
};
const HIGH_LOAD: AlertRule = {
  id: 'r2', kind: 'simple', enabled: true, subject: 'spindle-load', check: 'above', limit: 90, forMinutes: 1, severity: 'warning',
};
const OTHER_MACHINES = [{ id: 'm2', name: 'Brother 2' }, { id: 'm3', name: 'Haas 3' }];

function Tab() {
  const rules = useAlertRules('m1');
  return <AlertRulesTab machineId="m1" otherMachines={OTHER_MACHINES} rules={rules} />;
}

async function renderTab(rules: AlertRule[] = [OFFLINE, HIGH_LOAD], role: Role = 'admin') {
  vi.mocked(fetchAlertRules).mockResolvedValue(rules);
  render(
    <CurrentUserContext.Provider value={{ username: 'sam', role }}>
      <Tab />
    </CurrentUserContext.Provider>,
  );
  await screen.findByText(/Chatter checks these rules/);
}

const limitBox = () => screen.getByRole('spinbutton', { name: 'Limit' });

describe('AlertRulesTab', () => {
  beforeEach(() => {
    vi.mocked(saveAlertRules).mockReset();
    vi.mocked(copyAlertRules).mockReset();
    vi.mocked(testAlertQuery).mockReset();
  });

  it('shows each rule as a sentence', async () => {
    await renderTab();

    const rows = within(screen.getByRole('list', { name: 'Alert rules' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('When this machine is');
    expect(rows[0]).toHaveTextContent('not connected');
    expect(rows[1]).toHaveTextContent('When this machine has');
    expect(limitBox()).toHaveValue(90);
  });

  it('links to the alerts docs', async () => {
    await renderTab();

    expect(screen.getByRole('link', { name: 'How alert rules work' }))
      .toHaveAttribute('href', expect.stringMatching(/\/guide\/alerts$/));
  });

  it('links a custom query to the docs page with the examples', async () => {
    await renderTab([{ id: 'q1', kind: 'query', enabled: true, name: 'Slow', query: 'chatter_running{machine="$machine"} == 0', forMinutes: 2, severity: 'warning' }]);

    expect(screen.getByRole('link', { name: 'How to write a query, with examples' }))
      .toHaveAttribute('href', expect.stringMatching(/\/guide\/custom-alert-queries$/));
  });

  it('counts a change, and saves the whole list', async () => {
    await renderTab();
    vi.mocked(saveAlertRules).mockResolvedValue({ rules: [OFFLINE, { ...HIGH_LOAD, limit: 80 }], vmalertReloaded: true });

    fireEvent.change(limitBox(), { target: { value: '80' } });
    expect(screen.getByText('1 rule changed, not saved yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('The alert rules are saved')).toBeInTheDocument();
    expect(saveAlertRules).toHaveBeenCalledWith('m1', [OFFLINE, { ...HIGH_LOAD, limit: 80 }]);
    expect(screen.queryByText(/not saved yet/)).not.toBeInTheDocument();
  });

  it('puts the words back on Undo changes', async () => {
    await renderTab();

    fireEvent.change(limitBox(), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo changes' }));

    expect(limitBox()).toHaveValue(90);
    expect(screen.queryByText(/not saved yet/)).not.toBeInTheDocument();
  });

  it('removes a rule and turns a rule off', async () => {
    await renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Remove the rule Not connected' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Spindle load above 90%' }));

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('switch', { name: 'Spindle load above 90%' })).not.toBeChecked();
    expect(screen.getByText('2 rules changed, not saved yet')).toBeInTheDocument();
  });

  it('does not save an empty limit, and tells which rule is wrong', async () => {
    await renderTab();

    fireEvent.change(limitBox(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Fill in the limit.');
    expect(saveAlertRules).not.toHaveBeenCalled();
  });

  it('shows the reason when the server refuses a custom query', async () => {
    await renderTab([]);
    vi.mocked(saveAlertRules).mockRejectedValue(new RuleSaveError('VictoriaMetrics refused the query: bad syntax', 0));

    fireEvent.click(screen.getByRole('button', { name: /Add rule/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Custom query/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('VictoriaMetrics refused the query: bad syntax');
  });

  it('tests a custom query and tells what came back', async () => {
    await renderTab([{ id: 'q1', kind: 'query', enabled: true, name: 'Slow', query: 'chatter_spindle_speed{machine="$machine"} < 500', forMinutes: 2, severity: 'critical' }]);
    vi.mocked(testAlertQuery).mockResolvedValue({ ok: true, resultCount: 1, firstValue: 120 });

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    expect(await screen.findByText('Now: 1 result, first value 120. The alert fires.')).toBeInTheDocument();
    expect(testAlertQuery).toHaveBeenCalledWith('m1', 'chatter_spindle_speed{machine="$machine"} < 500');
  });

  it('turns a simple rule into a custom query with the same check', async () => {
    await renderTab([HIGH_LOAD]);

    fireEvent.click(screen.getByText('Expert: show the query'));
    expect(screen.getByText('chatter_spindle_load{machine="$machine"} > 90')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change to a custom query' }));

    expect(screen.getByRole('textbox', { name: 'Query' })).toHaveValue('chatter_spindle_load{machine="$machine"} > 90');
  });

  it('copies the saved rules to the chosen machines', async () => {
    await renderTab();
    vi.mocked(copyAlertRules).mockResolvedValue({ copied: 2, notCopied: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'Copy rules to other machines' }));
    const dialog = await screen.findByRole('dialog', { name: 'Copy rules to other machines' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Haas 3' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy to 1 machine' }));

    expect(await within(dialog).findByText('2 rules were copied.')).toBeInTheDocument();
    expect(copyAlertRules).toHaveBeenCalledWith('m1', ['m3']);
  });

  it('tells how many rules were not copied because a machine was full', async () => {
    await renderTab();
    vi.mocked(copyAlertRules).mockResolvedValue({ copied: 1, notCopied: 2 });

    fireEvent.click(screen.getByRole('button', { name: 'Copy rules to other machines' }));
    const dialog = await screen.findByRole('dialog', { name: 'Copy rules to other machines' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Brother 2' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy to 1 machine' }));

    expect(await within(dialog).findByText(
      '1 rule was copied. 2 rules were not copied, because a machine can have at most 50 rules.',
    )).toBeInTheDocument();
  });

  it('shows a viewer the rules, with nothing to change', async () => {
    await renderTab(undefined, 'viewer');

    expect(screen.getByText(/Only an admin can change them/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add rule/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove the rule/ })).not.toBeInTheDocument();
    expect(limitBox()).toBeDisabled();
  });

  it('offers to try again when the rules do not load', async () => {
    vi.mocked(fetchAlertRules).mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([OFFLINE]);
    render(
      <CurrentUserContext.Provider value={{ username: 'sam', role: 'admin' }}>
        <Tab />
      </CurrentUserContext.Provider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  });
});
