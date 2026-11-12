import { readFileSync } from 'fs';
import { inflateSync } from 'zlib';

/**
 * Read the pixels of a PNG file, so that a test can check what a picture shows.
 * It reads only what the app's icons use: 8 bits per color, RGB or RGBA, not interlaced.
 */

export type Rgb = [number, number, number];

export interface PngPixels {
  width: number;
  height: number;
  pixel: (x: number, y: number) => Rgb;
}

const SIGNATURE_LENGTH = 8;

const CHUNK_LENGTH_SIZE = 4;
const CHUNK_TYPE_SIZE = 4;
const CHUNK_CHECKSUM_SIZE = 4;
const CHUNK_DATA_START = CHUNK_LENGTH_SIZE + CHUNK_TYPE_SIZE;
const CHUNK_OVERHEAD = CHUNK_DATA_START + CHUNK_CHECKSUM_SIZE;

const HEADER_WIDTH_OFFSET = 0;
const HEADER_HEIGHT_OFFSET = 4;
const HEADER_FORMAT_START = 8;
const HEADER_FORMAT_END = 13;

const SUPPORTED_BIT_DEPTH = 8;
const NO_INTERLACE = 0;
const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_RGBA = 6;
const RGB_BYTES_PER_PIXEL = 3;
const RGBA_BYTES_PER_PIXEL = 4;
const FILTER_BYTE_SIZE = 1;
const BYTE_MASK = 0xff;

interface Chunks {
  header: Buffer;
  filteredImage: Buffer;
}

/** A PNG file is a list of chunks: length, type, data, and a checksum */
function readChunks(file: Buffer): Chunks {
  let header: Buffer = Buffer.alloc(0);
  const imageParts: Buffer[] = [];
  for (let offset = SIGNATURE_LENGTH; offset < file.length; ) {
    const dataLength = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + CHUNK_LENGTH_SIZE, offset + CHUNK_DATA_START);
    const dataStart = offset + CHUNK_DATA_START;
    const chunkData = file.subarray(dataStart, dataStart + dataLength);
    if (type === 'IHDR') header = chunkData;
    if (type === 'IDAT') imageParts.push(chunkData);
    offset += CHUNK_OVERHEAD + dataLength;
  }
  return { header, filteredImage: inflateSync(Buffer.concat(imageParts)) };
}

/** The Paeth filter guesses a byte from the bytes to the left, above, and above-left */
function paeth(left: number, above: number, aboveLeft: number): number {
  const guess = left + above - aboveLeft;
  const toLeft = Math.abs(guess - left);
  const toAbove = Math.abs(guess - above);
  const toAboveLeft = Math.abs(guess - aboveLeft);
  if (toLeft <= toAbove && toLeft <= toAboveLeft) return left;
  return toAbove <= toAboveLeft ? above : aboveLeft;
}

interface Neighbors {
  left: number;
  above: number;
  aboveLeft: number;
}

/** The guess that a filter added to each byte, indexed by filter type: None, Sub, Up, Average, Paeth */
function filterGuess(filterType: number, { left, above, aboveLeft }: Neighbors): number {
  return [0, left, above, Math.floor((left + above) / 2), paeth(left, above, aboveLeft)][filterType];
}

interface RowLayout {
  height: number;
  rowLength: number;
  bytesPerPixel: number;
}

/** Each row starts with a filter byte. Undo the filter to get the real bytes of the row. */
function unfilterRows(filteredImage: Buffer, { height, rowLength, bytesPerPixel }: RowLayout): Buffer[] {
  const rows: Buffer[] = [];
  let previousRow = Buffer.alloc(rowLength);
  for (let y = 0; y < height; y++) {
    const filterByteIndex = y * (FILTER_BYTE_SIZE + rowLength);
    const filterType = filteredImage[filterByteIndex];
    const rowStart = filterByteIndex + FILTER_BYTE_SIZE;
    const row = Buffer.from(filteredImage.subarray(rowStart, rowStart + rowLength));
    for (let i = 0; i < rowLength; i++) {
      const hasPixelToLeft = i >= bytesPerPixel;
      const neighbors = {
        left: hasPixelToLeft ? row[i - bytesPerPixel] : 0,
        above: previousRow[i],
        aboveLeft: hasPixelToLeft ? previousRow[i - bytesPerPixel] : 0,
      };
      row[i] = (row[i] + filterGuess(filterType, neighbors)) & BYTE_MASK;
    }
    rows.push(row);
    previousRow = row;
  }
  return rows;
}

export function readPngPixels(path: string): PngPixels {
  const { header, filteredImage } = readChunks(readFileSync(path));
  const width = header.readUInt32BE(HEADER_WIDTH_OFFSET);
  const height = header.readUInt32BE(HEADER_HEIGHT_OFFSET);
  const [bitDepth, colorType, , , interlace] = header.subarray(HEADER_FORMAT_START, HEADER_FORMAT_END);
  const isSupportedColorType = colorType === COLOR_TYPE_RGB || colorType === COLOR_TYPE_RGBA;
  if (bitDepth !== SUPPORTED_BIT_DEPTH || !isSupportedColorType || interlace !== NO_INTERLACE) {
    throw new Error(`${path}: only 8-bit RGB or RGBA PNG files without interlace are read`);
  }
  const bytesPerPixel = colorType === COLOR_TYPE_RGBA ? RGBA_BYTES_PER_PIXEL : RGB_BYTES_PER_PIXEL;
  const rows = unfilterRows(filteredImage, { height, rowLength: width * bytesPerPixel, bytesPerPixel });
  const pixel = (x: number, y: number): Rgb => {
    const start = x * bytesPerPixel;
    return [rows[y][start], rows[y][start + 1], rows[y][start + 2]];
  };
  return { width, height, pixel };
}
