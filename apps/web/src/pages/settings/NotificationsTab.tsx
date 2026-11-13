import { cn } from '@toolpath/ui';
import { useState } from 'react';
import {
  fetchChannels, fetchChannelTypes, fetchMessages, fetchNotificationSettings, inputOf, saveNotificationSettings, sendTestMessage, updateChannel,
  type ChannelTestResult, type ChannelTypeInfo, type NotificationChannel, type NotificationMessage, type NotificationSettings,
} from '../../api/notifications';
import { Button } from '../../components/ui/Button';
import { Notice } from '../../components/ui/Notice';
import { Panel } from '../../components/ui/Panel';
import { Switch } from '../../components/ui/Switch';
import { CELL, HEAD_CELL, HEAD_ROW, ROW, TABLE } from '../../components/ui/table';
import { errorMessageOf } from '../../utils/errorMessage';
import { formatAgo } from '../../utils/formatters';
import { MessagesPanel } from './MessagesPanel';
import { NotificationSettingsPanel } from './NotificationSettingsPanel';
import { MessageResult } from './MessageResult';
import { channelSummary, lastMessageOf, LEVEL_LABELS, machinesLabel, type MachineName } from './notificationLabels';
import { ReportPending } from './ReportPending';
import { useServerReport } from './useServerReport';

export interface NotificationsReport {
  types: ChannelTypeInfo[];
  channels: NotificationChannel[];
  /** The messages of the last 30 days, the newest first */
  messages: NotificationMessage[];
  settings: NotificationSettings;
}

async function loadNotifications(): Promise<NotificationsReport> {
  const [types, channels, messages, settings] = await Promise.all([
    fetchChannelTypes(), fetchChannels(), fetchMessages(), fetchNotificationSettings(),
  ]);
  return { types, channels, messages, settings };
}

/** The panel whose last change failed, so the error shows next to the button that the user clicked */
type ChangedPanel = 'channels' | 'settings';

/** The result of the last "Send test" of the channel list */
interface TestOutcome {
  channelName: string;
  result: ChannelTestResult;
}

/**
 * Settings > Notifications: the channels that get the machine alerts (text messages and webhooks),
 * the messages of the last 30 days, and the settings of the message text.
 */
export function NotificationsTab({ machines }: { machines: MachineName[] }) {
  const { report, loadError, changeError, isChanging, change, refresh } = useServerReport(loadNotifications);
  const [changedPanel, setChangedPanel] = useState<ChangedPanel>('channels');
  if (loadError || !report) return <ReportPending loadError={loadError} />;

  const changeIn = (panel: ChangedPanel, action: () => Promise<NotificationsReport>) => {
    setChangedPanel(panel);
    return change(action);
  };
  const errorIn = (panel: ChangedPanel) => (changedPanel === panel ? changeError : null);
  const setEnabled = (channel: NotificationChannel, enabled: boolean) => changeIn('channels', async () => {
    await updateChannel(channel.id, { ...inputOf(channel), enabled });
    return loadNotifications();
  });
  const saveSettings = (settings: NotificationSettings) => changeIn('settings', async () => ({
    ...report, settings: await saveNotificationSettings(settings),
  }));

  return (
    <>
      <ChannelsPanel
        report={report}
        machines={machines}
        canChange={!isChanging}
        error={errorIn('channels')}
        onSetEnabled={setEnabled}
        onTested={refresh}
      />
      <MessagesPanel channels={report.channels} messages={report.messages} />
      <NotificationSettingsPanel settings={report.settings} canSave={!isChanging} error={errorIn('settings')} onSave={saveSettings} />
    </>
  );
}

interface ChannelsPanelProps {
  report: NotificationsReport;
  machines: MachineName[];
  canChange: boolean;
  error: string | null;
  onSetEnabled: (channel: NotificationChannel, enabled: boolean) => void;
  /** A test of a saved channel goes in the message list, so the tab loads it again */
  onTested: () => void;
}

