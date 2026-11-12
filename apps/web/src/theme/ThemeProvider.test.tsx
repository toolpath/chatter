import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from './theme';
import { ThemeProvider, useThemeChoice } from './ThemeProvider';

type Listener = () => void;

/** A computer setting for light or dark that the test can change */
function stubComputerTheme(initial: 'dark' | 'light') {
  let isDark = initial === 'dark';
  const listeners = new Set<Listener>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query === '(prefers-color-scheme: dark)' ? isDark : !isDark; },
    media: query,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  }));
  return (theme: 'dark' | 'light') => {
    isDark = theme === 'dark';
    listeners.forEach(listener => listener());
  };
}

function ChoiceButtons() {
  const { choice, changeChoice } = useThemeChoice();
  return (
    <>
      <p>Choice: {choice}</p>
      <button onClick={() => changeChoice('light')}>Light</button>
      <button onClick={() => changeChoice('system')}>System</button>
    </>
  );
}

function renderProvider() {
  return render(<ThemeProvider><ChoiceButtons /></ThemeProvider>);
}

const pageTheme = () => document.documentElement.dataset.theme;

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});

describe('ThemeProvider', () => {
  it('starts with the saved choice', () => {
    stubComputerTheme('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderProvider();
    expect(screen.getByText('Choice: light')).toBeInTheDocument();
    expect(pageTheme()).toBe('light');
  });

  it('shows and saves a new choice', () => {
    stubComputerTheme('dark');
    renderProvider();
    expect(pageTheme()).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Light' }));

    expect(screen.getByText('Choice: light')).toBeInTheDocument();
    expect(pageTheme()).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('follows the computer when it changes, for system', () => {
    const setComputerTheme = stubComputerTheme('dark');
    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'System' }));
    expect(pageTheme()).toBeUndefined();

    act(() => setComputerTheme('light'));

    expect(pageTheme()).toBe('light');
  });

  it('does not follow the computer for dark', () => {
    const setComputerTheme = stubComputerTheme('dark');
    renderProvider();

    act(() => setComputerTheme('light'));

    expect(pageTheme()).toBeUndefined();
  });
});
