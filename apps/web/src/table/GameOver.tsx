/** The end of a game: who won, final scores and every round. */
import type { TableInfo } from '@card-table/server/protocol';
import { Link } from 'react-router';
import type { GameMessage, OverMessage } from './connection';
import { seatInitials, teamColour } from './avatars';
import { seatNames, teamName } from './describe';
import { RoundSummary } from './RoundSummary';
import { HistoryTable, TeamAvatars } from './Scores';

export function GameOver({
  table,
  game,
  over,
}: {
  table: TableInfo;
  game: GameMessage;
  over: OverMessage | null;
}) {
  const { view } = game;
  const names = seatNames(table, view.you);
  const initials = seatInitials(table);
  const abandoned = table.status === 'abandoned';
  const winners = over?.winners ?? view.winners;
  const youWon = winners.includes(view.you);
  const standings = [...view.teams].sort((a, b) => b.score - a.score);
  const lastRound = view.history[view.history.length - 1];

  let headline: string;
  if (abandoned) headline = 'The host ended the game';
  else if (winners.length === 0) headline = 'Game over';
  else {
    const others = winners.filter((seat) => seat !== view.you).map(names);
    const all = youWon ? ['You', ...others] : others;
    const list =
      all.length > 1 ? `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}` : all[0];
    headline = `${list} ${all.length > 1 || youWon ? 'win' : 'wins'}!`;
  }

  return (
    <div className="page game-over">
      <h1>{headline}</h1>
      {!abandoned && view.notes.length > 0 && (
        <p className="result-notes">{view.notes.join(' ')}</p>
      )}
      {abandoned && (
        <p className="muted">These are the scores when it ended. No result is recorded.</p>
      )}

      <section className="panel">
        <h2>{abandoned ? 'Scores so far' : 'Final scores'}</h2>
        <ol className="standings">
          {standings.map((team) => (
            <li
              key={team.id}
              className={`team-entry${team.players.some((p) => winners.includes(p)) ? ' winner' : ''}`}
              style={{ ['--team' as string]: teamColour(team.id) }}
            >
              <TeamAvatars team={team} initials={initials} />
              <span className="standing-name">{teamName(team, names)}</span>
              <strong>{team.score}</strong>
            </li>
          ))}
        </ol>
      </section>

      {lastRound && (
        <section className="panel">
          <h2>Last round</h2>
          <RoundSummary result={lastRound} view={view} names={names} initials={initials} />
        </section>
      )}

      <section className="panel">
        <h2>Every round</h2>
        <HistoryTable
          history={view.history}
          teams={view.teams}
          names={names}
          target={view.goal.target}
        />
      </section>

      <p className="actions">
        <Link to={`/games/${table.game.slug}/new`} className="button primary">
          Play {table.game.name} again
        </Link>
        <Link to="/" className="button">
          Home
        </Link>
      </p>
    </div>
  );
}
