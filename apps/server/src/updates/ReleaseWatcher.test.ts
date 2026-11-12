import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNewerVersion, releasesRepo, ReleaseWatcher, type CheckSettingStore } from './ReleaseWatcher.js';

const REPO = 'toolpath/chatter';
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ARMV7_FILE_NAME = 'chatter-update-1.3.0-armv7.tar';

const asset = (name: string) => ({ name, size: 1000, browser_download_url: `https://github.com/${REPO}/releases/download/v1.3.0/${name}` });
const RELEASE = { tag_name: 'v1.3.0', assets: [asset(ARMV7_FILE_NAME), asset('chatter-update-1.3.0-arm64.tar')] };

type FakeFetch = (address: string | URL | Request, init?: RequestInit) => Promise<Response>;

function jsonReply(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function memoryStore(saved?: string): CheckSettingStore & { saved?: string } {
  const store = { saved, read: () => store.saved, write: (value: string) => void (store.saved = value) };
  return store;
}

function watcherWith(fetchReply: FakeFetch, { store = memoryStore(), idleMs }: { store?: ReturnType<typeof memoryStore>; idleMs?: number } = {}) {
  const fetch = vi.fn(fetchReply);
  const watcher = new ReleaseWatcher({ repo: REPO, store, fetch: fetch as typeof globalThis.fetch, idleMs });
  return { watcher, fetch, store };
}

/** A fake GitHub that is online only while isOnline() is true */
function watcherOnlineWhen(isOnline: () => boolean) {
  return watcherWith(async () => {
    if (isOnline()) return jsonReply(RELEASE);
    throw new TypeError('fetch failed');
  });
}

describe('isNewerVersion', () => {
  it('compares the numbers part by part', () => {
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.99.99')).toBe(true);
    expect(isNewerVersion('1.2.0', '1.2.0')).toBe(false);
    expect(isNewerVersion('1.2.0', '1.3.0')).toBe(false);
  });

  it('never calls a version newer than a build that is not a release', () => {
    expect(isNewerVersion('1.3.0', 'edge-1a2b3c4')).toBe(false);
  });
});

describe('releasesRepo', () => {
  it('uses CHATTER_RELEASES_REPO, or the Chatter repo', () => {
    expect(releasesRepo({})).toBe(REPO);
    expect(releasesRepo({ CHATTER_RELEASES_REPO: 'me/my-chatter' })).toBe('me/my-chatter');
  });

  it('stops the start for a repo name that is not owner/repo', () => {
    expect(() => releasesRepo({ CHATTER_RELEASES_REPO: 'me/../x?y' })).toThrow('CHATTER_RELEASES_REPO');
  });
});

describe('ReleaseWatcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the newest release from GitHub', async () => {
    const { watcher, fetch } = watcherWith(async () => jsonReply(RELEASE));

    await watcher.checkNow();

    expect(fetch).toHaveBeenCalledWith(LATEST_URL, expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/vnd.github+json' }) }));
    expect(watcher.newest()).toMatchObject({ checkGitHub: true, version: '1.3.0', error: null, checkedAt: expect.any(String) });
    expect(watcher.assetNamed(ARMV7_FILE_NAME)).toEqual({
      name: ARMV7_FILE_NAME, size: 1000, url: RELEASE.assets[0].browser_download_url,
    });
  });

  it('says when it could not reach GitHub', async () => {
    const { watcher } = watcherOnlineWhen(() => false);

    await watcher.checkNow();

    expect(watcher.newest()).toMatchObject({ version: null, error: 'Could not check: no internet' });
  });

  it('keeps the newest release of the last good check when a later check fails', async () => {
    let isOnline = true;
    const { watcher } = watcherOnlineWhen(() => isOnline);
    await watcher.checkNow();

    isOnline = false;
    await watcher.checkNow();

    expect(watcher.newest()).toMatchObject({ version: '1.3.0', error: 'Could not check: no internet' });
    expect(watcher.assetNamed(ARMV7_FILE_NAME)).toBeDefined();
  });

  it('clears the error at the next good check', async () => {
    let isOnline = false;
    const { watcher } = watcherOnlineWhen(() => isOnline);
    await watcher.checkNow();

    isOnline = true;
    await watcher.checkNow();

    expect(watcher.newest()).toMatchObject({ version: '1.3.0', error: null });
  });

  it('gives a clear reason for a reply that has no release', async () => {
    const { watcher } = watcherWith(async () => jsonReply({ message: 'Not Found' }, 404));
    await watcher.checkNow();
    expect(watcher.newest().error).toBe(`Could not check: GitHub has no release of ${REPO} (HTTP 404)`);
  });

  it('refuses a release whose tag is not a version', async () => {
    const { watcher } = watcherWith(async () => jsonReply({ ...RELEASE, tag_name: 'nightly' }));
    await watcher.checkNow();
    expect(watcher.newest()).toMatchObject({ version: null, error: 'Could not check: the newest release has no version number' });
  });

  it('checks GitHub by default, and saves when you turn it off', async () => {
    const { watcher, fetch, store } = watcherWith(async () => jsonReply(RELEASE));
    expect(watcher.newest().checkGitHub).toBe(true);

    await watcher.setCheckGitHub(false);
    await watcher.checkNow();

    expect(store.saved).toBe('off');
    expect(fetch).not.toHaveBeenCalled();
    expect(watcher.newest()).toEqual({ checkGitHub: false, version: null, error: null, checkedAt: null });
  });

  it('checks at once when you turn it on', async () => {
    const { watcher, fetch } = watcherWith(async () => jsonReply(RELEASE), { store: memoryStore('off') });
    expect(watcher.newest().checkGitHub).toBe(false);

    await watcher.setCheckGitHub(true);

    expect(fetch).toHaveBeenCalledOnce();
    expect(watcher.newest().version).toBe('1.3.0');
  });

  it('checks at the start, and then once a day', async () => {
    vi.useFakeTimers();
    const { watcher, fetch } = watcherWith(async () => jsonReply(RELEASE));

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ONE_DAY_MS);
    expect(fetch).toHaveBeenCalledTimes(2);

    watcher.stop();
  });

  describe('release files', () => {
    const ASSET_URL = RELEASE.assets[0].browser_download_url;
    const STORAGE_URL = 'https://release-assets.githubusercontent.com/file?sig=abc';
    const SHORT_IDLE_MS = 30;

    /** A fake GitHub: the latest release, and a fake reply for every other address */
    function watcherWithFileReply(fileReply: FakeFetch, idleMs?: number) {
      return watcherWith(async (address, init) => (String(address) === LATEST_URL ? jsonReply(RELEASE) : fileReply(address, init)), { idleMs });
    }

    /** A fake GitHub: each address gives its reply */
    function watcherWithReplies(release: object, replies: Record<string, () => Response>) {
      return watcherWith(async address => {
        if (String(address) === LATEST_URL) return jsonReply(release);
        const reply = replies[String(address)];
        if (!reply) throw new Error(`The test did not expect ${String(address)}`);
        return reply();
      });
    }

    /** Check GitHub, then start the download of the armv7 update file */
    async function openArmv7File(watcher: ReleaseWatcher): Promise<ReadableStream<Uint8Array>> {
      await watcher.checkNow();
      return watcher.openAsset(watcher.assetNamed(ARMV7_FILE_NAME)!);
    }

    const redirectTo = (location: string) => () => new Response(null, { status: 302, headers: { Location: location } });
    const fileReply = () => new Response('update file');

    it('only keeps release files on GitHub', async () => {
      const elsewhere = { ...asset('chatter-update-1.3.0-amd64.tar'), browser_download_url: 'https://example.com/chatter-update-1.3.0-amd64.tar' };
      const lookalike = { ...asset('chatter-update-1.3.0-x.tar'), browser_download_url: 'https://github.com.example.com/x.tar' };
      const { watcher } = watcherWithReplies({ ...RELEASE, assets: [...RELEASE.assets, elsewhere, lookalike] }, {});

      await watcher.checkNow();

      expect(watcher.assetNamed(ARMV7_FILE_NAME)).toBeDefined();
      expect(watcher.assetNamed('chatter-update-1.3.0-amd64.tar')).toBeUndefined();
      expect(watcher.assetNamed('chatter-update-1.3.0-x.tar')).toBeUndefined();
    });

    it('follows the redirect from github.com to the GitHub file storage', async () => {
      const { watcher } = watcherWithReplies(RELEASE, { [ASSET_URL]: redirectTo(STORAGE_URL), [STORAGE_URL]: fileReply });

      const body = await openArmv7File(watcher);

      expect(await new Response(body).text()).toBe('update file');
    });

    it('refuses a redirect to an address that is not on GitHub', async () => {
      const otherUrl = 'https://example.com/chatter-update.tar';
      const { watcher, fetch } = watcherWithReplies(RELEASE, { [ASSET_URL]: redirectTo(otherUrl), [otherUrl]: fileReply });

      await expect(openArmv7File(watcher)).rejects.toThrow('example.com is not GitHub');
      expect(fetch).not.toHaveBeenCalledWith(otherUrl, expect.anything());
    });

    it('stops when GitHub sends no reply for the idle time', async () => {
      const neverReply: FakeFetch = (_address, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
      const { watcher } = watcherWithFileReply(neverReply, SHORT_IDLE_MS);

      await expect(openArmv7File(watcher)).rejects.toThrow('GitHub sent no reply');
    });

    it('lets the body of the file take longer than the idle time once GitHub replied', async () => {
      const slowFile: FakeFetch = async (_address, init) => {
        const reply = new Response(new ReadableStream({
          async start(controller) {
            await new Promise(resolve => setTimeout(resolve, 2 * SHORT_IDLE_MS));
            controller.enqueue(new TextEncoder().encode('update file'));
            controller.close();
          },
        }));
        init?.signal?.addEventListener('abort', () => void reply.body?.cancel());
        return reply;
      };
      const { watcher } = watcherWithFileReply(slowFile, SHORT_IDLE_MS);

      const body = await openArmv7File(watcher);

      expect(await new Response(body).text()).toBe('update file');
    });

    it('stops after too many redirects', async () => {
      const { watcher } = watcherWithReplies(RELEASE, { [ASSET_URL]: redirectTo(ASSET_URL) });

      await expect(openArmv7File(watcher)).rejects.toThrow('too many redirects');
    });
  });
});
