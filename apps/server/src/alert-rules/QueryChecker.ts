import type { QueryCheck } from '@local-chatter/shared';

export type { QueryCheck };

const QUERY_PATH = '/api/v1/query';
const QUERY_TIMEOUT_MS = 5000;
/** VictoriaMetrics puts the whole query and the time before the real reason. The user already sees the query. */
const ERROR_PREFIX = /^error when executing query=[\s\S]*?step=\d+\):\s*/;

export interface QueryChecker {
  check(query: string): Promise<QueryCheck>;
}

interface InstantQueryReply {
  status?: 'success' | 'error';
  error?: string;
  data?: { result?: { value?: [number, string] }[] };
}

/**
 * Runs a query one time on VictoriaMetrics.
 * vmalert uses the same query language, so a query that VictoriaMetrics refuses would also stop vmalert from reading the rules.
 */
export class VictoriaQueryChecker implements QueryChecker {
  private readonly queryUrl: string;

  constructor({ url }: { url: string }) {
    this.queryUrl = new URL(QUERY_PATH, url).href;
  }

  async check(query: string): Promise<QueryCheck> {
    let response: Response;
    try {
      response = await fetch(`${this.queryUrl}?${new URLSearchParams({ query })}`, { signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) });
    } catch {
      return { ok: false, error: 'Chatter could not check the query, because VictoriaMetrics did not answer. Try again in a minute.' };
    }
    const reply = await response.json().catch(() => ({})) as InstantQueryReply;
    if (!response.ok || reply.status !== 'success') {
      return { ok: false, error: refusalText(reply.error, response.status) };
    }
    const result = reply.data?.result ?? [];
    const firstValue = Number(result[0]?.value?.[1]);
    return { ok: true, resultCount: result.length, firstValue: Number.isFinite(firstValue) ? firstValue : null };
  }
}

function refusalText(error: string | undefined, status: number): string {
  const reason = error?.replace(ERROR_PREFIX, '').trim();
  return reason ? `VictoriaMetrics refused the query: ${reason}` : `VictoriaMetrics refused the query (${status})`;
}
