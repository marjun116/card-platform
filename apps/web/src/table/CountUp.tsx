/**
 * A score that counts up (or down) to its new value when it changes, so you
 * see the points go in. Shows the value straight away on first showing, with
 * "reduce motion" switched on, and where the browser can't animate (tests).
 * Screen readers only ever get the final number.
 */
import { useEffect, useRef, useState } from 'react';
import { motionSpeed } from './motion/animate';

/** How long the count takes, in ms. */
const COUNT_TIME = 600;

function canCount(): boolean {
  if (typeof requestAnimationFrame !== 'function' || motionSpeed() === 0) return false;
  return !(
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function CountUp({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  // Where the count is now, so a change in the middle of a count starts from there.
  const at = useRef(value);

  useEffect(() => {
    const from = at.current;
    if (from === value) return;
    if (!canCount()) {
      at.current = value;
      setShown(value);
      return;
    }
    const time = COUNT_TIME / motionSpeed();
    let start: number | null = null;
    let frame = requestAnimationFrame(function step(now) {
      start ??= now;
      const t = Math.min(1, (now - start) / time);
      // Quick at first, settling gently on the new value.
      const eased = 1 - (1 - t) ** 3;
      at.current = Math.round(from + (value - from) * eased);
      setShown(at.current);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span className={className}>
      <span aria-hidden="true">{shown}</span>
      <span className="visually-hidden">{value}</span>
    </span>
  );
}
