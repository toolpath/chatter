/** The stream had more bytes than the limit */
export class FileTooBigError extends Error {
  constructor() {
    super('The file is bigger than the limit');
  }
}

/**
 * Read the stream, but stop at `maxBytes`. The file list can show an old size,
 * so this stops a file that grew from filling the memory of the page.
 */
export async function readAtMost(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  for (let readResult = await reader.read(); !readResult.done; readResult = await reader.read()) {
    byteCount += readResult.value.length;
    if (byteCount > maxBytes) {
      await reader.cancel();
      throw new FileTooBigError();
    }
    chunks.push(readResult.value);
  }
  return joinChunks(chunks, byteCount);
}

function joinChunks(chunks: Uint8Array[], byteCount: number): Uint8Array {
  const bytes = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
