import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';

const mockAccess = vi.fn();
const mockList = vi.fn();
const mockUploadFrom = vi.fn();
const mockSend = vi.fn();
const mockRemove = vi.fn();
const mockClose = vi.fn();

const mockFtpClient = {
  access: mockAccess,
  list: mockList,
  uploadFrom: mockUploadFrom,
  send: mockSend,
  remove: mockRemove,
  close: mockClose,
  ftp: { verbose: false },
};

vi.mock('basic-ftp', () => ({
  Client: vi.fn(() => mockFtpClient),
}));

// Imported after vi.mock so FTPClient gets the mock basic-ftp
import { FTPClient } from './FTPClient.js';

/** Upload entries named O0100.NC, O0200.NC, ... with content1, content2, ... */
function programFiles(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    remotePath: `O0${index + 1}00.NC`,
    source: `content${index + 1}`,
  }));
}

/** Check that the FTP client connected with these settings (other settings can be anything) */
function expectConnectedWith(settings: Record<string, unknown>) {
  expect(mockAccess).toHaveBeenCalledWith(expect.objectContaining(settings));
}

describe('FTPClient upload behavior', () => {
  let ftpClient: FTPClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(undefined);
    mockSend.mockResolvedValue({ code: 200, message: 'OK' });
    mockUploadFrom.mockResolvedValue(undefined);
    mockClose.mockReturnValue(undefined);

    ftpClient = new FTPClient({
      host: '192.168.1.100',
      port: 21,
      user: 'anonymous',
      password: '',
    });
  });

  describe('uploadFile', () => {
    describe('file existence check', () => {
      it('should check if file exists before uploading when overwrite is disabled', async () => {
        mockList.mockResolvedValue([]);

        await ftpClient.uploadFile('TEST/O0100.NC', 'G00 X0 Y0');

        expect(mockList).toHaveBeenCalledWith('/TEST');
        expect(mockUploadFrom).toHaveBeenCalled();
      });

      it('should reject upload when file exists and overwrite is disabled', async () => {
        mockList.mockResolvedValue([
          { name: 'O0100.NC', type: 1, size: 100 },
        ]);

        await expect(
          ftpClient.uploadFile('TEST/O0100.NC', 'content')
        ).rejects.toThrow('File "TEST/O0100.NC" already exists');

        expect(mockUploadFrom).not.toHaveBeenCalled();
      });

      it('should skip existence check when overwrite is enabled', async () => {
        await ftpClient.uploadFile('TEST/O0100.NC', 'content', true);

        expect(mockList).not.toHaveBeenCalled();
        expect(mockUploadFrom).toHaveBeenCalled();
      });

      it('should check correct directory for root files', async () => {
        mockList.mockResolvedValue([]);

        await ftpClient.uploadFile('O0100.NC', 'content');

        expect(mockList).toHaveBeenCalledWith('/');
      });

      it('should check correct directory for nested paths', async () => {
        mockList.mockResolvedValue([]);

        await ftpClient.uploadFile('PROGRAMS/2024/PARTS/O0100.NC', 'content');

        expect(mockList).toHaveBeenCalledWith('/PROGRAMS/2024/PARTS');
      });

      it('should allow upload when different file exists in directory', async () => {
        mockList.mockResolvedValue([
          { name: 'O0200.NC', type: 1, size: 100 },
          { name: 'O0300.NC', type: 1, size: 200 },
        ]);

        await ftpClient.uploadFile('TEST/O0100.NC', 'content');

        expect(mockUploadFrom).toHaveBeenCalled();
      });
    });

    describe('path cleaning', () => {
      it('should remove leading ./ from path', async () => {
        mockList.mockResolvedValue([]);

        await ftpClient.uploadFile('./TEST/O0100.NC', 'content');

        expect(mockUploadFrom).toHaveBeenCalledWith(
          expect.any(Readable),
          'TEST/O0100.NC'
        );
      });

      it('should remove leading / from path', async () => {
        mockList.mockResolvedValue([]);

        await ftpClient.uploadFile('/TEST/O0100.NC', 'content');

        expect(mockUploadFrom).toHaveBeenCalledWith(
          expect.any(Readable),
          'TEST/O0100.NC'
        );
      });
    });

    describe('content handling', () => {
      it('should accept string content', async () => {
        mockList.mockResolvedValue([]);

        await ftpClient.uploadFile('file.nc', 'string content');

        expect(mockUploadFrom).toHaveBeenCalled();
      });

      it('should accept Buffer content', async () => {
        mockList.mockResolvedValue([]);

        await ftpClient.uploadFile('file.nc', Buffer.from('buffer content'));

        expect(mockUploadFrom).toHaveBeenCalled();
      });

      it('should accept stream content', async () => {
        mockList.mockResolvedValue([]);

        const stream = Readable.from(['stream', ' ', 'content']);
        await ftpClient.uploadFile('file.nc', stream);

        expect(mockUploadFrom).toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should close connection on success', async () => {
        mockList.mockResolvedValue([]);

        await ftpClient.uploadFile('file.nc', 'content');

        expect(mockClose).toHaveBeenCalled();
      });

      it('should close connection on error', async () => {
        mockAccess.mockRejectedValue(new Error('Connection failed'));

        await expect(ftpClient.uploadFile('file.nc', 'content')).rejects.toThrow();

        expect(mockClose).toHaveBeenCalled();
      });

      it('should wrap FTP errors with descriptive message', async () => {
        mockList.mockResolvedValue([]);
        mockUploadFrom.mockRejectedValue(new Error('Permission denied'));

        await expect(ftpClient.uploadFile('file.nc', 'content')).rejects.toThrow(
          'FTP upload error: Permission denied'
        );
      });

      it('should preserve "already exists" error message', async () => {
        mockList.mockResolvedValue([{ name: 'file.nc', type: 1, size: 100 }]);

        await expect(ftpClient.uploadFile('file.nc', 'content')).rejects.toThrow(
          'already exists'
        );
      });
    });
  });

  describe('uploadFiles (batch)', () => {
    it('should upload multiple files and track results', async () => {
      mockList.mockResolvedValue([]);

      const result = await ftpClient.uploadFiles(programFiles(3));

      expect(result.success).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
      expect(mockUploadFrom).toHaveBeenCalledTimes(3);
    });

    it('should track individual file failures', async () => {
      mockList
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ name: 'O0200.NC', type: 1, size: 100 }]) // only O0200.NC is already there
        .mockResolvedValueOnce([]);

      const result = await ftpClient.uploadFiles(programFiles(3));

      expect(result.success).toHaveLength(2);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].remotePath).toBe('O0200.NC');
      expect(result.failed[0].error).toContain('already exists');
    });

    it('should continue uploading after individual failures', async () => {
      mockList.mockResolvedValue([]);
      mockUploadFrom
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(undefined);

      const result = await ftpClient.uploadFiles(programFiles(3));

      expect(result.success).toHaveLength(2);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].remotePath).toBe('O0200.NC');
    });

    it('should skip existence check when overwrite enabled', async () => {
      await ftpClient.uploadFiles(programFiles(2), true);

      expect(mockList).not.toHaveBeenCalled();
      expect(mockUploadFrom).toHaveBeenCalledTimes(2);
    });

    it('should use single connection for all files', async () => {
      mockList.mockResolvedValue([]);

      await ftpClient.uploadFiles(programFiles(2));

      expect(mockAccess).toHaveBeenCalledTimes(1);
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('should clean paths for all files', async () => {
      mockList.mockResolvedValue([]);

      const files = [
        { remotePath: '/O0100.NC', source: 'content1' },
        { remotePath: './O0200.NC', source: 'content2' },
      ];

      await ftpClient.uploadFiles(files);

      expect(mockUploadFrom).toHaveBeenCalledWith(expect.any(Readable), 'O0100.NC');
      expect(mockUploadFrom).toHaveBeenCalledWith(expect.any(Readable), 'O0200.NC');
    });
  });
});

