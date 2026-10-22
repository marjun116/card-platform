import { type ReactNode, useState } from 'react';

/**
 * A number on the table that gives a little bump when it changes (cards in a
 * pile, tricks won), so the change catches the eye. Not on first showing, and
 * not with "reduce motion" switched on (see .tick in styles.css).
 */
export function Tick({
  value,
  className,
  children,
  'aria-hidden': ariaHidden,
}: {
  value: number;
  className?: string;
  children: ReactNode;
  'aria-hidden'?: boolean | 'true';
}) {
  const [first] = useState(value);
  const classes = [className, value !== first ? 'tick' : null].filter(Boolean).join(' ');
  return (
    // A new key starts the bump again on every change.
    <span key={value} className={classes || undefined} aria-hidden={ariaHidden}>
      {children}
    </span>
  );
}
