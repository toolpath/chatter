import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

function renderModal() {
  const onClose = vi.fn();
  render(
    <Modal label="Add a machine" onClose={onClose}>
      <button type="button">Inside</button>
    </Modal>,
  );
  return { onClose, dialog: screen.getByRole('dialog', { name: 'Add a machine' }) };
}

describe('Modal', () => {
  it('opens as a dialog with its name, and shows what is in it', () => {
    const { dialog } = renderModal();

    expect(dialog).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Inside' })).toBeInTheDocument();
  });

  it('closes on Esc', () => {
    const { dialog, onClose } = renderModal();

    fireEvent(dialog, new Event('cancel', { cancelable: true }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on a click on the dark layer outside the box', () => {
    const { dialog, onClose } = renderModal();

    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stays open on a click inside the box', () => {
    const { onClose } = renderModal();
    const inside = screen.getByRole('button', { name: 'Inside' });

    fireEvent.pointerDown(inside);
    fireEvent.click(inside);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open when a text selection starts inside the box and ends outside it', () => {
    const { dialog, onClose } = renderModal();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Inside' }));
    fireEvent.click(dialog);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('puts the cursor in the first box to type in, not on a button before it', () => {
    render(
      <Modal label="Add a user" onClose={vi.fn()}>
        <button type="button">Close</button>
        <input aria-label="Disabled box" disabled />
        <input aria-label="Username" />
      </Modal>,
    );

    expect(screen.getByLabelText('Username')).toHaveFocus();
  });
});
