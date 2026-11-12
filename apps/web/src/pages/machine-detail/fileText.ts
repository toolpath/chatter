/** The biggest file the viewer shows. A bigger file can freeze the page, so the user downloads it instead. */
export const MAX_VIEW_BYTES = 1_000_000;

export function isTooBigToView(size: number): boolean {
  return size > MAX_VIEW_BYTES;
}

/** A zero byte almost never occurs in a text file, so it marks a binary file such as an image or a backup */
const ZERO_BYTE = 0;

/** The text of the file, or null when it is not a text file */
export function textOf(bytes: Uint8Array): string | null {
  if (bytes.includes(ZERO_BYTE)) return null;
  return new TextDecoder().decode(bytes);
}

/** The lines of the text. A last line break does not make an empty line at the end. */
export function linesOf(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** The line numbers for the side of the viewer, one on each line */
export function lineNumbersFor(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, index) => index + 1).join('\n');
}
