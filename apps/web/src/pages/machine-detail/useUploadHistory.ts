import { useEffect, useState } from 'react';
import { fetchUploadEvents, fetchUploadFiles } from '../../api/machineFiles';
import type { UploadEvent, UploadFile } from '../../types';

/** The files sent to the machine before, and the sends (versions) of the file that is picked */
export function useUploadHistory(machineId: string) {
  const [historyFiles, setHistoryFiles] = useState<UploadFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [fileEvents, setFileEvents] = useState<Record<number, UploadEvent[]>>({});

  const refresh = async () => {
    setLoading(true);
    try {
      setHistoryFiles(await fetchUploadFiles(machineId));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  /** The sends of one file, newest first. They are loaded once, then kept, unless `reload` is true. */
  const loadEvents = async (fileId: number, reload = false): Promise<UploadEvent[]> => {
    if (!reload && fileEvents[fileId]) return fileEvents[fileId];
    const events = await fetchUploadEvents(machineId, fileId);
    setFileEvents(prev => ({ ...prev, [fileId]: events }));
    return events;
  };

  /** Like `loadEvents`, but an error shows the "could not load" text instead of being thrown */
  const loadEventsOrShowFailure = async (fileId: number, reload = false) => {
    try {
      await loadEvents(fileId, reload);
    } catch {
      setFailed(true);
    }
  };

  const select = async (fileId: number | null) => {
    setSelectedFileId(fileId);
    if (fileId !== null) await loadEventsOrShowFailure(fileId);
  };

  /** Load the history again, and the sends of the picked file */
  const refreshAll = async () => {
    await refresh();
    if (selectedFileId !== null) await loadEventsOrShowFailure(selectedFileId, true);
  };

  useEffect(() => {
    setSelectedFileId(null);
    setFileEvents({});
    refresh();
    // Load again only when the machine changes
  }, [machineId]);

  const selectedEvents = selectedFileId === null ? undefined : fileEvents[selectedFileId];
  return { historyFiles, loading, failed, selectedFileId, selectedEvents, select, loadEvents, refreshAll };
}

export type UploadHistory = ReturnType<typeof useUploadHistory>;
