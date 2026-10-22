/**
 * Things that happen at a seat for a moment (see events.ts): a speech bubble
 * with a bid, points floating up. Drawn on top of the seat and ignoring the
 * pointer, so they never get in the way of a move. Hidden from screen readers,
 * which hear the same news from the game log.
 */
import type { ShownEvent } from './events';
import { SuitText } from './SuitText';

export function SeatEffects({
  events,
  below = false,
}: {
  /** This seat's events. */
  events: readonly ShownEvent[];
  /** The bubble opens below the seat (seats along the top of the table). */
  below?: boolean;
}) {
  if (events.length === 0) return null;
  return (
    <span className="seat-effects" aria-hidden="true">
      {events.map(({ id, event, delay }) =>
        event.kind === 'speech' ? (
          <span key={id} className={`speech${below ? ' below' : ''}`}>
            <SuitText text={event.text} />
          </span>
        ) : (
          <span
            key={id}
            className={`float-points${event.points < 0 ? ' minus' : ''}`}
            style={{ animationDelay: `${delay}ms` }}
          >
            {event.points > 0 ? '+' : '−'}
            {Math.abs(event.points)}
            {event.label && <span className="float-label"> {event.label}</span>}
          </span>
        ),
      )}
    </span>
  );
}
