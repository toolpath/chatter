import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useCan } from '../../components/CurrentUser';
import type { Machine, MachineUpdate } from '../../types';
import { AlertRulesSection } from './AlertRulesSection';
import { ConnectionSection } from './ConnectionSection';
import { DeleteMachineSection } from './DeleteMachineSection';
import { HistoryBackupSection } from './HistoryBackupSection';
import { MachineSettingsSection } from './MachineSettingsSection';
import type { AlertRules } from './useAlertRules';

/** The id of each section. A link to `?tab=settings#<id>` opens the Settings tab at that section. */
export const SETTINGS_SECTION_IDS = {
  machine: 'settings-machine',
  connection: 'settings-connection',
  alertRules: 'settings-alert-rules',
  advanced: 'settings-advanced',
  deleteMachine: 'settings-delete-machine',
} as const;

interface SettingsTabProps {
  machine: Machine;
  /** All machines. The alert rules can be copied to the others. */
  machines: Machine[];
  rules: AlertRules;
  onUpdate: (id: string, updates: MachineUpdate) => Promise<boolean>;
  onRemove: () => Promise<void>;
}

/**
 * Five panels, one under the other: the machine settings, the connection, the alert rules, Advanced, and Delete machine.
 * A user who cannot manage machines sees only the connection. The alert rules are settings, so the server does not give them to that user.
 */
export function SettingsTab({ machine, machines, rules, onUpdate, onRemove }: SettingsTabProps) {
  const canManageMachines = useCan('manage-machines');
  const canManageChatter = useCan('manage-chatter');
  useScrollToSection(!!rules.saved);

  const connection = (
    <SettingsSection id={SETTINGS_SECTION_IDS.connection} title="Connection">
      <ConnectionSection machine={machine} />
    </SettingsSection>
  );
  if (!canManageMachines) return <div className="flex flex-col gap-5">{connection}</div>;

  return (
    <div className="flex flex-col gap-5">
      <SettingsSection id={SETTINGS_SECTION_IDS.machine} title="Machine">
        <MachineSettingsSection machine={machine} onUpdate={onUpdate} />
      </SettingsSection>
      {connection}
      <SettingsSection id={SETTINGS_SECTION_IDS.alertRules} title="Alert rules">
        <AlertRulesSection machineId={machine.id} otherMachines={machines.filter(other => other.id !== machine.id)} rules={rules} />
      </SettingsSection>
      <AdvancedSection>
        <HistoryBackupSection machine={machine} canRestore={canManageChatter} />
      </AdvancedSection>
      <SettingsSection id={SETTINGS_SECTION_IDS.deleteMachine} title="Delete machine">
        <DeleteMachineSection machine={machine} onRemove={onRemove} />
      </SettingsSection>
    </div>
  );
}

/** These events show that the user moves the page or works on it */
const USER_MOVE_EVENTS = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const;

/**
 * A link from another tab to `#<id>` opens the Settings tab. The browser does not scroll then, so this does it.
 * It scrolls again when the alert rules load: before that, the page can be too short to bring the section to the top.
 * But when the user moved the page or worked on it after the link, the page stays where it is.
 */
function useScrollToSection(rulesLoaded: boolean) {
  const { hash, key } = useLocation();
  const userMoved = useRef(false);

  // Each new address starts again. This effect runs before the scroll below.
  useEffect(() => {
    userMoved.current = false;
    const noteMove = () => {
      userMoved.current = true;
    };
    for (const type of USER_MOVE_EVENTS) window.addEventListener(type, noteMove, { capture: true, passive: true });
    return () => {
      for (const type of USER_MOVE_EVENTS) window.removeEventListener(type, noteMove, { capture: true });
    };
  }, [key]);

  useEffect(() => {
    if (!hash || userMoved.current) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash, rulesLoaded]);
}

function SettingsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const titleId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={titleId} className="scroll-mt-4 rounded-xl border border-zinc-800 bg-zinc-900">
      <h2 id={titleId} className="m-0 px-4 pt-4 text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** Tools that a user seldom needs. The panel is closed until the user opens it. */
function AdvancedSection({ children }: { children: ReactNode }) {
  return (
    <section id={SETTINGS_SECTION_IDS.advanced} aria-label="Advanced" className="scroll-mt-4 rounded-xl border border-zinc-800 bg-zinc-900">
      <details>
        <summary className="cursor-pointer px-4 py-4 text-base font-bold">Advanced</summary>
        <h3 className="m-0 px-4 text-sm font-bold text-zinc-200">Backup and restore of the history</h3>
        {children}
      </details>
    </section>
  );
}
