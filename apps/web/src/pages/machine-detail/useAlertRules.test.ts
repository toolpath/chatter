import type { AlertRule } from '@local-chatter/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAlertRules, saveAlertRules } from '../../api/alertRules';
import { useAlertRules } from './useAlertRules';

vi.mock('../../api/alertRules', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/alertRules')>()),
  fetchAlertRules: vi.fn(),
  saveAlertRules: vi.fn(),
}));

const M1_RULE: AlertRule = {
  id: 'r1', kind: 'simple', enabled: true, subject: 'spindle-load', check: 'above', limit: 90, forMinutes: 1, severity: 'warning',
};
const M2_RULE: AlertRule = {
  id: 'r2', kind: 'simple', enabled: true, subject: 'not-connected', check: 'above', limit: 0, forMinutes: 10, severity: 'critical',
};

interface Props {
  machineId: string;
  isWanted: boolean;
}

/** A reply that comes only when the test calls `resolve` */
function laterReply<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderRules(initialProps: Props) {
  return renderHook((props: Props) => useAlertRules(props.machineId, props.isWanted), { initialProps });
}

describe('useAlertRules', () => {
  beforeEach(() => {
    vi.mocked(fetchAlertRules).mockReset();
    vi.mocked(saveAlertRules).mockReset();
  });

  it('sends no request while the rules are not wanted', () => {
    const { result } = renderRules({ machineId: 'm1', isWanted: false });

    expect(fetchAlertRules).not.toHaveBeenCalled();
    expect(result.current.saved).toBeNull();
  });

  it('loads the rules once when they become wanted', async () => {
    vi.mocked(fetchAlertRules).mockResolvedValue([M1_RULE]);
    const { result, rerender } = renderRules({ machineId: 'm1', isWanted: false });

    rerender({ machineId: 'm1', isWanted: true });

    await waitFor(() => expect(result.current.saved).toEqual([M1_RULE]));
    expect(fetchAlertRules).toHaveBeenCalledTimes(1);
    expect(fetchAlertRules).toHaveBeenCalledWith('m1');
  });

  it('drops the loaded rules when they stop being wanted', async () => {
    vi.mocked(fetchAlertRules).mockResolvedValue([M1_RULE]);
    const { result, rerender } = renderRules({ machineId: 'm1', isWanted: true });
    await waitFor(() => expect(result.current.saved).toEqual([M1_RULE]));

    rerender({ machineId: 'm1', isWanted: false });

    expect(result.current.saved).toBeNull();
    expect(result.current.draft).toEqual([]);
  });

  it('ignores a reply that comes after the rules stop being wanted', async () => {
    const reply = laterReply<AlertRule[]>();
    vi.mocked(fetchAlertRules).mockReturnValue(reply.promise);
    const { result, rerender } = renderRules({ machineId: 'm1', isWanted: true });

    rerender({ machineId: 'm1', isWanted: false });
    await act(async () => reply.resolve([M1_RULE]));

    expect(result.current.saved).toBeNull();
    expect(result.current.draft).toEqual([]);
  });

  it('shows no rules of the old machine after the machine changes', async () => {
    vi.mocked(fetchAlertRules).mockResolvedValueOnce([M1_RULE]);
    const { result, rerender } = renderRules({ machineId: 'm1', isWanted: true });
    await waitFor(() => expect(result.current.saved).toEqual([M1_RULE]));
    act(() => result.current.change(result.current.draft[0].key, { limit: 80 }));
    const m2Reply = laterReply<AlertRule[]>();
    vi.mocked(fetchAlertRules).mockReturnValueOnce(m2Reply.promise);

    rerender({ machineId: 'm2', isWanted: true });

    expect(result.current.saved).toBeNull();
    expect(result.current.draft).toEqual([]);
    expect(result.current.changes).toBe(0);
    expect(fetchAlertRules).toHaveBeenLastCalledWith('m2');
    await act(async () => m2Reply.resolve([M2_RULE]));
    expect(result.current.saved).toEqual([M2_RULE]);
  });

  it('ignores the reply for the old machine when it comes after the machine changes', async () => {
    const m1Reply = laterReply<AlertRule[]>();
    const m2Reply = laterReply<AlertRule[]>();
    vi.mocked(fetchAlertRules).mockReturnValueOnce(m1Reply.promise).mockReturnValueOnce(m2Reply.promise);
    const { result, rerender } = renderRules({ machineId: 'm1', isWanted: true });

    rerender({ machineId: 'm2', isWanted: true });
    await act(async () => m1Reply.resolve([M1_RULE]));

    expect(result.current.saved).toBeNull();
    await act(async () => m2Reply.resolve([M2_RULE]));
    expect(result.current.saved).toEqual([M2_RULE]);
  });

  it('saves nothing before the rules of the machine load', async () => {
    vi.mocked(fetchAlertRules).mockReturnValue(laterReply<AlertRule[]>().promise);
    const { result } = renderRules({ machineId: 'm1', isWanted: true });

    await act(() => result.current.save());

    expect(saveAlertRules).not.toHaveBeenCalled();
  });

  it('keeps the rules of the new machine when a save for the old machine ends after the change', async () => {
    vi.mocked(fetchAlertRules).mockResolvedValueOnce([M1_RULE]).mockResolvedValueOnce([M2_RULE]);
    const saveReply = laterReply<{ rules: AlertRule[]; vmalertReloaded: boolean }>();
    vi.mocked(saveAlertRules).mockReturnValue(saveReply.promise);
    const { result, rerender } = renderRules({ machineId: 'm1', isWanted: true });
    await waitFor(() => expect(result.current.saved).toEqual([M1_RULE]));
    act(() => result.current.change(result.current.draft[0].key, { limit: 80 }));
    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = result.current.save();
    });
    expect(saveAlertRules).toHaveBeenCalledWith('m1', [{ ...M1_RULE, limit: 80 }]);

    rerender({ machineId: 'm2', isWanted: true });
    await waitFor(() => expect(result.current.saved).toEqual([M2_RULE]));
    await act(async () => {
      saveReply.resolve({ rules: [{ ...M1_RULE, limit: 80 }], vmalertReloaded: true });
      await saving;
    });

    expect(result.current.saved).toEqual([M2_RULE]);
    expect(result.current.notice).toBeNull();
    expect(result.current.isSaving).toBe(false);
  });
});
