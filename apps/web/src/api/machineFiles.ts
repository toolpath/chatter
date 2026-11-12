import type { FTPTreeNode, UploadEvent, UploadFile } from '../types';
import { readAtMost } from '../utils/readAtMost';
import { api } from './client';
import { errorOf, jsonOrThrow } from './replies';

/** Calls to the server for a machine's files and its upload history */

const UPLOAD_HISTORY_LIMIT = 20;
const FILE_TREE_DEPTH = 3;

/** One upload, with the file name and the file content */
export interface UploadEventDetail extends UploadEvent {
  file_name: string;
}

export interface BatchUploadResult {
  success?: Array<{ filename: string }>;
  failed?: Array<{ filename: string; error: string }>;
  error?: string;
}

const machine = api.machine[':id'];

/** The server reads a yes/no form field as the text "true" or "false" */
function formFlag(isOn: boolean): 'true' | 'false' {
  return isOn ? 'true' : 'false';
}

export async function fetchFileTree(machineId: string, path: string): Promise<FTPTreeNode[]> {
  const response = await machine.files.$get({ param: { id: machineId }, query: { path, depth: String(FILE_TREE_DEPTH) } });
  return jsonOrThrow(response, 'Failed to fetch files');
}

/** The address that downloads one file. The browser opens it, so it is not a fetch call. */
export function fileDownloadUrl(machineId: string, filePath: string): string {
  return machine.files.download.$url({ param: { id: machineId }, query: { path: filePath } }).toString();
}

/** The bytes of a file on the machine, read over FTP through the server. Throws FileTooBigError past `maxBytes`. */
export async function fetchFileBytes(machineId: string, filePath: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(fileDownloadUrl(machineId, filePath), { signal });
  const error = await errorOf(response, 'Failed to read the file');
  if (error) throw new Error(error);
  return readAtMost(response.body, maxBytes);
}

export async function fetchUploadFiles(machineId: string): Promise<UploadFile[]> {
  const response = await machine.uploads.$get({ param: { id: machineId }, query: { limit: String(UPLOAD_HISTORY_LIMIT) } });
  return jsonOrThrow(response, 'Failed to fetch upload history');
}

export async function fetchUploadEvents(machineId: string, fileId: number): Promise<UploadEvent[]> {
  const response = await machine.uploads[':fileId'].events.$get({ param: { id: machineId, fileId: String(fileId) } });
  return jsonOrThrow(response, 'Failed to fetch events');
}

export async function fetchUploadEvent(machineId: string, eventId: number): Promise<UploadEventDetail> {
  const response = await machine.uploads.events[':eventId'].$get({ param: { id: machineId, eventId: String(eventId) } });
  return jsonOrThrow(response, 'Failed to fetch event');
}

/** Returns the server's error text, or null when the file was deleted */
export async function deleteMachineFile(machineId: string, filePath: string): Promise<string | null> {
  const response = await machine.files.$delete({ param: { id: machineId }, query: { path: filePath } });
  return errorOf(response, 'Delete failed');
}

/** Send one earlier upload again, with overwrite on. Returns the error text, or null when it worked. */
export async function sendUploadAgain(machineId: string, event: UploadEventDetail): Promise<string | null> {
  const file = new File([event.file_content ?? ''], event.file_name, { type: 'text/plain' });
  const response = await machine.files.upload.$post({
    param: { id: machineId },
    form: { file, path: event.remote_path, overwrite: formFlag(true) },
  });
  return errorOf(response, 'Re-upload failed');
}

export async function uploadMachineFiles(
  machineId: string,
  files: File[],
  basePath: string,
  allowOverwrite: boolean,
  targetNames: Record<string, string>,
): Promise<{ ok: boolean; result: BatchUploadResult }> {
  const response = await machine.files['upload-batch'].$post({
    param: { id: machineId },
    form: { files, basePath, overwrite: formFlag(allowOverwrite), targetNames: JSON.stringify(targetNames) },
  });
  return { ok: response.ok, result: await response.json() };
}
