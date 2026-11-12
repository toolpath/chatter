import { describe, it, expect } from 'vitest';
import { parseFilePath, parseRawList } from './FTPClient.js';

describe('parseFilePath', () => {
  describe('root directory files', () => {
    it('should parse simple filename in root', () => {
      const result = parseFilePath('O0100.NC');
      expect(result.dirPath).toBe('/');
      expect(result.fileName).toBe('O0100.NC');
    });

    it('should parse filename with spaces in root', () => {
      const result = parseFilePath('my file.txt');
      expect(result.dirPath).toBe('/');
      expect(result.fileName).toBe('my file.txt');
    });

    it('should parse filename with dots in root', () => {
      const result = parseFilePath('file.backup.nc');
      expect(result.dirPath).toBe('/');
      expect(result.fileName).toBe('file.backup.nc');
    });
  });

  describe('single subdirectory files', () => {
    it('should parse file in subdirectory', () => {
      const result = parseFilePath('TEST/O0100.NC');
      expect(result.dirPath).toBe('/TEST');
      expect(result.fileName).toBe('O0100.NC');
    });

    it('should parse file in subdirectory with different name', () => {
      const result = parseFilePath('PROGRAMS/mypart.nc');
      expect(result.dirPath).toBe('/PROGRAMS');
      expect(result.fileName).toBe('mypart.nc');
    });
  });

  describe('nested subdirectory files', () => {
    it('should parse file in nested subdirectory', () => {
      const result = parseFilePath('TEST/SUBDIR/O0100.NC');
      expect(result.dirPath).toBe('/TEST/SUBDIR');
      expect(result.fileName).toBe('O0100.NC');
    });

    it('should parse file in deeply nested subdirectory', () => {
      const result = parseFilePath('a/b/c/d/file.txt');
      expect(result.dirPath).toBe('/a/b/c/d');
      expect(result.fileName).toBe('file.txt');
    });
  });

  describe('edge cases', () => {
    it('should handle empty filename after slash', () => {
      // This is an edge case - trailing slash
      const result = parseFilePath('TEST/');
      expect(result.dirPath).toBe('/TEST');
      expect(result.fileName).toBe('');
    });

    it('should handle single character filename', () => {
      const result = parseFilePath('X');
      expect(result.dirPath).toBe('/');
      expect(result.fileName).toBe('X');
    });

    it('should handle single character directory and filename', () => {
      const result = parseFilePath('A/B');
      expect(result.dirPath).toBe('/A');
      expect(result.fileName).toBe('B');
    });
  });

  describe('ensures correct directory listing behavior', () => {
    it('should NOT confuse root file with same name in subdirectory', () => {
      // This was the original bug: O0100.NC in root was being detected
      // when checking for TEST/O0100.NC
      const rootFile = parseFilePath('O0100.NC');
      const subdirFile = parseFilePath('TEST/O0100.NC');

      // They should have different directory paths
      expect(rootFile.dirPath).not.toBe(subdirFile.dirPath);
      expect(rootFile.dirPath).toBe('/');
      expect(subdirFile.dirPath).toBe('/TEST');

      // But same filename
      expect(rootFile.fileName).toBe(subdirFile.fileName);
      expect(rootFile.fileName).toBe('O0100.NC');
    });
  });
});

describe('parseRawList', () => {
  describe('Unix format', () => {
    it('should parse Unix directory listing', () => {
      const rawData = 'drwxr-xr-x  2 user group 4096 Jan  1 12:00 mydir';
      const result = parseRawList(rawData);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('mydir');
      expect(result[0].isDir).toBe(true);
      expect(result[0].size).toBe(4096);
    });

    it('should parse Unix file listing', () => {
      const rawData = '-rw-r--r--  1 user group 12345 Dec 25 10:30 file.txt';
      const result = parseRawList(rawData);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('file.txt');
      expect(result[0].isDir).toBe(false);
      expect(result[0].size).toBe(12345);
    });

    it('should parse Unix listing with multiple entries', () => {
      const rawData = `drwxr-xr-x  2 user group 4096 Jan  1 12:00 subdir
-rw-r--r--  1 user group 1024 Jan  2 14:30 file1.nc
-rw-r--r--  1 user group 2048 Jan  3 09:15 file2.nc`;
      const result = parseRawList(rawData);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ name: 'subdir', isDir: true, size: 4096 });
      expect(result[1]).toEqual({ name: 'file1.nc', isDir: false, size: 1024 });
      expect(result[2]).toEqual({ name: 'file2.nc', isDir: false, size: 2048 });
    });

    it('should handle filenames with spaces in Unix format', () => {
      const rawData = '-rw-r--r--  1 user group 500 Jan  1 12:00 my file name.txt';
      const result = parseRawList(rawData);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('my file name.txt');
    });
  });

  describe('DOS format', () => {
    it('should parse DOS directory listing', () => {
      const rawData = '01-15-24  03:30PM  <DIR>  PROGRAMS';
      const result = parseRawList(rawData);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('PROGRAMS');
      expect(result[0].isDir).toBe(true);
    });

    it('should parse DOS file listing', () => {
      const rawData = '12-25-24  10:00AM  8192  O0100.NC';
      const result = parseRawList(rawData);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('O0100.NC');
      expect(result[0].isDir).toBe(false);
      expect(result[0].size).toBe(8192);
    });

    it('should parse DOS listing with multiple entries', () => {
      const rawData = `01-01-24  12:00PM  <DIR>  TEST
01-02-24  09:30AM  1234  O0001.NC
01-03-24  02:45PM  5678  O0002.NC`;
      const result = parseRawList(rawData);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ name: 'TEST', isDir: true, size: 0 });
      expect(result[1]).toEqual({ name: 'O0001.NC', isDir: false, size: 1234 });
      expect(result[2]).toEqual({ name: 'O0002.NC', isDir: false, size: 5678 });
    });
  });

  describe('simple format', () => {
    it('should parse simple filename listing', () => {
      const rawData = 'O0100.NC';
      const result = parseRawList(rawData);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('O0100.NC');
      expect(result[0].isDir).toBe(false);
      expect(result[0].size).toBe(0);
    });

    it('should parse multiple simple filenames', () => {
      const rawData = `O0100.NC
O0200.NC
O0300.NC`;
      const result = parseRawList(rawData);

      expect(result).toHaveLength(3);
      expect(result.map(e => e.name)).toEqual(['O0100.NC', 'O0200.NC', 'O0300.NC']);
    });
  });

  describe('edge cases', () => {
    it('should filter out . and .. entries', () => {
      const result = parseRawList('.\n..\nrealfile.txt');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('realfile.txt');
    });

    it.each([
      { input: '', desc: 'empty input' },
      { input: '   \n\n   \r\n   ', desc: 'whitespace only' },
    ])('should return empty for $desc', ({ input }) => {
      expect(parseRawList(input)).toHaveLength(0);
    });

    it.each([
      { input: 'file1.nc\r\nfile2.nc\r\nfile3.nc', desc: 'CRLF' },
      { input: 'file1.nc\nfile2.nc\nfile3.nc', desc: 'LF' },
    ])('should handle $desc line endings', ({ input }) => {
      expect(parseRawList(input)).toHaveLength(3);
    });
  });
});
