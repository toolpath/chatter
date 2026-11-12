/** What the user picks in Settings. System follows the light or dark setting of the computer. */
export type ThemeChoice = 'dark' | 'light' | 'system';

/** The colors that the page shows */
export type Theme = 'dark' | 'light';

export const THEME_CHOICES: readonly ThemeChoice[] = ['dark', 'light', 'system'];

/** Chatter was always dark, so a new browser starts dark */
const DEFAULT_THEME_CHOICE: ThemeChoice = 'dark';

/** index.html reads this key too, before the page draws. Change both together. */
export const THEME_STORAGE_KEY = 'chatter-theme';

/** The page color of each theme, for the browser bar on a phone. app.css and index.html have the same colors. */
export const PAGE_COLORS: Record<Theme, string> = {
  dark: '#282828',
  light: '#f2f2f2',
};

function isThemeChoice(value: unknown): value is ThemeChoice {
  return THEME_CHOICES.includes(value as ThemeChoice);
}

/** The choice saved in this browser. A private window can block the storage, so it falls back to dark. */
export function readThemeChoice(storage: Storage = localStorage): ThemeChoice {
  try {
    const saved = storage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(saved) ? saved : DEFAULT_THEME_CHOICE;
  } catch {
    return DEFAULT_THEME_CHOICE;
  }
}

/** Saves the choice in this browser. When the storage is blocked, the choice lasts until the page closes. */
export function saveThemeChoice(choice: ThemeChoice, storage: Storage = localStorage): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Nothing to do: the page still shows the choice
  }
}

export function themeOf(choice: ThemeChoice, computerIsDark: boolean): Theme {
  if (choice === 'system') return computerIsDark ? 'dark' : 'light';
  return choice;
}

/**
 * Shows the theme on the page. `data-theme="light"` swaps the colors in app.css.
 * The `dark` class stays in both themes: the Toolpath UI parts use it, and the swapped colors make them light too.
 */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'light') root.dataset.theme = 'light';
  else delete root.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PAGE_COLORS[theme]);
}
