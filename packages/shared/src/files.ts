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

export interface UploadEvent {
  id: number;
  target_name: string | null;
  remote_path: string;
  uploaded_at: string;
  file_content?: string;
}
