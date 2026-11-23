import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useCan } from '../../components/CurrentUser';
import { tabPanelProps } from '../../components/ui/tabPanel';
import { UnderlineTabs, type TabItem } from '../../components/ui/UnderlineTabs';
import type { Machine, MachineUpdate, ToolTable } from '../../types';
import { FilesSection } from './FilesSection';
import { FIRST_TAB, TAB_PARAM, type SectionId } from './machineTabs';
import { FIRST_REPORT_RANGE, ReportPanel } from './ReportPanel';
import { SettingsTab } from './SettingsTab';
import { ToolTableTab } from './ToolTableTab';
import { useAlertRules } from './useAlertRules';
import { useMachineFiles } from './useMachineFiles';
import { useUploadHistory } from './useUploadHistory';
import { useUploadMessages } from './useUploadMessages';

const ID_PREFIX = 'machine-sections';
/** The tabs that hold a list or a form. They share one card. Dashboard and Report hold cards of their own. */
const CARD_TABS: readonly SectionId[] = ['files', 'tools'];

/** Brother and Haas machines send their tool table. Only Brother tells which pocket holds each tool. */
function toolTableOf(machine: Machine): { toolTable: ToolTable | undefined; hasPocketInfo: boolean } {
  if (machine.type === 'brother') return { toolTable: machine.data.toolTable, hasPocketInfo: !!machine.data.hasPocketInfo };
  // The Haas data type does not list the tool table, so say what it is
  if (machine.type === 'haas') return { toolTable: machine.data.toolTable as ToolTable | undefined, hasPocketInfo: false };
  return { toolTable: undefined, hasPocketInfo: false };
}

/** The Tool table tab with its count, or null when the machine has no such tab, and what the tab shows */
function toolTabOf(machine: Machine) {
  const { toolTable, hasPocketInfo } = toolTableOf(machine);
  const toolCount = machine.connected && toolTable ? Object.keys(toolTable).length : 0;
  // A Brother reads its tool table apart from the state polls, so its tab is there before the first read, with Sync
  const toolSync = machine.type === 'brother' ? machine.data.toolSync : undefined;
  const tab: TabItem<SectionId> | null = toolCount > 0 || toolSync !== undefined
    ? { id: 'tools', label: 'Tool table', ...(toolCount > 0 ? { count: toolCount } : {}) }
    : null;
  return { tab, toolSync, toolTable: toolTable ?? {}, hasPocketInfo };
}

interface MachineSectionsProps {
  machine: Machine;
  /** All machines. The alert rules can be copied to the others. */
  machines: Machine[];
  now: number;
  onUpdate: (id: string, updates: MachineUpdate) => Promise<boolean>;
  onRemove: () => Promise<void>;
  /** The live values, the chart and the alerts */
  dashboard: ReactNode;
  /** The Dashboard tab shows this number of firing alerts */
  firingCount: number;
}

/** The tabs under the machine name: the dashboard, the report, files, tool table and settings */
export function MachineSections({ machine, machines, now, onUpdate, onRemove, dashboard, firingCount }: MachineSectionsProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const openTab = searchParams.get(TAB_PARAM);
  const messages = useUploadMessages();
  const alertRules = useAlertRules(machine.id, useCan('manage-machines'));
  // The range of the report stays when the user opens another tab and comes back
  const reportRange = useState(FIRST_REPORT_RANGE);
  const tools = toolTabOf(machine);

  const tabs: TabItem<SectionId>[] = [
    { id: 'dashboard', label: <>Dashboard<FiringCount count={firingCount} /></> },
    { id: 'report', label: 'Report' },
    { id: 'files', label: 'Files' },
    ...(tools.tab ? [tools.tab] : []),
    { id: 'settings', label: 'Settings' },
  ];
  // An unknown tab, or a tab that is not there (the tool table goes away when the machine stops sending it), opens the dashboard
  const shownTab = tabs.find(tab => tab.id === openTab)?.id ?? FIRST_TAB;
  // Each tab change is a step in the history, so Back opens the tab before. A click on the open tab adds no step.
  const openTabNamed = (tab: SectionId) => {
    if (tab !== shownTab) setSearchParams({ [TAB_PARAM]: tab });
  };
  useAddressOfShownTab(openTab, shownTab);
  // The files and the upload history load at the first open of the Files tab, not on each visit to the page
  const filesWereOpened = useHasBeenTrue(shownTab === 'files');
  const files = useMachineFiles(machine.id, filesWereOpened);
  const history = useUploadHistory(machine.id, filesWereOpened);

  const reloadAfterUpload = async () => {
    files.refresh();
    await history.refreshAll();
  };

  return (
    <>
      <UnderlineTabs label="Machine sections" tabs={tabs} value={shownTab} onChange={openTabNamed} idPrefix={ID_PREFIX} />
      <div {...tabPanelProps(ID_PREFIX, shownTab)} className="flex flex-col gap-5">
        {shownTab === 'dashboard' && dashboard}
        {shownTab === 'report' && <ReportPanel machineId={machine.id} machineType={machine.type} range={reportRange} />}
        {CARD_TABS.includes(shownTab) && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900">
            {shownTab === 'files' && (
              <FilesSection
                machineId={machine.id}
                machineName={machine.name}
                files={files}
                history={history}
                messages={messages}
                onUploaded={reloadAfterUpload}
                now={now}
              />
            )}
            {shownTab === 'tools' && (
              <ToolTableTab
                machineId={machine.id}
                connected={machine.connected}
                lastPollTime={machine.lastPollTime}
                toolSync={tools.toolSync}
                toolTable={tools.toolTable}
                hasPocketInfo={tools.hasPocketInfo}
                spindleTool={machine.data.toolNumber}
              />
            )}
          </div>
        )}
        {shownTab === 'settings' && (
          <SettingsTab machine={machine} machines={machines} rules={alertRules} onUpdate={onUpdate} onRemove={onRemove} />
        )}
      </div>
    </>
  );
}

/** True from the first render where `value` is true */
function useHasBeenTrue(value: boolean): boolean {
  const [hasBeenTrue, setHasBeenTrue] = useState(value);
  if (value && !hasBeenTrue) setHasBeenTrue(true);
  return hasBeenTrue || value;
}

/**
 * When the address names a tab that is not there, the address changes to the shown tab.
 * Else the tool table would open by itself later, when the machine sends it again.
 */
function useAddressOfShownTab(openTab: string | null, shownTab: SectionId) {
  const [, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (openTab === null || openTab === shownTab) return;
    setSearchParams(
      params => {
        const next = new URLSearchParams(params);
        next.delete(TAB_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [openTab, shownTab, setSearchParams]);
}

/** The number of firing alerts after the Dashboard tab name, in the alarm color. Nothing when no alert fires. */
function FiringCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <>
      {/* A real space: a browser joins the inline texts of the tab name with no space */}
      {' '}
      <span className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-alarm px-1.5 font-mono text-xs font-bold text-white">
        {count}
        <span className="sr-only"> {count === 1 ? 'alert' : 'alerts'} firing</span>
      </span>
    </>
  );
}
