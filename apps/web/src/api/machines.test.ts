import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMachine, forgetOpcuaCertificate, saveMachineUpdate, trustOpcuaCertificate } from './machines';

function replyWith(status: number, body: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': 'application/json' } })));
}

describe('saveMachineUpdate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the change to the route of the machine', async () => {
    replyWith(200, JSON.stringify({ id: 'm1' }));

    await saveMachineUpdate('m1', { host: '192.168.1.99' });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/machine/m1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ host: '192.168.1.99' });
  });

  // The App shows this text. It tells the user to type the saved password again.
  it('gives the reason of the server when the save fails', async () => {
    const reason = 'Type the FTP password again. You changed the IP address or a port.';
    replyWith(400, JSON.stringify({ error: reason }));

    await expect(saveMachineUpdate('m1', { host: '192.168.1.99' })).rejects.toThrow(reason);
  });

  it('gives a general text when the reply has no reason', async () => {
    replyWith(502, '<html>Bad gateway</html>');

    await expect(saveMachineUpdate('m1', { host: '192.168.1.99' })).rejects.toThrow('Could not save the machine settings');
  });
});

const THUMBPRINT = 'ab'.repeat(32);

function lastCall() {
  const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
  return { url: String(url), method: init?.method ?? 'GET', body: init?.body };
}

describe('the OPC UA certificate of a Siemens control', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('trusts exactly the thumbprint that the Admin saw, and gives the new machine status', async () => {
    replyWith(200, JSON.stringify({ id: 'm1', opcuaServerThumbprint: THUMBPRINT }));

    const machine = await trustOpcuaCertificate('m1', THUMBPRINT);

    const call = lastCall();
    expect(call.url).toContain('/api/machine/m1/opcua/trust-certificate');
    expect(call.method).toBe('POST');
    expect(JSON.parse(String(call.body))).toEqual({ thumbprint: THUMBPRINT });
    expect(machine).toEqual({ id: 'm1', opcuaServerThumbprint: THUMBPRINT });
  });

  it('gives the reason of the server when the certificate changed again', async () => {
    const reason = 'The certificate of the control changed again. Chatter trusted nothing.';
    replyWith(409, JSON.stringify({ error: reason }));

    await expect(trustOpcuaCertificate('m1', THUMBPRINT)).rejects.toThrow(reason);
  });

  it('forgets the trusted certificate with no body, and gives the new machine status', async () => {
    replyWith(200, JSON.stringify({ id: 'm1', opcuaServerThumbprint: null }));

    const machine = await forgetOpcuaCertificate('m1');

    const call = lastCall();
    expect(call.url).toContain('/api/machine/m1/opcua/forget-certificate');
    expect(call.method).toBe('POST');
    expect(call.body).toBeUndefined();
    expect(machine).toEqual({ id: 'm1', opcuaServerThumbprint: null });
  });

  it('gives a general text when the forget fails with no reason', async () => {
    replyWith(502, '<html>Bad gateway</html>');

    await expect(forgetOpcuaCertificate('m1')).rejects.toThrow('Could not forget the certificate');
  });

  it('loads the status of one machine', async () => {
    replyWith(200, JSON.stringify({ id: 'm1' }));

    expect(await fetchMachine('m1')).toEqual({ id: 'm1' });
    expect(lastCall()).toMatchObject({ method: 'GET', url: expect.stringContaining('/api/machine/m1') });
  });
});
