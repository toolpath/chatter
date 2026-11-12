import { describe, expect, it } from 'vitest';
import { isTooBigToView, lineNumbersFor, linesOf, MAX_VIEW_BYTES, textOf } from './fileText';

const bytesOf = (text: string) => new TextEncoder().encode(text);

describe('isTooBigToView', () => {
  it('allows files up to the limit', () => {
    expect(isTooBigToView(MAX_VIEW_BYTES)).toBe(false);
    expect(isTooBigToView(MAX_VIEW_BYTES + 1)).toBe(true);
  });
});

describe('textOf', () => {
  it('gives the text of a G-code file', () => {
    expect(textOf(bytesOf('%\r\nO1000\r\nM30\r\n%'))).toBe('%\r\nO1000\r\nM30\r\n%');
  });

  it('gives null for a file with a zero byte', () => {
    expect(textOf(new Uint8Array([0x47, 0x00, 0x31]))).toBeNull();
  });
});

describe('linesOf', () => {
  it('splits on Windows and Unix line breaks', () => {
    expect(linesOf('G0\r\nG1\nM30')).toEqual(['G0', 'G1', 'M30']);
  });

  it('drops only the empty line after the last line break', () => {
    expect(linesOf('G0\r\n')).toEqual(['G0']);
    expect(linesOf('G0\n\n')).toEqual(['G0', '']);
    expect(linesOf('')).toEqual(['']);
  });
});

describe('lineNumbersFor', () => {
  it('gives one number on each line', () => {
    expect(lineNumbersFor(3)).toBe('1\n2\n3');
  });
});
