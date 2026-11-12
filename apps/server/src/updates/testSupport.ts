import { DEFAULT_RELEASES_REPO, memoryCheckSettingStore, ReleaseWatcher } from './ReleaseWatcher.js';

/** For tests: the switch is kept in memory, and nothing is ever asked from GitHub */
export function offlineReleases(): ReleaseWatcher {
  const noInternet = async () => {
    throw new TypeError('No internet in tests');
  };
  return new ReleaseWatcher({ repo: DEFAULT_RELEASES_REPO, store: memoryCheckSettingStore(), fetch: noInternet });
}
