import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSlideOut } from './useSlideOut';

function setReducedMotion(isReduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: isReduced, media: query }));
}

function setSlideDuration(cssDuration: string) {
  document.documentElement.style.setProperty('--slide-duration', cssDuration);
}

/** Renders the hook and asks it to close at once. Returns the onClose spy and the hook result. */
function renderAndClose() {
  const onClose = vi.fn();
  const { result } = renderHook(() => useSlideOut(onClose));
  act(() => result.current.close());
  return { onClose, result };
}

function advanceTimeMs(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

describe('useSlideOut', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty('--slide-duration');
  });

  it('closes only after the slide time', () => {
    setReducedMotion(false);
    const { onClose, result } = renderAndClose();
    expect(result.current.isClosing).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    advanceTimeMs(200);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the slide time from --slide-duration', () => {
    setReducedMotion(false);
    setSlideDuration('50ms');
    const { onClose } = renderAndClose();

    advanceTimeMs(50);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reads a slide time in seconds', () => {
    setReducedMotion(false);
    setSlideDuration('0.3s');
    const { onClose } = renderAndClose();

    advanceTimeMs(299);
    expect(onClose).not.toHaveBeenCalled();
    advanceTimeMs(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not start the timer again when the page draws a new onClose', () => {
    setReducedMotion(false);
    const firstOnClose = vi.fn();
    const newestOnClose = vi.fn();
    const { result, rerender } = renderHook(({ onClose }) => useSlideOut(onClose), { initialProps: { onClose: firstOnClose } });

    act(() => result.current.close());
    advanceTimeMs(150);
    rerender({ onClose: newestOnClose });
    advanceTimeMs(50);

    expect(newestOnClose).toHaveBeenCalledTimes(1);
    expect(firstOnClose).not.toHaveBeenCalled();
  });

  it('closes at once when the user asks for less motion', () => {
    setReducedMotion(true);
    const { onClose } = renderAndClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
