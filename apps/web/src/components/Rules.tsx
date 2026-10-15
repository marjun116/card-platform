/** A game's rulebook: the written rules, and what this table is playing with. */
import type { GameSummary, TableInfo } from '@card-table/server/protocol';
import { api } from '../api';
import { optionText } from '../gameText';
import { inlineParts, parseRules } from '../rulesText';
import { Dialog } from '../table/Scores';
import { humanize } from '../table/zones';
import { useLoad } from '../useLoad';

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((part, i) =>
        part.bold ? <strong key={i}>{part.text}</strong> : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}

/**
 * Rules text, from the small formatting subset (see rulesText.ts). The `#`
 * title is left out: the page or dialog around it already names the game.
 * `##` sections become headings at `level`.
 */
export function RulesText({ source, level }: { source: string; level: 2 | 3 }) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="rules-text">
      {parseRules(source).map((block, i) => {
        if (block.type === 'heading') {
          return block.level === 1 ? null : (
            <Heading key={i}>
              <Inline text={block.text} />
            </Heading>
          );
        }
        if (block.type === 'list') {
          return (
            <ul key={i}>
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            <Inline text={block.text} />
          </p>
        );
      })}
    </div>
  );
}

/** The table's own settings: players, partners and the house rules chosen. */
export function AtThisTable({ table, game }: { table: TableInfo; game: GameSummary | undefined }) {
  const name = (seat: number) =>
    table.seats.find((s) => s.seat === seat)?.user?.displayName ?? `Seat ${seat + 1}`;
  const options = Object.entries(table.options);
  return (
    <section className="at-this-table" aria-labelledby="at-this-table">
      <h3 id="at-this-table">At this table</h3>
      <ul>
        <li>{table.playerCount} players</li>
        {table.teams?.map((team, i) => (
          <li key={i}>
            Team {i + 1}: {team.map(name).join(' and ')}
          </li>
        ))}
      </ul>
      {options.length > 0 && (
        <dl className="options">
          {options.map(([key, value]) => {
            const def = game?.options[key];
            const changed = def !== undefined && value !== def.default;
            return (
              <div key={key}>
                <dt>{def?.label ?? humanize(key)}</dt>
                <dd>
                  {optionText(value, def)}
                  {changed && <span className="changed"> (changed)</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {game && options.every(([key, value]) => value === game.options[key]?.default) && (
        <p className="muted">This table plays the standard rules.</p>
      )}
    </section>
  );
}

/** The written rules of a game, loaded from the server. */
export function GameRules({ slug, level }: { slug: string; level: 2 | 3 }) {
  const rules = useLoad(() => api.rules(slug), `rules:${slug}`);
  if (rules.state === 'loading') return <p className="muted">Loading the rules…</p>;
  if (rules.state === 'error') return <p className="error">{rules.message}</p>;
  return <RulesText source={rules.data} level={level} />;
}

/** The rulebook over the table or lobby, without interrupting the game. */
export function RulesDialog({ table, onClose }: { table: TableInfo; onClose: () => void }) {
  const games = useLoad(api.games, 'games');
  const game =
    games.state === 'done' ? games.data.find((g) => g.slug === table.game.slug) : undefined;
  return (
    <Dialog
      title={`${table.game.name} rules`}
      onClose={onClose}
      closeLabel="Close"
      startAtTop
      closeOnOutsideClick
    >
      <AtThisTable table={table} game={game} />
      <GameRules slug={table.game.slug} level={3} />
    </Dialog>
  );
}
