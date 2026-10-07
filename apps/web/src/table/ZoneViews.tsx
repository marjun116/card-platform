/** Generic drawings of zones: small zones at seats, piles and the trick in the middle. */
import type { Card as CardData, Move, PlayerView, TrickView, ZoneView } from '@card-table/engine';
import { CardBack, CardFace, type CardSize } from './Card';
import { spokenLabel } from './cards';
import { moveLabel, type SeatNames } from './describe';
import { humanize, type PlacedZone, seatPosition, zoneCount } from './zones';

function countText(n: number): string {
  return `${n} card${n === 1 ? '' : 's'}`;
}

/** A zone drawn small: at a player's seat, in your area or in the scoreboard. */
export function ZoneDisplay({ zone, size = 'tiny' }: { zone: PlacedZone; size?: CardSize }) {
  const label = humanize(zone.name);
  const view = zone.view;
  if (view.kind === 'hidden') return null;
  if (view.kind === 'count') {
    return (
      <div className="zone" aria-label={`${label}: ${countText(view.count)}`} role="group">
        <span className="zone-label">{label}</span>
        <span className="stack-count">
          {view.top ? <CardFace card={view.top} size={size} /> : <CardBack size={size} />}
          <span className="count" aria-hidden="true">
            {view.count}
          </span>
        </span>
      </div>
    );
  }
  if (view.kind === 'melds') {
    return (
      <div className="zone" role="group" aria-label={`${label}: ${view.melds.length} groups`}>
        <span className="zone-label">{label}</span>
        <div className="melds">
          {view.melds.length === 0 && <span className="muted">none yet</span>}
          {view.melds.map((meld, i) => (
            <span key={i} className="meld" role="group" aria-label={`Group ${i + 1}`}>
              {meld.map((card) => (
                <CardFace key={card.id} card={card} size={size} />
              ))}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="zone" role="group" aria-label={`${label}: ${countText(view.cards.length)}`}>
      <span className="zone-label">{label}</span>
      <span className="fan">
        {view.cards.length === 0 && <span className="muted">empty</span>}
        {view.cards.map((card) => (
          <CardFace key={card.id} card={card} size={size} />
        ))}
      </span>
    </div>
  );
}

/** The card shown on top of a pile, if the viewer may see one. */
function topCard(view: ZoneView): CardData | null {
  if (view.kind === 'count') return view.top;
  if (view.kind === 'cards') return view.cards[view.cards.length - 1] ?? null;
  return null;
}

/** A shared pile in the middle. Pressing it makes its move, if there's exactly one. */
export function Pile({
  zone,
  moves,
  names,
  onMove,
  busy,
}: {
  zone: PlacedZone;
  moves: Move[];
  names: SeatNames;
  onMove: (move: Move) => void;
  busy: boolean;
}) {
  const label = humanize(zone.name);
  const count = zoneCount(zone.view);
  const top = topCard(zone.view);
  const description = [
    label,
    count === null ? null : countText(count),
    top ? `${spokenLabel(top)} on top` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const picture =
    count === 0 ? (
      <span className="card empty size-normal" aria-hidden="true" />
    ) : top ? (
      <CardFace card={top} />
    ) : (
      <CardBack />
    );
  const move = moves.length === 1 ? moves[0] : undefined;

  return (
    <div className="pile">
      {move ? (
        <button
          type="button"
          className="pile-button playable"
          aria-label={`${description}. ${moveLabel(move, names)}`}
          disabled={busy}
          onClick={() => onMove(move)}
        >
          {picture}
        </button>
      ) : (
        <span role="img" aria-label={description}>
          {picture}
        </span>
      )}
      <span className="pile-label" aria-hidden="true">
        {label}
        {count !== null && count > 0 && ` · ${count}`}
      </span>
    </div>
  );
}

/** The cards in a trick, each on the side of the player who played it. */
export function Trick({
  trick,
  view,
  names,
  label,
}: {
  trick: TrickView;
  view: PlayerView;
  names: SeatNames;
  label: string;
}) {
  const playerCount = view.players.length;
  return (
    <div className="trick" role="group" aria-label={label}>
      {trick.plays.map((play) => {
        const seat = seatPosition(play.player, view.you, playerCount);
        // Pulled towards the middle, so whole cards fit inside the trick area.
        const x = 50 + (seat.x - 50) * 0.7;
        const y = 50 + (seat.y - 50) * 0.7;
        const won = trick.winner === play.player;
        const who = names(play.player);
        return (
          <span
            key={play.player}
            className={`trick-card${won ? ' won' : ''}`}
            style={{ left: `${x}%`, top: `${y}%` }}
            aria-label={`${who}: ${play.card ? spokenLabel(play.card) : 'face down'}${won ? ', winning' : ''}`}
            role="img"
          >
            {play.card ? <CardFace card={play.card} /> : <CardBack />}
          </span>
        );
      })}
      {trick.winner !== null && (
        <span className="trick-winner" role="status">
          {names(trick.winner) === 'You' ? 'You win' : `${names(trick.winner)} wins`} the trick
        </span>
      )}
    </div>
  );
}
