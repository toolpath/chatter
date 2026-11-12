import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureLog } from '../logging/testSupport.js';
import { VictoriaQueryChecker } from './QueryChecker.js';
import { VmalertClient } from './VmalertClient.js';

function answer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('VictoriaQueryChecker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const checker = new VictoriaQueryChecker({ url: 'http://victoria:8428' });

  it('gives the number of results and the first value', async () => {
    const fetchMock = answer(200, { status: 'success', data: { result: [{ value: [1, '812'] }, { value: [1, '3'] }] } });

    expect(await checker.check('chatter_spindle_speed > 0')).toEqual({ ok: true, resultCount: 2, firstValue: 812 });
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://victoria:8428/api/v1/query?query=chatter_spindle_speed+%3E+0');
  });

  it('gives the error of VictoriaMetrics for a bad query', async () => {
    answer(422, { status: 'error', error: 'cannot parse "chatter_spindle_speed >"' });

    expect(await checker.check('chatter_spindle_speed >')).toEqual({
      ok: false, error: 'VictoriaMetrics refused the query: cannot parse "chatter_spindle_speed >"',
    });
  });

  it('leaves out the query and the time that VictoriaMetrics puts before its error', async () => {
    answer(422, {
      status: 'error',
      error: 'error when executing query="chatter_spindle_speed{machine=\\"m1\\" < 500" (time=1794503879529, step=300000): '
        + 'labelFilters: unexpected token "<"',
    });

    const check = await checker.check('chatter_spindle_speed{machine="m1" < 500');

    expect(check).toEqual({ ok: false, error: 'VictoriaMetrics refused the query: labelFilters: unexpected token "<"' });
  });

  it('says that VictoriaMetrics did not answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const check = await checker.check('up');

    expect(check.ok).toBe(false);
    expect(!check.ok && check.error).toMatch(/VictoriaMetrics did not answer/);
  });
});

describe('VmalertClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks vmalert to read the rules again', async () => {
    const fetchMock = answer(200, 'OK');

    expect(await new VmalertClient({ url: 'http://vmalert:8880' }).reload()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://vmalert:8880/-/reload', expect.objectContaining({ method: 'POST' }));
  });

  it('is false when vmalert cannot be reached, and logs why', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const log = captureLog();

    expect(await new VmalertClient({ url: 'http://vmalert:8880' }).reload()).toBe(false);
    log.restore();
    expect(log.text('warn')).toContain('ECONNREFUSED');
  });
});