function ChannelsPanel({ report, machines, canChange, error, onSetEnabled, onTested }: ChannelsPanelProps) {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testOutcome, setTestOutcome] = useState<TestOutcome | null>(null);

  const sendTest = async (channel: NotificationChannel) => {
    setTestingId(channel.id);
    setTestOutcome(null);
    try {
      setTestOutcome({ channelName: channel.name, result: await testResultOf(channel) });
    } finally {
      setTestingId(null);
      onTested();
    }
  };

  return (
    <Panel title="Channels" description="Chatter sends the machine alerts to these channels when an alert starts and when it ends.">
      {testOutcome && <TestOutcomeNotice outcome={testOutcome} onClose={() => setTestOutcome(null)} />}
      {error && <Notice tone="error" title={error} className="mx-5 mt-4" />}
      {report.channels.length === 0 ? (
        <p className="m-0 px-5 py-4 text-zinc-200">No channels yet. Add one to send the alerts to phones or to other services.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={cn(TABLE, 'min-w-[46rem]')}>
            <thead>
              <tr className={HEAD_ROW}>
                <th scope="col" className={HEAD_CELL}>Channel</th>
                <th scope="col" className={HEAD_CELL}>Sends</th>
                <th scope="col" className={HEAD_CELL}>Last message</th>
                <th scope="col" className={HEAD_CELL}>On</th>
                <th scope="col" className={HEAD_CELL}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {report.channels.map(channel => (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  report={report}
                  machines={machines}
                  canChange={canChange}
                  isTesting={testingId === channel.id}
                  onSetEnabled={enabled => onSetEnabled(channel, enabled)}
                  onSendTest={() => sendTest(channel)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** A call that fails, for example because the server restarts, shows as a failed test */
async function testResultOf(channel: NotificationChannel): Promise<ChannelTestResult> {
  try {
    return await sendTestMessage(inputOf(channel), channel.id);
  } catch (error) {
    return { ok: false, error: errorMessageOf(error, 'Could not send the test') };
  }
}

function TestOutcomeNotice({ outcome, onClose }: { outcome: TestOutcome; onClose: () => void }) {
  const { channelName, result } = outcome;
  return result.ok ? (
    <Notice tone="success" title={`Test to ${channelName} sent`} onClose={onClose} className="mx-5 mt-4">{result.detail}</Notice>
  ) : (
    <Notice tone="error" title={`Test to ${channelName} failed`} onClose={onClose} className="mx-5 mt-4">{result.error}</Notice>
  );
}

interface ChannelRowProps {
  channel: NotificationChannel;
  report: NotificationsReport;
  machines: MachineName[];
  canChange: boolean;
  isTesting: boolean;
  onSetEnabled: (enabled: boolean) => void;
  onSendTest: () => void;
}

function ChannelRow({ channel, report, machines, canChange, isTesting, onSetEnabled, onSendTest }: ChannelRowProps) {
  return (
    <tr className={ROW}>
      <td className={CELL}>
        <div className="font-semibold">{channel.name}</div>
        <div className="text-xs text-zinc-300">{channelSummary(channel, report.types)}</div>
      </td>
      <td className={CELL}>
        <div>{LEVEL_LABELS[channel.minSeverity]}</div>
        <div className="text-xs text-zinc-300">{machinesLabel(channel.machineIds, machines)}</div>
      </td>
      <td className={CELL}>
        <LastMessage message={lastMessageOf(channel.id, report.messages)} />
      </td>
      <td className={CELL}>
        <Switch checked={channel.enabled} label={`${channel.name} on`} disabled={!canChange} onChange={onSetEnabled} />
      </td>
      <td className={cn(CELL, 'text-right')}>
        <Button size="sm" disabled={isTesting} onClick={onSendTest}>{isTesting ? 'Sending…' : 'Send test'}</Button>
      </td>
    </tr>
  );
}

function LastMessage({ message }: { message: NotificationMessage | undefined }) {
  if (!message) return <span className="text-zinc-300">None in the last 30 days</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <MessageResult message={message} />
      <span className="text-xs text-zinc-300">{formatAgo(message.createdAt, Date.now())}</span>
    </div>
  );
}
