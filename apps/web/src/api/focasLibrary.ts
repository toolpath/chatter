import type { InferResponseType } from 'hono/client';
import { api } from './client';
import { jsonOrThrow } from './replies';

/** The FANUC FOCAS2 library on the server: which file this computer needs, and which file Chatter uses */

const focas = api.focas;

export type FocasLibraryStatus = InferResponseType<typeof focas.status.$get, 200>;

export async function fetchFocasStatus(): Promise<FocasLibraryStatus> {
  return jsonOrThrow(await focas.status.$get(), 'Could not load the FANUC library status');
}

/** Throws an error with the server's reason, for example a file for another processor */
export async function uploadFocasLibrary(file: File): Promise<FocasLibraryStatus> {
  return jsonOrThrow(await focas.library.$post({ form: { file } }), 'Could not upload the FANUC library');
}

export async function removeFocasLibrary(): Promise<FocasLibraryStatus> {
  return jsonOrThrow(await focas.library.$delete(), 'Could not remove the FANUC library');
}
