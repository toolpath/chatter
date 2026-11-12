import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onLoginCheckNeeded } from './client';
import { sendWithProgress } from './sendWithProgress';

/** Stands in for the browser's XMLHttpRequest. The test plays the server. */
class FakeRequest {
  static last: FakeRequest;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  responseText = '';
  upload: { onprogress?: (event: { loaded: number; total: number; lengthComputable: boolean }) => void } = {};
  onload?: () => void;
  onerror?: () => void;

  constructor() {
    FakeRequest.last = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: unknown) {
    this.body = body;
  }

  reply(status: number, body: object) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

describe('sendWithProgress', () => {
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeRequest);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const UPDATE_FILE_ADDRESS = '/api/updates/file';
  const updateFile = new File(['update'], 'chatter-update-1.3.0-armv7.tar');

  it('sends the raw file, and tells how much is sent', async () => {
    const onProgress = vi.fn();
    const reply = sendWithProgress(UPDATE_FILE_ADDRESS, updateFile, onProgress);
    const request = FakeRequest.last;

    request.upload.onprogress?.({ loaded: 3, total: 6, lengthComputable: true });
    request.reply(200, { done: true });

    expect(request.method).toBe('POST');
    expect(request.url).toBe(UPDATE_FILE_ADDRESS);
    expect(request.headers['Content-Type']).toBe('application/octet-stream');
    expect(request.body).toBe(updateFile);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    const response = await reply;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ done: true });
  });

  it('asks for a login check when the login is gone', async () => {
    const listener = vi.fn();
    const stopListening = onLoginCheckNeeded(listener);
    try {
      const reply = sendWithProgress(UPDATE_FILE_ADDRESS, updateFile, () => {});

      FakeRequest.last.reply(401, { error: 'Log in first' });

      expect((await reply).status).toBe(401);
      expect(listener).toHaveBeenCalled();
    } finally {
      stopListening();
    }
  });

  it('fails when the connection stops', async () => {
    const reply = sendWithProgress(UPDATE_FILE_ADDRESS, updateFile, () => {});

    FakeRequest.last.onerror?.();

    await expect(reply).rejects.toThrow('The upload stopped');
  });
});
