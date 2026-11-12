import { roleCan, type Permission } from '@local-chatter/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchChatterVersion } from '../../api/updates';
import { useCurrentUser } from '../../components/CurrentUser';
import { tabPanelProps } from '../../components/ui/tabPanel';
import { UnderlineTabs, type TabItem } from '../../components/ui/UnderlineTabs';
import { AccountTab } from './AccountTab';
import { FocasLibraryTab } from './FocasLibrary';
import { LoginsTab } from './LoginsTab';
import { ProxyTab } from './ProxyTab';
import { UpdatesTab } from './UpdatesTab';
import { UsersTab } from './UsersTab';

type SettingsTab = 'account' | 'users' | 'proxy' | 'logins' | 'fanuc' | 'updates';

interface SettingsTabItem extends TabItem<SettingsTab> {
  content: () => ReactNode;
  /** Only a user whose role can do this sees the tab */
  needs?: Permission;
}

const TABS: SettingsTabItem[] = [
  { id: 'account', label: 'Your account', content: AccountTab },
  { id: 'users', label: 'Users and roles', content: UsersTab, needs: 'manage-chatter' },
  { id: 'proxy', label: 'HTTPS and proxy', content: ProxyTab, needs: 'manage-chatter' },
  { id: 'logins', label: 'Logins', content: LoginsTab, needs: 'manage-chatter' },
  { id: 'fanuc', label: 'FANUC library', content: FocasLibraryTab, needs: 'manage-machines' },
  { id: 'updates', label: 'Updates', content: UpdatesTab, needs: 'manage-updates' },
];
const ID_PREFIX = 'settings';
/** The address keeps the open tab (for example /settings?tab=proxy), so a reload or a link opens the same tab */
const TAB_PARAM = 'tab';

/** The tabs that the user can open */
function useShownTabs(): SettingsTabItem[] {
  const user = useCurrentUser();
  return TABS.filter(tab => !tab.needs || (user !== null && roleCan(user.role, tab.needs)));
}

/** The settings of your account and, for an admin, of the whole Chatter server, in tabs */
export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabs = useShownTabs();
  // An unknown tab, or a tab that the role cannot open, opens the first tab
  const openTab = tabs.find(tab => tab.id === searchParams.get(TAB_PARAM)) ?? tabs[0];
  const OpenTabContent = openTab.content;

  return (
    <>
      <h1 className="m-0 font-display text-2xl font-extrabold">Settings</h1>
      <UnderlineTabs
        label="Settings sections"
        tabs={tabs}
        value={openTab.id}
        onChange={tab => setSearchParams({ [TAB_PARAM]: tab }, { replace: true })}
        idPrefix={ID_PREFIX}
      />
      <div {...tabPanelProps(ID_PREFIX, openTab.id)} className="flex flex-col gap-5">
        <OpenTabContent />
      </div>
      <ChatterVersion />
    </>
  );
}

/** The version of this Chatter, for each user. It shows nothing until it loads, or if it cannot load. */
function ChatterVersion() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let isCurrent = true;
    // The version is only a hint, so a failed load shows nothing and is not an error
    const ignoreLoadError = () => {};
    fetchChatterVersion().then(loaded => isCurrent && setVersion(loaded), ignoreLoadError);
    return () => {
      isCurrent = false;
    };
  }, []);
  if (!version) return null;
  return <p className="m-0 text-xs text-zinc-300">Chatter version {version}</p>;
}
