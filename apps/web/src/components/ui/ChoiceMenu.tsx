import { cn, Menu } from '@toolpath/ui';
import type { ComponentProps } from 'react';
import { CheckIcon, ChevronDownIcon } from './icons';

/** The height of a choice button. A tag next to it can use the same height, so they line up. */
export const CHOICE_HEIGHT = 'h-6';

const CHOICE_BUTTON_CLASS = cn(
  CHOICE_HEIGHT,
  'inline-flex cursor-pointer items-center gap-1.5 rounded border border-zinc-700 bg-zinc-950 px-2 text-sm font-bold text-zinc-50 hover:border-zinc-500',
);

export interface Choice<Id extends string> {
  id: Id;
  name: string;
}

interface ChoiceMenuProps<Id extends string> {
  /** Read by screen readers before the chosen name, for example "Value in the chart" */
  label: string;
  choices: readonly Choice<Id>[];
  value: Id;
  onChoose: (id: Id) => void;
  /** Added to the button, for example a text color */
  className?: string;
}

/**
 * A small button with the chosen name. It opens a list of the choices, with a check at the chosen one.
 * The Toolpath menu trigger wraps its child in a second button. Rendering our own <button> as the trigger
 * (with `nativeButton`) leaves one button, so a screen reader does not find two.
 */
export function ChoiceMenu<Id extends string>({ label, choices, value, onChoose, className }: ChoiceMenuProps<Id>) {
  const chosen = choices.find(choice => choice.id === value);
  const renderButton = (props: ComponentProps<'button'>) => (
    <button type="button" {...props} className={cn(CHOICE_BUTTON_CLASS, className)} />
  );
  return (
    <Menu>
      <Menu.Trigger nativeButton render={renderButton}>
        <span className="sr-only">{label}: </span>
        {chosen?.name ?? value}
        <ChevronDownIcon size={14} className="text-zinc-300" />
      </Menu.Trigger>
      <Menu.Popover align="start" sideOffset={4} className="min-w-44 py-1 shadow-lg">
        {choices.map(choice => {
          const isChosen = choice.id === value;
          return (
            <Menu.Item
              key={choice.id}
              onClick={() => onChoose(choice.id)}
              className={cn('gap-2 px-2.5 py-1.5 text-sm', isChosen && 'text-primary-text dark:text-primary-text')}
            >
              <CheckIcon size={14} className={cn('shrink-0', !isChosen && 'invisible')} />
              {choice.name}
              {isChosen && <span className="sr-only"> (chosen)</span>}
            </Menu.Item>
          );
        })}
      </Menu.Popover>
    </Menu>
  );
}
