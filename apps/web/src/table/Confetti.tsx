/**
 * A short burst of confetti in the winners' colours, falling from the top of
 * the page once. CSS only: each piece gets its own spot, delay, drift and spin
 * from a fixed pattern (not random), so it looks the same every time. It
 * ignores the pointer, screen readers never hear it, and with "reduce motion"
 * switched on it isn't drawn at all (see styles.css).
 */
import type { CSSProperties } from 'react';
import { motionSpeed } from './motion/animate';

const PIECES = 40;

export function Confetti({ colours }: { colours: readonly string[] }) {
  if (motionSpeed() === 0 || colours.length === 0) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: PIECES }, (_, i) => (
        <span
          key={i}
          style={
            {
              // Spread across the page by the golden ratio, so pieces never bunch up.
              '--x': `${((i * 61.8) % 100).toFixed(1)}%`,
              '--delay': `${(i * 137) % 700}ms`,
              '--drift': `${((i * 37) % 120) - 60}px`,
              '--spin': `${(i % 2 ? 1 : -1) * (300 + ((i * 53) % 360))}deg`,
              background: colours[i % colours.length],
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
