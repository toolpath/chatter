import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY } from '../../theme/theme';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { AppearancePanel } from './AppearancePanel';

function renderPanel() {
  return render(<ThemeProvider><AppearancePanel /></ThemeProvider>);
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('AppearancePanel', () => {
  it('shows Dark as pressed for a new browser', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('changes to light colors and keeps the choice in this browser', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Light' }));

    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('has the title Appearance', () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
  });

  it('says what System does', () => {
    renderPanel();
    expect(screen.getByText(/System follows the light or dark setting of this computer/)).toBeInTheDocument();
  });
});
