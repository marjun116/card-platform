/**
 * A game's tile, on Home and in the games list: its accent colour, a small fan
 * of real cards, and chips for the player count and how long it usually takes.
 * The compact tile (Home) is one link to a new table; the full one (the games
 * list) has its house rules and buttons too.
 */
import type { GameSummary } from '@card-table/server/protocol';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { minutesText, playersText } from '../gameText';
import { teamColour } from '../table/avatars';
import { CardFace } from '../table/Card';
import { cardFromId } from '../table/cards';

export function GameTile({ game, compact = false }: { game: GameSummary; compact?: boolean }) {
  const minutes = minutesText(game);
  const newTable = `/games/${game.slug}/new`;
  const Heading = compact ? 'h3' : 'h2';
  return (
    <li
      className={`game-tile${compact ? ' compact' : ''}`}
      style={{ '--game': teamColour(game.accent) } as CSSProperties}
    >
      <div className="tile-fan" aria-hidden="true">
        {game.cards.map((code, i) => {
          const card = cardFromId(`${code}.${i}`);
          return card && <CardFace key={i} card={card} size={compact ? 'tiny' : 'small'} />;
        })}
      </div>
      <Heading className="tile-name">
        {compact ? (
          <Link to={newTable} className="tile-link">
            {game.name}
          </Link>
        ) : (
          game.name
        )}
      </Heading>
      <p className="chips">
        <span className="chip">{playersText(game)}</span>
        {minutes && <span className="chip">{minutes}</span>}
      </p>
      {!compact && Object.keys(game.options).length > 0 && (
        <p className="muted">
          House rules:{' '}
          {Object.values(game.options)
            .map((o) => o.label)
            .join(' · ')}
        </p>
      )}
      {!compact && (
        <p className="actions">
          <Link to={newTable} className="button primary">
            New table
          </Link>
          <Link to={`/games/${game.slug}/rules`}>Rules</Link>
        </p>
      )}
    </li>
  );
}
