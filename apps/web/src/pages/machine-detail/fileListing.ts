import type { FTPTreeNode } from '../../types';

export interface FolderLink {
  name: string;
  path: string;
  /** 0 for a folder in the open folder, 1 for a folder in one of those */
  depth: number;
}

const DAY_MS = 86_400_000;

const byName = (a: FTPTreeNode, b: FTPTreeNode) => a.name.localeCompare(b.name, undefined, { numeric: true });

/** The folders in the open folder, each followed by its own folders */
export function foldersOf(tree: FTPTreeNode[]): FolderLink[] {
  const folders = tree.filter(node => node.type === 'directory').sort(byName);
  return folders.flatMap(folder => [
    { name: folder.name, path: folder.path, depth: 0 },
    ...(folder.children ?? [])
      .filter(child => child.type === 'directory')
      .sort(byName)
      .map(child => ({ name: child.name, path: child.path, depth: 1 })),
  ]);
}

/** The files in the open folder, by name. "O10" comes after "O9". */
export function filesOf(tree: FTPTreeNode[]): FTPTreeNode[] {
  return tree.filter(node => node.type === 'file').sort(byName);
}

/** The folder above `path`. The top folder "/" has no folder above it. */
export function parentPath(path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  return '/' + parts.slice(0, -1).join('/');
}

export interface PathCrumb {
  name: string;
  path: string;
}

/** "Top / USER / PROGRAMS": one link for each folder on the way to `path` */
export function pathCrumbs(path: string): PathCrumb[] {
  const crumbs = [{ name: 'Top', path: '/' }];
  let walked = '';
  for (const part of path.split('/').filter(Boolean)) {
    walked += '/' + part;
    crumbs.push({ name: part, path: walked });
  }
  return crumbs;
}

/** "Today 08:02", "Yesterday", or "2 Nov" */
export function formatChanged(modifiedAt: string | Date | undefined, now: number): string {
  if (!modifiedAt) return '—';
  const date = new Date(modifiedAt);
  if (Number.isNaN(date.getTime())) return '—';
  const today = new Date(now);
  const yesterday = new Date(now - DAY_MS);
  if (isSameDay(date, today)) return `Today ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  if (isSameDay(date, yesterday)) return 'Yesterday';
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== today.getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString(undefined, options);
}

function isSameDay(first: Date, second: Date): boolean {
  return first.toDateString() === second.toDateString();
}
