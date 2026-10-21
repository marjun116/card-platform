/**
 * A player's initials in a circle of their team's colour. Decorative: the name
 * is always written beside it, so screen readers skip it.
 */
import type { ReactNode } from 'react';
import { teamColour } from './avatars';

export function Avatar({
  initials,
  team,
  size = 'normal',
  children,
}: {
  initials: string;
  team: number;
  size?: 'normal' | 'small';
  /** Extras drawn on the circle, like the here/away dot (which has its own label). */
  children?: ReactNode;
}) {
  return (
    <span className={`avatar size-${size}`} style={{ ['--team' as string]: teamColour(team) }}>
      <span className="avatar-letters" aria-hidden="true">
        {initials}
      </span>
      {children}
    </span>
  );
}

/** A team's colour as a small dot, e.g. in a column heading. */
export function TeamDot({ team }: { team: number }) {
  return (
    <span
      className="team-dot"
      style={{ ['--team' as string]: teamColour(team) }}
      aria-hidden="true"
    />
  );
}
