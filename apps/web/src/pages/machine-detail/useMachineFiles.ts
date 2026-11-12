import { useEffect, useRef, useState } from 'react';
import { fetchFileTree } from '../../api/machineFiles';
import type { FTPTreeNode } from '../../types';
import { errorMessageOf } from '../../utils/errorMessage';

/** The machine's file tree, for the folder that is open now */
export function useMachineFiles(machineId: string) {
  const [files, setFiles] = useState<FTPTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState('/');
  // New uploads go to the folder that was loaded last
  const [uploadPath, setUploadPath] = useState('/');
  // A folder takes a second or two to load. Only the newest request may change the list,
  // so a slow answer for the folder before cannot replace the folder that is open now.
  const newestRequest = useRef(0);

  const refresh = async (path: string = currentPath) => {
    const request = ++newestRequest.current;
    const isNewest = () => request === newestRequest.current;
    setLoading(true);
    setError(null);
    try {
      const tree = await fetchFileTree(machineId, path);
      if (!isNewest()) return;
      setFiles(tree);
      setUploadPath(path);
    } catch (err) {
      if (isNewest()) setError(errorMessageOf(err, 'Unknown error'));
    } finally {
      if (isNewest()) setLoading(false);
    }
  };

  const openFolder = (path: string) => {
    setCurrentPath(path);
    refresh(path);
  };

  useEffect(() => {
    refresh();
    // Load again only when the machine changes
  }, [machineId]);

  return { files, loading, error, currentPath, uploadPath, refresh, openFolder };
}

export type MachineFiles = ReturnType<typeof useMachineFiles>;
