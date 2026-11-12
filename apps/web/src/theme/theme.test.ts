import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import indexHtml from '../../index.html?raw';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, PAGE_COLORS, readThemeChoice, saveThemeChoice, THEME_STORAGE_KEY, themeOf } from './theme';

function memoryStorage(values: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(values));
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: key => store.get(key) ?? null,
    key: index => [...store.keys()][index] ?? null,
    removeItem: key => { store.delete(key); },
    setItem: (key, value) => { store.set(key, value); },
  };
}

function brokenStorage(): Storage {
  const fail = () => { throw new Error('storage is blocked'); };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

describe('readThemeChoice', () => {
  it('is dark when nothing is saved', () => {
    expect(readThemeChoice(memoryStorage())).toBe('dark');
  });

  it('gives the saved choice', () => {
    expect(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: 'light' }))).toBe('light');
    expect(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: 'system' }))).toBe('system');
  });

  it('is dark when the saved value is not a choice', () => {
    expect(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: 'purple' }))).toBe('dark');
  });

  it('is dark when the browser blocks the storage', () => {
    expect(readThemeChoice(brokenStorage())).toBe('dark');
  });
});

describe('saveThemeChoice', () => {
  it('saves the choice, so the next visit reads it', () => {
    const storage = memoryStorage();
    saveThemeChoice('light', storage);
    expect(readThemeChoice(storage)).toBe('light');
  });

  it('does not throw when the browser blocks the storage', () => {
    expect(() => saveThemeChoice('light', brokenStorage())).not.toThrow();
  });
});

describe('themeOf', () => {
  it('gives the chosen colors for dark and light', () => {
    expect(themeOf('dark', false)).toBe('dark');
    expect(themeOf('light', true)).toBe('light');
  });

  it('follows the computer for system', () => {
    expect(themeOf('system', true)).toBe('dark');
    expect(themeOf('system', false)).toBe('light');
  });
});

describe('applyTheme', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    document.head.innerHTML = '';
  });

  it('marks the page as light, and removes the mark for dark', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('keeps the dark class, because the Toolpath UI parts need it in both themes', () => {
    document.documentElement.classList.add('dark');
    applyTheme('light');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('gives the browser bar the page color', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#282828">';
    applyTheme('light');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#f2f2f2');
    applyTheme('dark');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#282828');
  });
});

describe('index.html', () => {
  it('reads the same saved choice before the page draws, so a light page does not flash dark', () => {
    expect(indexHtml).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
  });

  it('gives the browser bar the light page color before the page draws', () => {
    expect(indexHtml).toContain(`setAttribute('content', '${PAGE_COLORS.light}')`);
    expect(indexHtml).toContain(`<meta name="theme-color" content="${PAGE_COLORS.dark}" />`);
  });
});

describe('app.css', () => {
  it('has the same page colors as the browser bar', () => {
    // Vite turns a CSS import into styles, so the test reads the file. The tests run in apps/web.
    const appCss = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8');
    const lightTheme = appCss.slice(appCss.indexOf(":root[data-theme='light']"));
    expect(lightTheme).toContain(`--color-zinc-950: ${PAGE_COLORS.light};`);
  });
});
