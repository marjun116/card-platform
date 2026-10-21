/** Generic drawings of zones: small zones at seats, piles and the trick in the middle. */
import type { Card as CardData, Move, PlayerView, TrickView, ZoneView } from '@card-table/engine';
import { useNarrow } from '../useNarrow';
import { CardBack, CardFace, type CardSize } from './Card';
import { spokenLabel } from './cards';
import { SuitSymbol } from './SuitText';
import { moveLabel, type SeatNames } from './describe';
import { humanize, type PlacedZone, trickAreaSize, trickLayout, zoneCount } from './zones';

function countText(n: number): string {
  return `${n} card${n === 1 ? '' : 's'}`;
}

/** A zone drawn small: at a player's seat, in your area or in the scoreboard. */
export function ZoneDisplay({
  zone,
  size = 'tiny',
  compact = false,
}: {
  zone: PlacedZone;
  size?: CardSize;
  /** Piles that can only be counted are written as one line of text. */
  compact?: boolean;
}) {
  const label = humanize(zone.name);
  const view = zone.view;
  if (view.kind === 'hidden') return null;
  if (view.kind === 'count' && compact && !view.top) {
    return <div className="zone-line">{`${label} pile: ${countText(view.count)}`}</div>;
  }
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
  // A face-up pile everyone can see (cards played in turn, say) is spread out, oldest first.
  const spread = zone.view.kind === 'cards' && zone.view.cards.length > 1 ? zone.view.cards : null;
  const description = [
    label,
    count === null ? null : countText(count),
    spread ? spread.map(spokenLabel).join(', ') : top ? `${spokenLabel(top)} on top` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const picture =
    count === 0 ? (
      <span className="card empty size-normal" aria-hidden="true" />
    ) : spread ? (
      <span className="pile-spread">
        {spread.map((card) => (
          <CardFace key={card.id} card={card} />
        ))}
      </span>
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
  // On phones with chips around the table (five or more players), a tall ring leaves them room.
  const narrow = useNarrow();
  const shape = narrow && view.players.length >= 5 ? 'tall' : 'wide';
  const layout = trickLayout(view.you, view.players.length, shape);
  const area = trickAreaSize(layout);
  // Sizes are in card widths; --t is the width of the cards drawn here.
  const t = layout.size === 'small' ? 'var(--small-w)' : 'var(--card-w)';
  return (
    <div
      className="trick"
      role="group"
      aria-label={label}
      style={{ width: `calc(${area.width} * ${t})`, height: `calc(${area.height} * ${t})` }}
    >
      {trick.plays.map((play) => {
        const { x, y } = layout.spot(play.player);
        // The card taking the trick so far, or the one that took it.
        const won = trick.leading === play.player;
        const who = names(play.player);
        return (
          <span
            key={play.player}
            className={`trick-card${won ? ' won' : ''}`}
            style={{
              left: `calc(50% + ${x.toFixed(3)} * ${t})`,
              top: `calc(50% + ${y.toFixed(3)} * ${t})`,
            }}
            aria-label={`${who}: ${play.card ? spokenLabel(play.card) : 'face down'}${won ? ', winning' : ''}`}
            role="img"
          >
            {play.card ? (
              <CardFace card={play.card} size={layout.size} />
            ) : (
              <CardBack size={layout.size} />
            )}
          </span>
        );
      })}
      {/* The suit led, in the middle of the trick until the trick is won. */}
      {trick.winner === null && trick.led && (
        <span className="trick-led">
          Led <SuitSymbol suit={trick.led} />
          <span className="visually-hidden">{trick.led}</span>
        </span>
      )}
      {trick.winner !== null ? (
        <span className="trick-winner" role="status">
          {names(trick.winner) === 'You' ? 'You win' : `${names(trick.winner)} wins`} the trick
        </span>
      ) : (
        trick.leading !== null && (
          <span className="trick-winner leading" role="status">
            {names(trick.leading) === 'You' ? "You're" : `${names(trick.leading)} is`} winning
          </span>
        )
      )}
    </div>
  );
}