describe('FTPClient delete behavior', () => {
  let ftpClient: FTPClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
    mockClose.mockReturnValue(undefined);

    ftpClient = new FTPClient({
      host: '192.168.1.100',
      port: 21,
    });
  });

  describe('deleteFile', () => {
    it('should delete file with cleaned path', async () => {
      await ftpClient.deleteFile('/TEST/O0100.NC');

      expect(mockRemove).toHaveBeenCalledWith('TEST/O0100.NC');
    });

    it('should close connection after delete', async () => {
      await ftpClient.deleteFile('file.nc');

      expect(mockClose).toHaveBeenCalled();
    });

    it('should wrap errors with descriptive message', async () => {
      mockRemove.mockRejectedValue(new Error('File not found'));

      await expect(ftpClient.deleteFile('file.nc')).rejects.toThrow(
        'FTP delete error: File not found'
      );
    });
  });
});

describe('FTPClient configuration', () => {
  it('should use provided configuration', async () => {
    const ftpClient = new FTPClient({
      host: '10.0.0.1',
      port: 2121,
      user: 'admin',
      password: 'secret',
    });

    mockList.mockResolvedValue([]);
    await ftpClient.uploadFile('test.nc', 'content', true);

    expect(mockAccess).toHaveBeenCalledWith({
      host: '10.0.0.1',
      port: 2121,
      user: 'admin',
      password: 'secret',
      secure: false,
    });
  });

  it('should use default values when not provided', async () => {
    const ftpClient = new FTPClient({
      host: '192.168.1.1',
    });

    mockList.mockResolvedValue([]);
    await ftpClient.uploadFile('test.nc', 'content', true);

    expect(mockAccess).toHaveBeenCalledWith({
      host: '192.168.1.1',
      port: 21,
      user: 'anonymous',
      password: '',
      secure: false,
    });
  });

  describe('updateConfig', () => {
    it('should update host', async () => {
      const ftpClient = new FTPClient({ host: 'old.host.com' });

      ftpClient.updateConfig({ host: 'new.host.com' });

      mockList.mockResolvedValue([]);
      await ftpClient.uploadFile('test.nc', 'content', true);

      expectConnectedWith({ host: 'new.host.com' });
    });

    it('should update port', async () => {
      const ftpClient = new FTPClient({ host: 'host.com', port: 21 });

      ftpClient.updateConfig({ port: 2121 });

      mockList.mockResolvedValue([]);
      await ftpClient.uploadFile('test.nc', 'content', true);

      expectConnectedWith({ port: 2121 });
    });

    it('should update credentials', async () => {
      const ftpClient = new FTPClient({ host: 'host.com' });

      ftpClient.updateConfig({ user: 'newuser', password: 'newpass' });

      mockList.mockResolvedValue([]);
      await ftpClient.uploadFile('test.nc', 'content', true);

      expectConnectedWith({ user: 'newuser', password: 'newpass' });
    });
  });
});
