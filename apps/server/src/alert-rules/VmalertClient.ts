import { createLogger } from '../logging/logger.js';

const log = createLogger('alert-rules');

const RELOAD_PATH = '/-/reload';
const RELOAD_TIMEOUT_MS = 5000;

/** Tells vmalert to read the rules files again */
export interface RuleReloader {
  /** True when vmalert read the files. False when it did not answer or refused them. */
  reload(): Promise<boolean>;
}

/**
 * vmalert has no login, so only Chatter (on the same Docker network) must reach it.
 * When it cannot be reached, vmalert still reads the files again within 30 seconds (-configCheckInterval).
 */
export class VmalertClient implements RuleReloader {
  private readonly reloadUrl: string;

  constructor({ url }: { url: string }) {
    this.reloadUrl = new URL(RELOAD_PATH, url).href;
  }

  async reload(): Promise<boolean> {
    try {
      const response = await fetch(this.reloadUrl, { method: 'POST', signal: AbortSignal.timeout(RELOAD_TIMEOUT_MS) });
      if (response.ok) return true;
      log.error('vmalert did not read the new rules', { status: response.status, answer: await response.text() });
    } catch (error) {
      log.warn('Could not reach vmalert. It reads the rules again within 30 seconds', { url: this.reloadUrl, error });
    }
    return false;
  }
}
