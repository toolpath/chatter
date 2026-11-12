import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StateBadge, StateIcon, StateLabel } from './MachineStateMark';

describe('the Connecting state', () => {
  it('shows the word Connecting and a mark that turns, but not for a user who asks for less motion', () => {
    const { container } = render(<StateLabel state="connecting" />);

    expect(screen.getByText('Connecting')).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveClass('motion-safe:animate-spin');
  });

  it('names the state for a screen reader when no word is next to the mark', () => {
    render(<StateIcon state="connecting" label />);

    expect(screen.getByRole('img', { name: 'Connecting' })).toBeInTheDocument();
  });

  it('shows Connecting in the big state tag', () => {
    render(<StateBadge state="connecting" />);

    expect(screen.getByText('Connecting')).toBeInTheDocument();
  });
});
