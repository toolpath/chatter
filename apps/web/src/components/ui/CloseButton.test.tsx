import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CloseButton } from './CloseButton';

describe('CloseButton', () => {
  it('shows an X with no words, is named Close, and closes on a click', () => {
    const onClick = vi.fn();
    render(<CloseButton onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Close' });

    fireEvent.click(button);

    expect(button).toHaveTextContent('');
    expect(button).toHaveAttribute('title', 'Close');
    expect(button.querySelector('svg')).not.toBeNull();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
