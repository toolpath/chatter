import { cn } from '@toolpath/ui';
import { useState, type FormEvent } from 'react';
import { fetchProxyReport, saveTrustedProxies, type HeaderSender, type ProxyReport } from '../../api/settings';
import { Button } from '../../components/ui/Button';
import { Field, TextInput } from '../../components/ui/fields';
import { CloseIcon, PlusIcon } from '../../components/ui/icons';
import { InfoCard } from '../../components/ui/InfoCard';
import { Notice } from '../../components/ui/Notice';
import { Panel } from '../../components/ui/Panel';
import { StatusDot } from '../../components/ui/StatusDot';
import { CELL, HEAD_CELL, HEAD_ROW, ROW, TABLE } from '../../components/ui/table';
import { formatAgo } from '../../utils/formatters';
import { ReportPending } from './ReportPending';
import { useServerReport } from './useServerReport';

/**
 * The reverse proxies that Chatter believes, the computers that sent proxy headers, and how this page came.
 * A reverse proxy is a server in front of Chatter, for example one that adds HTTPS.
 */
export function ProxyTab() {
  const { report, loadError, changeError, isChanging, change } = useServerReport(fetchProxyReport);
  if (loadError || !report) return <ReportPending loadError={loadError} />;

  const canChange = !report.isLocked && !isChanging;
  const save = (addresses: string[]) => change(() => saveTrustedProxies(addresses));
  const trust = (address: string) => save([...report.addresses, address]);
  return (
    <>
      {report.isLocked && <LockedNotice />}
      <TrustedProxiesPanel addresses={report.addresses} canChange={canChange} isLocked={report.isLocked} error={changeError} onSave={save} />
      <HeaderSendersPanel senders={report.senders} onTrust={canChange ? trust : undefined} />
      <ConnectionCards connection={report.connection} />
    </>
  );
}

function LockedNotice() {
  return (
    <Notice tone="info" title="Set by the server, so you cannot change it here">
      The <code className="font-mono text-zinc-50">TRUST_PROXY</code> environment variable sets this, and it always wins.
      To manage the list here, remove it (for example from <code className="font-mono text-zinc-50">docker-compose.yml</code>),
      then start Chatter again.
    </Notice>
  );
}

interface TrustedProxiesPanelProps {
  addresses: string[];
  /** False while a save runs, and when TRUST_PROXY sets the list */
  canChange: boolean;
  isLocked: boolean;
  error: string | null;
  onSave: (addresses: string[]) => Promise<boolean>;
}

function TrustedProxiesPanel({ addresses, canChange, isLocked, error, onSave }: TrustedProxiesPanelProps) {
  const remove = (address: string) => onSave(addresses.filter(entry => entry !== address));
  return (
    <Panel title="Trusted reverse proxies" description="Chatter believes the user address and the HTTPS mark only from these addresses.">
      <div className="flex flex-wrap items-center gap-2 px-5 py-4">
        <span className="mr-2 text-xs font-semibold text-zinc-300">Addresses</span>
        {addresses.length === 0 && <span className="text-zinc-200">None. Chatter uses the address of each connection.</span>}
        {addresses.map(address => (
          <AddressChip key={address} address={address} onRemove={canChange ? () => remove(address) : undefined} />
        ))}
      </div>
      {!isLocked && <AddProxyForm addresses={addresses} canChange={canChange} onSave={onSave} />}
      {error && <Notice tone="error" title={error} className="mx-5 mb-4" />}
    </Panel>
  );
}

function AddressChip({ address, onRemove }: { address: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-700 pr-1 pl-3 font-mono">
      {address}
      {onRemove ? (
        <Button variant="quiet" size="icon" className="size-6" onClick={onRemove} aria-label={`Stop trusting ${address}`}>
          <CloseIcon size={12} />
        </Button>
      ) : (
        <span className="w-2" />
      )}
    </span>
  );
}

