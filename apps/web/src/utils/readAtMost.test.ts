import { describe, expect, it } from 'vitest';
import { FileTooBigError, readAtMost } from './readAtMost';

const LIMIT = 5;

const bytesOf = (text: string) => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const streamOf = (...parts: string[]) => new ReadableStream<Uint8Array>({
  start(controller) {
    parts.forEach(part => controller.enqueue(bytesOf(part)));
    controller.close();
  },
});

describe('readAtMost', () => {
  it('joins the parts of a stream up to the limit', async () => {
    const bytes = await readAtMost(streamOf('G0 ', 'X1'), LIMIT);
    expect(textOf(bytes)).toBe('G0 X1');
  });

  it('stops with FileTooBigError when the stream passes the limit', async () => {
    await expect(readAtMost(streamOf('G0 ', 'X10'), LIMIT)).rejects.toBeInstanceOf(FileTooBigError);
  });

  it('gives no bytes for an empty body', async () => {
    expect(await readAtMost(null, LIMIT)).toEqual(new Uint8Array());
  });
});
