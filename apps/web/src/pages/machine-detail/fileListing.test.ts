import { describe, expect, it } from 'vitest';
import type { FTPTreeNode } from '../../types';
import { filesOf, foldersOf, formatChanged, parentPath, pathCrumbs } from './fileListing';

const file = (name: string): FTPTreeNode => ({ name, path: `/${name}`, type: 'file' }) as FTPTreeNode;
const folder = (name: string, children: FTPTreeNode[] = []): FTPTreeNode =>
  ({ name, path: `/${name}`, type: 'directory', children }) as FTPTreeNode;

describe('foldersOf', () => {
  it('lists each folder by name, followed by its own folders', () => {
    const tree = [folder('USER', [folder('B'), file('x'), folder('A')]), file('O1'), folder('DATA')];
    expect(foldersOf(tree).map(({ name, depth }) => `${depth}:${name}`)).toEqual(['0:DATA', '0:USER', '1:A', '1:B']);
  });
});

describe('filesOf', () => {
  it('lists only the files, with numbers in number order', () => {
    expect(filesOf([file('O10'), folder('USER'), file('O9')]).map(node => node.name)).toEqual(['O9', 'O10']);
  });
});

describe('parentPath', () => {
  it('gives the folder above, or null at the top', () => {
    expect(parentPath('/USER/PROGRAMS')).toBe('/USER');
    expect(parentPath('/USER')).toBe('/');
    expect(parentPath('/')).toBeNull();
  });
});

describe('pathCrumbs', () => {
  it('gives a link for each folder, starting at "Top"', () => {
    expect(pathCrumbs('/USER/PROGRAMS')).toEqual([
      { name: 'Top', path: '/' },
      { name: 'USER', path: '/USER' },
      { name: 'PROGRAMS', path: '/USER/PROGRAMS' },
    ]);
  });
});

describe('formatChanged', () => {
  const now = new Date(2026, 10, 6, 12, 0).getTime();

  it('says "Today" with the time, or "Yesterday"', () => {
    expect(formatChanged(new Date(2026, 10, 6, 8, 2), now)).toMatch(/^Today /);
    expect(formatChanged(new Date(2026, 10, 5, 8, 2), now)).toBe('Yesterday');
  });

  it('adds the year only for another year, and gives a dash for no date', () => {
    expect(formatChanged(new Date(2026, 9, 2), now)).not.toMatch(/2026/);
    expect(formatChanged(new Date(2025, 9, 2), now)).toMatch(/2025/);
    expect(formatChanged(undefined, now)).toBe('—');
    expect(formatChanged('not a date', now)).toBe('—');
  });
});
