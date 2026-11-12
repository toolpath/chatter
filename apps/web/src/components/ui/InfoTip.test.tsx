import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InfoTip } from './InfoTip';

describe('InfoTip', () => {
  it('gives the button a name, and the words as its description, for screen readers', () => {
    render(<InfoTip label="What SV1 means">A servo alarm</InfoTip>);

    const button = screen.getByRole('button', { name: 'What SV1 means' });
    expect(button).toHaveAccessibleDescription('A servo alarm');
  });

  it('hides the words when the user pushes Escape, and shows them again after the user leaves', () => {
    render(<InfoTip label="What SV1 means">A servo alarm</InfoTip>);
    const button = screen.getByRole('button');
    const tip = screen.getByRole('tooltip', { hidden: true });

    fireEvent.keyDown(button, { key: 'Escape' });
    expect(tip).not.toBeVisible();

    fireEvent.blur(button);
    expect(tip).toBeVisible();
  });

  it('puts the focus on the button on a tap, because a phone browser does not always do it, and the focus shows the box', () => {
    render(<InfoTip label="What SV1 means">A servo alarm</InfoTip>);
    const button = screen.getByRole('button');

    fireEvent.click(button);

    expect(button).toHaveFocus();
  });

  it('opens the box to the left of the button when asked, so it stays inside a box at the right edge', () => {
    render(<InfoTip label="Why" opensTo="left">Words</InfoTip>);

    expect(screen.getByRole('tooltip', { hidden: true })).toHaveClass('right-0');
  });

  it('keeps the first Escape for itself, so a modal around it stays open, and lets the next Escape through', () => {
    render(<InfoTip label="Why">Words</InfoTip>);
    const button = screen.getByRole('button');

    const firstEscapeWentOn = fireEvent.keyDown(button, { key: 'Escape' });
    const secondEscapeWentOn = fireEvent.keyDown(button, { key: 'Escape' });

    expect(firstEscapeWentOn).toBe(false);
    expect(secondEscapeWentOn).toBe(true);
  });
});
