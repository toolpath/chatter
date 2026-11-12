import type { InferResponseType } from 'hono/client';
import { api } from './client';
import { jsonOrThrow } from './replies';
import { sendWithProgress } from './sendWithProgress';

/** The version of Chatter, and updates to a new version */

type HealthReport = InferResponseType<typeof api.health.$get, 200>;

/** "1.2.0" for a release, "edge-<commit>" for a build from main, or "development" */
export async function fetchChatterVersion(): Promise<string> {
  const health = await jsonOrThrow<HealthReport>(await api.health.$get(), 'Could not load the Chatter version');
  return health.version;
}

const updates = api.updates;

/** The version, the update helper on the Pi card, the last check or install, and the free space */
export type UpdatesReport = InferResponseType<typeof updates.status.$get, 200>;

export async function fetchUpdatesReport(): Promise<UpdatesReport> {
  return jsonOrThrow(await updates.status.$get(), 'Could not load the updates');
}

/** Ask the update helper to check the update file. Throws an error with the server's reason. */
export async function checkUpdateFile(): Promise<UpdatesReport> {
  return jsonOrThrow(await updates.check.$post(), 'Could not ask for a check');
}

/** Ask the update helper to install the file that passed the check. Chatter stops for some minutes. */
export async function installUpdate(): Promise<UpdatesReport> {
  return jsonOrThrow(await updates.install.$post(), 'Could not start the install');
}

/** Start to download the newest release from GitHub. The report shows when the download ends. */
export async function downloadUpdate(): Promise<UpdatesReport> {
  return jsonOrThrow(await updates.download.$post(), 'Could not start the download');
}

/** Turn the daily check on GitHub on or off */
export async function saveUpdateSettings(settings: { checkGitHub: boolean }): Promise<UpdatesReport> {
  return jsonOrThrow(await updates.settings.$put({ json: settings }), 'Could not save the setting');
}

/** Send an update file from this computer, and tell how much is sent (0 to 1). Throws an error with the server's reason. */
export async function uploadUpdateFile(file: File, onProgress: (sent: number) => void): Promise<UpdatesReport> {
  const reply = await sendWithProgress(updates.file.$url().pathname, file, onProgress);
  return jsonOrThrow(reply, 'Could not upload the update file');
}
