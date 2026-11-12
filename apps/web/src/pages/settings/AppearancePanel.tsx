import { cn } from '@toolpath/ui';
import { Panel } from '../../components/ui/Panel';
import { THEME_CHOICES, type ThemeChoice } from '../../theme/theme';
import { useThemeChoice } from '../../theme/ThemeProvider';

const CHOICE_LABELS: Record<ThemeChoice, string> = {
  dark: 'Dark',
  light: 'Light',
  system: 'System',
};

/** Dark or light colors for this browser. Each browser keeps its own choice. */
export function AppearancePanel() {
  const { choice, changeChoice } = useThemeChoice();
  return (
    <Panel title="Appearance" description="Pick dark or light colors for this browser. System follows the light or dark setting of this computer.">
      <div className="px-5 py-4">
        <div role="group" aria-label="Appearance" className="inline-flex gap-0.5 rounded-lg bg-zinc-950 p-[0.1875rem]">
          {THEME_CHOICES.map(option => {
            const isPressed = option === choice;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={isPressed}
                onClick={() => changeChoice(option)}
                className={cn(
                  'min-h-8 rounded-md border-0 px-3.5',
                  isPressed ? 'bg-zinc-700 font-bold text-zinc-50' : 'bg-transparent font-semibold text-zinc-200 hover:text-zinc-50',
                )}
              >
                {CHOICE_LABELS[option]}
              </button>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
