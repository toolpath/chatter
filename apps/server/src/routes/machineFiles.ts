import { Hono } from 'hono';
import type { HardwarePoller } from '../polling/poller.js';
import { recordUpload } from '../storage/database.js';
import { attachmentHeader, downloadAsStream } from './fileDownload.js';
import { requirePermission } from '../auth/authRoutes.js';
import { checkedForm, checkedQuery } from './checks.js';
import { notFound } from './responses.js';
import { batchUploadForm, filePathQuery, fileTreeQuery, uploadForm } from './schemas.js';
import { createLogger } from '../logging/logger.js';

const log = createLogger('files');

const ROOT_FOLDER = '.';
const DEFAULT_TREE_DEPTH = '2';
/** FTPClient puts this in its error when a file is there and overwrite is off */
const FILE_EXISTS_TEXT = 'already exists';

/** A file from the request, read into memory. It goes straight on to the machine. */
interface ReceivedFile {
  name: string;
  content: Buffer;
}

/** For each remote path: the file, its own name, and the name on the machine */
interface UploadPlan {
  files: Array<{ remotePath: string; source: Buffer }>;
  fileAt: Record<string, ReceivedFile>;
  targetNameAt: Record<string, string>;
}

/** The form sends booleans as the text "true" or "false" */
const isTrueText = (value: string | undefined) => value === 'true';
const fileNameOf = (remotePath: string) => remotePath.slice(remotePath.lastIndexOf('/') + 1);

async function receive(file: File): Promise<ReceivedFile> {
  return { name: file.name, content: Buffer.from(await file.arrayBuffer()) };
}

/** Bad JSON is logged and ignored, so each file keeps its own name */
function parseTargetNames(targetNames: string | undefined): Record<string, string> {
  if (!targetNames) return {};
  try {
    return JSON.parse(targetNames);
  } catch (error) {
    log.warn('Could not read targetNames, so each file keeps its own name', { error });
    return {};
  }
}

function joinRemotePath(basePath: string, fileName: string): string {
  return basePath.endsWith('/') ? `${basePath}${fileName}` : `${basePath}/${fileName}`;
}

function planUpload(files: ReceivedFile[], basePath: string, targetNames: Record<string, string>): UploadPlan {
  const plan: UploadPlan = { files: [], fileAt: {}, targetNameAt: {} };
  for (const file of files) {
    const targetName = targetNames[file.name] || file.name;
    const remotePath = joinRemotePath(basePath, targetName);
    // The FTP client may report the path with or without the first "/"
    for (const key of [remotePath, remotePath.replace(/^\//, '')]) {
      plan.fileAt[key] = file;
      plan.targetNameAt[key] = targetName;
    }
    plan.files.push({ remotePath, source: file.content });
  }
  return plan;
}

/** The reply for one file of a batch upload */
function describeUpload(plan: UploadPlan, remotePath: string) {
  return {
    filename: plan.fileAt[remotePath]?.name || fileNameOf(remotePath),
    targetName: plan.targetNameAt[remotePath] || fileNameOf(remotePath),
    path: remotePath,
  };
}

async function recordSentFiles(machineId: string, plan: UploadPlan, sentPaths: string[]) {
  for (const remotePath of sentPaths) {
    const file = plan.fileAt[remotePath];
    if (file) {
      await recordUpload(machineId, file.name, plan.targetNameAt[remotePath], remotePath, file.content.toString('utf-8'));
    }
  }
}

/** Read, send, and delete the program files on a machine (over FTP) */
export function machineFileRoutes(poller: HardwarePoller) {
  const canSendFiles = requirePermission('send-files');
  return new Hono()
    .get('/machine/:id/files', checkedQuery(fileTreeQuery), async c => {
      const { path = ROOT_FOLDER, depth = DEFAULT_TREE_DEPTH } = c.req.valid('query');
      const connector = poller.getConnector(c.req.param('id'));
      if (!connector) return notFound(c);

      return c.json(await connector.getFileTree(path, parseInt(depth)));
    })

    .get('/machine/:id/files/download', checkedQuery(filePathQuery), async c => {
      const { path } = c.req.valid('query');
      const connector = poller.getConnector(c.req.param('id'));
      if (!connector) return notFound(c);

      const stream = await downloadAsStream(connector, path);
      return c.body(stream, 200, {
        'Content-Disposition': attachmentHeader(fileNameOf(path)),
        'Content-Type': 'application/octet-stream',
      });
    })

    .post('/machine/:id/files/upload', canSendFiles, checkedForm(uploadForm), async c => {
      const machineId = c.req.param('id');
      const { file, path: remotePath, overwrite, targetName } = c.req.valid('form');
      const connector = poller.getConnector(machineId);
      if (!connector) return notFound(c);

      const received = await receive(file);
      const nameOnMachine = targetName || received.name;
      try {
        await connector.uploadFile(remotePath, received.content, isTrueText(overwrite));
      } catch (error) {
        if (error instanceof Error && error.message.includes(FILE_EXISTS_TEXT)) {
          return c.json({ error: error.message }, 409);
        }
        throw error;
      }
      await recordUpload(machineId, received.name, nameOnMachine, remotePath, received.content.toString('utf-8'));
      return c.json({
        message: 'File uploaded successfully',
        filename: received.name,
        targetName: nameOnMachine,
        path: remotePath,
      });
    })

    // Send several files. Each file passes or fails on its own.
    .post('/machine/:id/files/upload-batch', canSendFiles, checkedForm(batchUploadForm), async c => {
      const machineId = c.req.param('id');
      const { files, basePath, overwrite, targetNames } = c.req.valid('form');
      const connector = poller.getConnector(machineId);
      if (!connector) return notFound(c);

      const received = await Promise.all(files.map(receive));
      const plan = planUpload(received, basePath, parseTargetNames(targetNames));
      const results = await connector.uploadFiles(plan.files, isTrueText(overwrite));
      await recordSentFiles(machineId, plan, results.success.map(sent => sent.remotePath));

      return c.json({
        success: results.success.map(sent => describeUpload(plan, sent.remotePath)),
        failed: results.failed.map(failed => ({
          ...describeUpload(plan, failed.remotePath),
          error: failed.error || 'Unknown error',
        })),
      });
    })

    .delete('/machine/:id/files', canSendFiles, checkedQuery(filePathQuery), async c => {
      const { path: filePath } = c.req.valid('query');
      const connector = poller.getConnector(c.req.param('id'));
      if (!connector) return notFound(c);

      await connector.deleteFile(filePath);
      return c.json({ message: 'File deleted successfully', path: filePath });
    });
}
