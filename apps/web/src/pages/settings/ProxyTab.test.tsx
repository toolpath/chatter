import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchProxyReport, saveTrustedProxies, type ProxyReport } from '../../api/settings';
import { ProxyTab } from './ProxyTab';

vi.mock('../../api/settings', () => ({ fetchProxyReport: vi.fn(), saveTrustedProxies: vi.fn() }));

const PROXY = '172.18.0.1';
const STRANGER = '192.168.1.44';

function report(changes: Partial<ProxyReport> = {}): ProxyReport {
  return {
    addresses: [PROXY],
    isLocked: false,
    senders: [
      { address: PROXY, lastSeen: new Date().toISOString(), isTrusted: true },
      { address: STRANGER, lastSeen: new Date().toISOString(), isTrusted: false },
    ],
    connection: { address: '192.168.1.20', isHttps: true, proxyAddress: PROXY },
    ...changes,
  };
}

async function renderTab(loaded: ProxyReport) {
  vi.mocked(fetchProxyReport).mockResolvedValue(loaded);
  render(<ProxyTab />);
  await screen.findByText('Trusted reverse proxies');
}

describe('ProxyTab', () => {
  beforeEach(() => {
    vi.mocked(saveTrustedProxies).mockReset();
  });

  it('shows how this page came', async () => {
    await renderTab(report());

    expect(screen.getByText('Over HTTPS')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.20')).toBeInTheDocument();
  });

  it('says that you can skip the list when no proxy has sent requests', async () => {
    await renderTab(report({ senders: [] }));

    expect(screen.getByText('No proxy has sent requests to Chatter since it started. If you use no proxy, you can skip this.')).toBeInTheDocument();
  });

  it('adds a proxy to the list', async () => {
    await renderTab(report());
    vi.mocked(saveTrustedProxies).mockResolvedValue(report({ addresses: [PROXY, '10.0.0.0/8'] }));

    fireEvent.change(screen.getByLabelText('Add a proxy address or range'), { target: { value: ' 10.0.0.0/8 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(saveTrustedProxies).toHaveBeenCalledWith([PROXY, '10.0.0.0/8']);
    expect(await screen.findByText('10.0.0.0/8')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Add a proxy address or range')).toHaveValue(''));
  });

  it('removes a proxy from the list', async () => {
    await renderTab(report());
    vi.mocked(saveTrustedProxies).mockResolvedValue(report({ addresses: [] }));

    fireEvent.click(screen.getByRole('button', { name: `Stop trusting ${PROXY}` }));

    expect(saveTrustedProxies).toHaveBeenCalledWith([]);
    expect(await screen.findByText(/None\. Chatter uses the address/)).toBeInTheDocument();
  });

  it('trusts a computer that sent proxy headers', async () => {
    await renderTab(report());
    vi.mocked(saveTrustedProxies).mockResolvedValue(report());

    fireEvent.click(screen.getByRole('button', { name: 'Trust' }));

    expect(saveTrustedProxies).toHaveBeenCalledWith([PROXY, STRANGER]);
    // The button goes away while the list is saved, and comes back after
    expect(await screen.findByRole('button', { name: 'Trust' })).toBeInTheDocument();
  });

  it('shows why the server refused the list, and keeps the typed address', async () => {
    await renderTab(report());
    vi.mocked(saveTrustedProxies).mockRejectedValue(new Error('"proxy" is not an IP address'));

    fireEvent.change(screen.getByLabelText('Add a proxy address or range'), { target: { value: 'proxy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('"proxy" is not an IP address')).toBeInTheDocument();
    expect(screen.getByLabelText('Add a proxy address or range')).toHaveValue('proxy');
  });

  it('allows no change when TRUST_PROXY sets the list', async () => {
    await renderTab(report({ isLocked: true }));

    expect(screen.getByText('Set by the server, so you cannot change it here')).toBeInTheDocument();
    expect(screen.queryByLabelText('Add a proxy address or range')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stop trusting|Trust/ })).not.toBeInTheDocument();
  });
});