interface AddProxyFormProps {
  addresses: string[];
  canChange: boolean;
  onSave: (addresses: string[]) => Promise<boolean>;
}

function AddProxyForm({ addresses, canChange, onSave }: AddProxyFormProps) {
  const [newAddress, setNewAddress] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const address = newAddress.trim();
    if (!address) return;
    if (await onSave([...addresses, address])) setNewAddress('');
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1 border-t border-zinc-800 px-5 py-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field id="new-proxy" label="Add a proxy address or range" className="flex-[1_1_16rem]">
          <TextInput
            id="new-proxy"
            mono
            value={newAddress}
            onChange={event => setNewAddress(event.target.value)}
            placeholder="172.18.0.1 or 172.16.0.0/12"
            aria-describedby="new-proxy-hint"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Button type="submit" disabled={!canChange || newAddress.trim() === ''}>
          <PlusIcon /> Add
        </Button>
      </div>
      <p id="new-proxy-hint" className="m-0 text-xs text-zinc-300">
        Add only your own reverse proxy. A wrong address lets a computer hide its real address.
      </p>
    </form>
  );
}

interface HeaderSendersPanelProps {
  senders: HeaderSender[];
  /** Not set when the list cannot change */
  onTrust?: (address: string) => void;
}

function HeaderSendersPanel({ senders, onTrust }: HeaderSendersPanelProps) {
  const now = Date.now();
  return (
    <Panel title="Computers that sent proxy headers" description="This helps you find the address of your proxy. Chatter keeps the last 20 since it started.">
      {senders.length === 0 ? (
        <p className="m-0 px-5 py-4 text-zinc-200">No proxy has sent requests to Chatter since it started. If you use no proxy, you can skip this.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={cn(TABLE, 'min-w-[32.5rem]')}>
            <thead>
              <tr className={HEAD_ROW}>
                <th scope="col" className={HEAD_CELL}>Address</th>
                <th scope="col" className={HEAD_CELL}>Last seen</th>
                <th scope="col" className={HEAD_CELL}>Chatter</th>
                {onTrust && <th scope="col" className={HEAD_CELL}><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {senders.map(sender => (
                <HeaderSenderRow key={sender.address} sender={sender} now={now} onTrust={onTrust} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

interface HeaderSenderRowProps {
  sender: HeaderSender;
  now: number;
  /** Not set when the list cannot change */
  onTrust?: (address: string) => void;
}

function HeaderSenderRow({ sender, now, onTrust }: HeaderSenderRowProps) {
  return (
    <tr className={ROW}>
      <td className={cn(CELL, 'font-mono')}>{sender.address}</td>
      <td className={cn(CELL, 'text-zinc-200')}>{formatAgo(sender.lastSeen, now)}</td>
      <td className={CELL}>
        <StatusDot tone={sender.isTrusted ? 'good' : 'check'}>{sender.isTrusted ? 'Trusted' : 'Ignored: not in the list'}</StatusDot>
      </td>
      {onTrust && (
        <td className={cn(CELL, 'text-right')}>
          {!sender.isTrusted && <Button size="sm" onClick={() => onTrust(sender.address)}>Trust</Button>}
        </td>
      )}
    </tr>
  );
}

function ConnectionCards({ connection }: Pick<ProxyReport, 'connection'>) {
  return (
    <section aria-labelledby="this-connection" className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-3">
      <h2 id="this-connection" className="sr-only">This connection</h2>
      <InfoCard label="This page came">
        <StatusDot tone={connection.isHttps ? 'good' : 'check'}>{connection.isHttps ? 'Over HTTPS' : 'Over plain HTTP'}</StatusDot>
      </InfoCard>
      <InfoCard label="Through the proxy">
        <span className={cn(connection.proxyAddress && 'font-mono')}>{connection.proxyAddress ?? 'No trusted proxy'}</span>
      </InfoCard>
      <InfoCard label="Your address">
        <span className="font-mono">{connection.address}</span>
      </InfoCard>
    </section>
  );
}
