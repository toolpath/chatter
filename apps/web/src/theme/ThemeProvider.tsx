import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { applyTheme, readThemeChoice, saveThemeChoice, themeOf, type ThemeChoice } from './theme';

interface ThemeChoiceState {
  choice: ThemeChoice;
  changeChoice: (choice: ThemeChoice) => void;
}

const ThemeChoiceContext = createContext<ThemeChoiceState | null>(null);

const COMPUTER_IS_DARK_QUERY = '(prefers-color-scheme: dark)';

function watchComputerTheme(onChange: () => void): () => void {
  const query = window.matchMedia(COMPUTER_IS_DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True when the computer is set to dark. It updates when the user changes that setting. */
function useComputerIsDark(): boolean {
  return useSyncExternalStore(watchComputerTheme, () => window.matchMedia(COMPUTER_IS_DARK_QUERY).matches);
}

/** Shows the light or dark colors on every page, the login page too */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState(readThemeChoice);
  const computerIsDark = useComputerIsDark();

  useEffect(() => applyTheme(themeOf(choice, computerIsDark)), [choice, computerIsDark]);

  const changeChoice = (newChoice: ThemeChoice) => {
    saveThemeChoice(newChoice);
    setChoice(newChoice);
  };

  return <ThemeChoiceContext.Provider value={{ choice, changeChoice }}>{children}</ThemeChoiceContext.Provider>;
}

/** The theme choice of this browser, and a way to change it. Use it inside ThemeProvider. */
export function useThemeChoice(): ThemeChoiceState {
  const state = useContext(ThemeChoiceContext);
  if (!state) throw new Error('useThemeChoice needs a ThemeProvider around it');
  return state;
}
