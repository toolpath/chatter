import { useState } from 'react';
import { useCan } from '../../components/CurrentUser';
import { Notice } from '../../components/ui/Notice';
import { tabPanelProps } from '../../components/ui/tabPanel';
import { UnderlineTabs, type TabItem } from '../../components/ui/UnderlineTabs';
import type { Machine, MachineUpdate, ToolTable } from '../../types';
import { AlertRulesTab } from './AlertRulesTab';
import { FilesTab } from './FilesTab';
import { MachineSettingsTab } from './MachineSettingsTab';
import { ToolTableTab } from './ToolTableTab';
import { UploadHistoryTab } from './UploadHistoryTab';
import { useAlertRules } from './useAlertRules';
import { useMachineFiles } from './useMachineFiles';
import { useUploadHistory } from './useUploadHistory';
import { useUploadMessages, type UploadMessages } from './useUploadMessages';

type SectionId = 'files' | 'history' | 'tools' | 'alerts' | 'settings';

const ID_PREFIX = 'machine-sections';

/** Brother and Haas machines send their tool table. Only Brother tells which pocket holds each tool. */
function toolTableOf(machine: Machine): { toolTable: ToolTable | undefined; hasPocketInfo: boolean } {
  if (machine.type === 'brother') return { toolTable: machine.data.toolTable, hasPocketInfo: !!machine.data.hasPocketInfo };
  // The Haas data type does not list the tool table, so say what it is
  if (machine.type === 'haas') return { toolTable: machine.data.toolTable as ToolTable | undefined, hasPocketInfo: false };
  return { toolTable: undefined, hasPocketInfo: false };
}

interface MachineSectionsProps {
  machine: Machine;
  /** All machines. The alert rules can be copied to the others. */
  machines: Machine[];
  now: number;
  onUpdate: (id: string, updates: MachineUpdate) => Promise<boolean>;
  onRemove: () => Promise<void>;
}

/** The tabs under the live values: files, upload history, tool table, alert rules and settings */
export function MachineSections({ machine, machines, now, onUpdate, onRemove }: MachineSectionsProps) {
  const [openTab, setOpenTab] = useState<SectionId>('files');
  const canManageMachines = useCan('manage-machines');
  const files = useMachineFiles(machine.id);
  const history = useUploadHistory(machine.id);
  const messages = useUploadMessages();
  const alertRules = useAlertRules(machine.id);
  const { toolTable, hasPocketInfo } = toolTableOf(machine);
  const toolCount = machine.connected && toolTable ? Object.keys(toolTable).length : 0;

  const tabs: TabItem<SectionId>[] = [
    { id: 'files', label: 'Files' },
    { id: 'history', label: 'Upload history', count: history.historyFiles.length },
    ...(toolCount > 0 ? [{ id: 'tools' as const, label: 'Tool table', count: toolCount }] : []),
    { id: 'alerts', label: 'Alert rules', count: alertRules.saved?.length },
    ...(canManageMachines ? [{ id: 'settings' as const, label: 'Machine settings' }] : []),
  ];
  // The tool table tab goes away when the machine stops sending it
  const shownTab = tabs.some(tab => tab.id === openTab) ? openTab : 'files';

  const reloadAfterUpload = async () => {
    files.refresh();
    await history.refreshAll();
  };

  return (
    <section aria-label="Files and settings" className="rounded-xl border border-zinc-800 bg-zinc-900">
      <UnderlineTabs label="Machine sections" tabs={tabs} value={shownTab} onChange={setOpenTab} idPrefix={ID_PREFIX} className="px-3" />
      <div {...tabPanelProps(ID_PREFIX, shownTab)}>
        {(shownTab === 'files' || shownTab === 'history') && <UploadMessageNotices messages={messages} />}
        {shownTab === 'files' && (
          <FilesTab machineId={machine.id} files={files} messages={messages} onUploaded={reloadAfterUpload} now={now} />
        )}
        {shownTab === 'history' && (
          <UploadHistoryTab
            machineId={machine.id}
            machineName={machine.name}
            history={history}
            messages={messages}
            onUploaded={reloadAfterUpload}
          />
        )}
        {shownTab === 'tools' && toolTable && (
          <ToolTableTab toolTable={toolTable} hasPocketInfo={hasPocketInfo} spindleTool={machine.data.toolNumber} />
        )}
        {shownTab === 'alerts' && (
          <AlertRulesTab
            machineId={machine.id}
            otherMachines={machines.filter(other => other.id !== machine.id)}
            rules={alertRules}
          />
        )}
        {shownTab === 'settings' && (
          <MachineSettingsTab machine={machine} onUpdate={onUpdate} onRemove={onRemove} />
        )}
      </div>
    </section>
  );
}

/** The result of the last upload, above the files and the upload history */
function UploadMessageNotices({ messages }: { messages: UploadMessages }) {
  if (!messages.error && !messages.success) return null;
  return (
    <div className="px-4 pt-3">
      {messages.error && <Notice tone="error" title={messages.error} onClose={messages.clear} />}
      {messages.success && <Notice tone="success" title={messages.success} onClose={messages.clear} />}
    </div>
  );
}
