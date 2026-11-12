import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { readPngPixels, type Rgb } from './test/pngPixels';

/**
 * A phone's "Add to Home Screen" reads the icon links in index.html and the web app manifest.
 * These tests check that every linked file is in public/, and that each picture is the Chatter icon at its stated size.
 */

const webDir = path.resolve(__dirname, '..');
const publicFile = (href: string) => path.join(webDir, 'public', href);
const indexPage = readFileSync(path.join(webDir, 'index.html'), 'utf8');

function linkHref(rel: string): string {
  const match = indexPage.match(new RegExp(`<link rel="${rel}" href="([^"]+)"`));
  if (!match) throw new Error(`index.html has no <link rel="${rel}">`);
  return match[1];
}

const TOOLPATH_GREEN: Rgb = [0x68, 0xb6, 0x88];
const isNear = (color: Rgb, target: Rgb) => color.every((value, i) => Math.abs(value - target[i]) <= 4);
const isDark = ([red, green, blue]: Rgb) => red + green + blue < 150;

/** The Chatter icon: a green square, with the dark "Ch" letters across the middle row */
function expectChatterIcon(file: string, sizes: string): void {
  const png = readPngPixels(file);
  expect(`${png.width}x${png.height}`).toBe(sizes);
  expect(isNear(png.pixel(1, 1), TOOLPATH_GREEN)).toBe(true);
  const middleRow = Array.from({ length: png.width }, (_, x) => png.pixel(x, Math.floor(png.height / 2)));
  expect(middleRow.some(isDark)).toBe(true);
}

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
}

describe('home screen icon', () => {
  it('links an iPhone icon of 180 x 180 pixels', () => {
    expectChatterIcon(publicFile(linkHref('apple-touch-icon')), '180x180');
  });

  it('links a browser tab icon that exists', () => {
    expect(existsSync(publicFile(linkHref('icon')))).toBe(true);
  });

  it('links a manifest that opens Chatter like an app, with the Chatter icon at each stated size', () => {
    const manifest = JSON.parse(readFileSync(publicFile(linkHref('manifest')), 'utf8'));
    expect(manifest).toMatchObject({ name: 'Chatter', start_url: '/', display: 'standalone' });
    const icons: ManifestIcon[] = manifest.icons;
    expect(icons.map(icon => icon.sizes)).toEqual(['192x192', '512x512']);
    for (const icon of icons) expectChatterIcon(publicFile(icon.src), icon.sizes);
  });
});
