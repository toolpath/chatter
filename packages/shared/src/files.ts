// ============================================
// FTP Types
// ============================================

export interface FTPFileInfo {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt?: string | Date;
  path: string;
}

export interface FTPTreeNode extends FTPFileInfo {
  children?: FTPTreeNode[];
}

/** The most entries (files and folders) in one file tree, so a very large or rogue FTP server cannot fill the memory */
export const FILE_TREE_ENTRY_LIMIT = 5000;

/** A file tree, and whether Chatter cut it at FILE_TREE_ENTRY_LIMIT entries */
export interface FileTree {
  nodes: FTPTreeNode[];
  isCutShort: boolean;
}

/**
 * The file list reply has this header, with the value "true", when Chatter cut the list short.
 * A header keeps the reply body a plain list, as the API docs show it.
 */
export const FILE_LIST_CUT_SHORT_HEADER = 'X-Chatter-List-Cut-Short';

/**
 * The largest body of one program upload, for all its files: 32 MiB.
 * The server holds the files in memory while it sends them, and a Pi has only 512 MB.
 */
export const PROGRAM_UPLOAD_LIMIT_BYTES = 32 * 1024 * 1024;

// ============================================
// Upload History Types
// ============================================

export interface UploadFile {
  id: number;
  file_name: string;
  created_at: string;
  updated_at: string;
  event_count: number;
  last_path: string;
}

/**
 * What a user did to a file. Today each row is a send: the audit log alone records a delete.
 * A row from an older version is a send too.
 */
export type UploadAction = 'sent' | 'deleted';

/** One send of a file. A row from before Chatter recorded the user has null in uploaded_by and address. */
export interface UploadEvent {
  id: number;
  target_name: string | null;
  remote_path: string;
  uploaded_at: string;
  action: UploadAction;
  /** The user who sent the file. Only a role that can read programs gets it, so a Viewer does not (decision D4). */
  uploaded_by?: string | null;
  /** The address of the computer of that user. Only an Admin gets it. */
  address?: string | null;
  file_content?: string;
}
