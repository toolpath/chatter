import { useEffect, useRef, useState } from 'react';

/** Used when the page has no --slide-duration value, for example in a test */
const DEFAULT_SLIDE_MS = 200;
const MS_PER_SECOND = 1000;

/** The slide time from --slide-duration in app.css, in milliseconds. CSS accepts "200ms" and "0.2s", so both work here. */
function slideDurationMs(): number {
  const cssDuration = getComputedStyle(document.documentElement).getPropertyValue('--slide-duration').trim();
  const amount = parseFloat(cssDuration);
  if (!Number.isFinite(amount)) return DEFAULT_SLIDE_MS;
  const isSeconds = cssDuration.endsWith('s') && !cssDuration.endsWith('ms');
  return isSeconds ? amount * MS_PER_SECOND : amount;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Lets a panel slide out before it closes. A timer, not the animation end event, calls `onClose`,
 * so the panel closes even when the browser skips the animation (for example in a hidden tab).
 * A user who asks for less motion gets no slide: the panel closes at once.
 */
export function useSlideOut(onClose: () => void) {
  const [isClosing, setIsClosing] = useState(false);
  // The page draws again with each live value. A new onClose then must not start the timer again.
  const latestOnClose = useRef(onClose);
  useEffect(() => {
    latestOnClose.current = onClose;
  });

  useEffect(() => {
    if (!isClosing) return;
    const timer = setTimeout(() => latestOnClose.current(), slideDurationMs());
    return () => clearTimeout(timer);
  }, [isClosing]);

  const close = () => {
    if (prefersReducedMotion()) onClose();
    else setIsClosing(true);
  };
  return { isClosing, close };
}
