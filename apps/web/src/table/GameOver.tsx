/**
 * The end of a game: who won (with confetti, if you watched it end), final
 * scores counting up, a podium for three or more teams, the game's stats,
 * the last round and every round, and a rematch with everyone in the same seats.
 */
import type { TableInfo } from '@card-table/server/protocol';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { GameMessage, OverMessage, TableConnection } from './connection';
import { Confetti } from './Confetti';
import { CountUp } from './CountUp';
import { type SeatInitials, seatInitials, teamColour } from './avatars';
import { type SeatNames, seatNames, teamName } from './describe';
import { ReplayDialog } from './ReplayDialog';
import { finishingOrder, gameStats, ordinal, type Placed } from './results';
import { RoundSummary } from './RoundSummary';
import { HistoryTable, TeamAvatars } from './Scores';

/** "Ana", "Ana and Raj", "Ana, Raj and Sam". */
function nameList(all: string[]): string {
  return all.length > 1
    ? `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`
    : (all[0] ?? '');
}

export function GameOver({
  table,
  game,
  over,
  celebrate = false,
  connection,
}: {
  table: TableInfo;
  game: GameMessage;
  over: OverMessage | null;
  /** You watched the game end: confetti and scores counting up (not when looking back). */
  celebrate?: boolean;
  /** To ask for a rematch (none: no rematch button). */
  connection?: Pick<TableConnection, 'send'>;
}) {
  const { view } = game;
  const names = seatNames(table, view.you);
  const initials = seatInitials(table);
  const abandoned = table.status === 'abandoned';
  const winners = over?.winners ?? view.winners;
  const youWon = winners.includes(view.you);
  const placed = finishingOrder(view.teams, winners, view.goal.winner);
  const winning = placed.filter(({ team }) => team.players.some((p) => winners.includes(p)));
  const lastRound = view.history[view.history.length - 1];
  // A round being played back with every hand face up.
  const [handsRound, setHandsRound] = useState<number | null>(null);

  // Asking for a rematch takes you to its lobby once the server says where it is.
  const navigate = useNavigate();
  const rematch = table.rematch;
  const canRematch = connection !== undefined && table.status === 'finished';
  const [asked, setAsked] = useState(false);
  const [asking, setAsking] = useState(false);
  const [rematchError, setRematchError] = useState<string | null>(null);
  const rematchCode = rematch?.code ?? null;
  useEffect(() => {
    if (asked && rematchCode) void navigate(`/t/${rematchCode}`);
  }, [asked, rematchCode, navigate]);
  const startRematch = () => {
    if (!connection) return;
    setAsking(true);
    setRematchError(null);
    connection
      .send({ type: 'rematch' })
      .then(() => setAsked(true))
      .catch(() => setRematchError("Couldn't start a rematch. Try again."))
      .finally(() => setAsking(false));
  };

  // If you lost, a kind word first, then who won.
  let headline: string;
  let subline: string | null = null;
  if (abandoned) headline = 'The host ended the game';
  else if (winners.length === 0) headline = 'Game over';
  else {
    const others = winners.filter((seat) => seat !== view.you).map(names);
    const all = youWon ? ['You', ...others] : others;
    const won = `${nameList(all)} ${all.length > 1 || youWon ? 'win' : 'wins'}!`;
    if (youWon) headline = won;
    else {
      headline = 'Good game';
      subline = won;
    }
  }

  // Three or more teams stand on a podium; any after the first three are listed below it.
  const podium = !abandoned && placed.length >= 3;
  const cards = abandoned ? [] : podium ? placed.slice(0, 3) : placed;
  const rest = abandoned ? placed : podium ? placed.slice(3) : [];

  return (
    <div className="page game-over">
      {celebrate && !abandoned && (
        <Confetti colours={winning.map(({ team }) => teamColour(team.id))} />
      )}
      <header className="victory">
        <h1>{headline}</h1>
        {subline && <p className="victory-sub">{subline}</p>}
      </header>
      {!abandoned && view.notes.length > 0 && (
        <p className="result-notes">{view.notes.join(' ')}</p>
      )}
      {abandoned && (
        <p className="muted">These are the scores when it ended. No result is recorded.</p>
      )}

      <section className="final" aria-labelledby="final-scores">
        <h2 id="final-scores" className={abandoned ? undefined : 'visually-hidden'}>
          {abandoned ? 'Scores so far' : 'Final scores'}
        </h2>
        {cards.length > 0 && (
          <ol className={`final-scores${podium ? ' podium' : ''}`}>
            {cards.map((entry) => (
              <FinalTeam
                key={entry.team.id}
                entry={entry}
                winner={winning.includes(entry)}
                showPlace={podium}
                countUp={celebrate}
                names={names}
                initials={initials}
              />
            ))}
          </ol>
        )}
        {rest.length > 0 && (
          <ol className={`standings${abandoned ? '' : ' panel'}`}>
            {rest.map(({ team, place }) => (
              <li key={team.id} style={{ ['--team' as string]: teamColour(team.id) }}>
                {!abandoned && <span className="standing-place">{ordinal(place)}</span>}
                <TeamAvatars team={team} initials={initials} />
                <span className="standing-name">{teamName(team, names)}</span>
                <strong>{team.score}</strong>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="actions">
        {canRematch &&
          (rematch ? (
            <Link to={`/t/${rematch.code}`} className="button primary">
              {rematch.by === view.you ? 'Go to the rematch' : 'Join the rematch'}
            </Link>
          ) : (
            <button type="button" className="primary" disabled={asking} onClick={startRematch}>
              Rematch
            </button>
          ))}
        <Link
          to={`/games/${table.game.slug}/new`}
          className={`button${canRematch ? '' : ' primary'}`}
        >
          {canRematch ? 'New table' : `Play ${table.game.name} again`}
        </Link>
        <Link to="/" className="button">
          Home
        </Link>
      </p>
      <p className="rematch-note" role="status">
        {rematch &&
          rematch.by !== view.you &&
          `${rematch.by === null ? 'Someone' : names(rematch.by)} started a rematch, with everyone in the same seats.`}
      </p>
      {rematchError && (
        <p role="alert" className="error">
          {rematchError}
        </p>
      )}

      {view.history.length > 0 && <StatsPanel view={view} names={names} />}

      {lastRound && (
        <section className="panel">
          <h2>Last round</h2>
          <RoundSummary
            result={lastRound}
            view={view}
            names={names}
            initials={initials}
            onShowHands={() => setHandsRound(lastRound.round)}
          />
        </section>
      )}

      <section className="panel">
        <h2>Every round</h2>
        <HistoryTable
          history={view.history}
          teams={view.teams}
          names={names}
          target={view.goal.target}
          onShowHands={setHandsRound}
        />
      </section>
      {handsRound !== null && (
        <ReplayDialog
          code={table.code}
          round={handsRound}
          view={view}
          names={names}
          initials={initials}
          onClose={() => setHandsRound(null)}
        />
      )}
    </div>
  );
}

/** A team's final score card: on the podium, or side by side for one or two teams. */
function FinalTeam({
  entry: { team, place },
  winner,
  showPlace,
  countUp,
  names,
  initials,
}: {
  entry: Placed;
  winner: boolean;
  showPlace: boolean;
  countUp: boolean;
  names: SeatNames;
  initials: SeatInitials;
}) {
  return (
    <li
      className={`final-team place-${Math.min(place, 3)}${winner ? ' winner' : ''}`}
      style={{ ['--team' as string]: teamColour(team.id) }}
    >
      {showPlace && <span className="final-place">{ordinal(place)}</span>}
      <TeamAvatars team={team} initials={initials} />
      <span className="final-name">
        {teamName(team, names)}
        {winner && (
          <>
            <span className="crown" aria-hidden="true">
              ♛
            </span>
            <span className="visually-hidden"> (winner)</span>
          </>
        )}
      </span>
      <CountUp value={team.score} {...(countUp && { from: 0 })} className="final-score" />
    </li>
  );
}

/** Tricks won and bids made per player, and the biggest round; only what the game has. */
function StatsPanel({ view, names }: { view: GameMessage['view']; names: SeatNames }) {
  const stats = gameStats(view.history, view.players);
  const biggestTeam = stats.biggest && view.teams.find((t) => t.id === stats.biggest?.team);
  if (!stats.showTricks && !stats.showBids && !biggestTeam) return null;
  return (
    <section className="panel game-stats">
      <h2>Game stats</h2>
      {(stats.showTricks || stats.showBids) && (
        <table className="history-table">
          <thead>
            <tr>
              <th scope="col">Player</th>
              {stats.showTricks && <th scope="col">Tricks won</th>}
              {stats.showBids && <th scope="col">Bids made</th>}
            </tr>
          </thead>
          <tbody>
            {stats.players.map((player) => (
              <tr key={player.id}>
                <th scope="row">{names(player.id)}</th>
                {stats.showTricks && <td>{player.tricks}</td>}
                {stats.showBids && (
                  <td>{player.bids.of > 0 ? `${player.bids.made} of ${player.bids.of}` : '–'}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {stats.biggest && biggestTeam && (
        <p>
          <span className="muted">Biggest round:</span> Round {stats.biggest.round},{' '}
          {teamName(biggestTeam, names)} +{stats.biggest.points}
        </p>
      )}
    </section>
  );
}
