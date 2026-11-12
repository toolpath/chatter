import { Writable } from 'node:stream';
import type { BaseMachineConnector } from '../machines/BaseMachineConnector.js';

/**
 * Start to read a file from the machine, and give it as a stream.
 *
 * The promise waits for the first bytes (or the end of an empty file).
 * So when the machine refuses the download, the caller gets the error
 * while it can still send an error reply.
 * An error after the first bytes stops the stream.
 *
 * Node's Readable.toWeb() is not used: it throws (and stops the server)
 * when data arrives after the reader stopped early.
 */
export async function downloadAsStream(connector: BaseMachineConnector, filePath: string): Promise<ReadableStream<Uint8Array>> {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  // When the reader stops early, the download runs to its end and the rest is dropped
  let readerStopped = false;
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) { controller = streamController; },
    cancel() { readerStopped = true; },
  });

  let markStarted = () => {};
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      markStarted();
      if (!readerStopped) controller.enqueue(chunk);
      done();
    },
  });

  const download = connector.downloadFile(filePath, output);
  try {
    await Promise.race([started, download]);
  } catch (error) {
    output.destroy();
    throw error;
  }
  download.then(
    () => { if (!readerStopped) controller.close(); },
    (error: Error) => { if (!readerStopped) controller.error(error); },
  );
  return stream;
}

/** Printable ASCII, but not the quote and the backslash, which would end the quoted name */
const NOT_SAFE_IN_QUOTES = /[^\x20-\x7e]|["\\]/g;

/**
 * The Content-Disposition header that downloads a file with this name.
 * "filename" is a plain ASCII copy for old browsers. "filename*" keeps every letter (RFC 6266 and RFC 5987).
 * A name with a line break or a letter outside Latin-1 would otherwise make the header invalid.
 */
export function attachmentHeader(fileName: string): string {
  const plainName = fileName.replace(NOT_SAFE_IN_QUOTES, '_');
  // encodeURIComponent leaves ' ( ) * as they are, but RFC 5987 does not allow them
  const encodedName = encodeURIComponent(fileName)
    .replace(/['()*]/g, mark => `%${mark.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${plainName}"; filename*=UTF-8''${encodedName}`;
}
