/**
 * Past games on the home page: the games you sat at that are over, newest first and
 * grouped by date. Filtering by game and outcome happens on the server, so "Show
 * more" pages through the filtered list. Each row has the final scores in team
 * colours, links to the table's results, and can start a rematch with everyone.
 */
import type { PastGame } from '@card-table/server/protocol';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError, type HistoryFilter } from '../api';
import {
  DATE_GROUPS,
  dateGroup,
  nameList,
  outcomeText,
  pastName,
  type PastTeam,
  pastStandings,
  statsText,
} from '../gameText';
import { initials, teamColour } from '../table/avatars';
import { TeamAvatars } from '../table/Scores';
import { useLoad } from '../useLoad';

const OUTCOMES: Choice<HistoryFilter['outcome']>[] = [
  { value: undefined, label: 'All' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'early', label: 'Ended early' },
];

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Stats, the filters, then the list (loaded afresh whenever a filter changes). */
export function PastGames({ userId }: { userId: string }) {
  const played = useLoad(api.historyGames, `history-games:${userId}`);
  const stats = useLoad(api.stats, `stats:${userId}`);
  const [filter, setFilter] = useState<HistoryFilter>({});

  if (played.state === 'loading') return <p className="muted">Loading your past games…</p>;
  if (played.state === 'error') return <p className="error">{played.message}</p>;
  if (played.data.length === 0) return <p className="muted">Games you finish will show up here.</p>;

  const games: Choice<string | undefined>[] = [
    { value: undefined, label: 'All' },
    ...played.data.map(({ game }) => ({ value: game.slug, label: game.name })),
  ];
  return (
    <>
      {stats.state === 'done' && stats.data.length > 0 && (
        <ul className="stats-line">
          {stats.data.map((s) => (
            <li key={s.game.slug}>{statsText(s)}</li>
          ))}
        </ul>
      )}
      <div className="history-filters">
        {/* With only one game, "All" and that game are the same list. */}
        {played.data.length > 1 && (
          <Choices
            label="Game"
            choices={games}
            value={filter.game}
            onChange={(game) => setFilter({ ...filter, game })}
          />
        )}
        <Choices
          label="Outcome"
          choices={OUTCOMES}
          value={filter.outcome}
          onChange={(outcome) => setFilter({ ...filter, outcome })}
        />
      </div>
      {/* Keyed by the filter, so a new filter starts again from its first page. */}
      <HistoryList
        key={`${filter.game ?? ''}:${filter.outcome ?? ''}`}
        userId={userId}
        filter={filter}
      />
    </>
  );
}

interface Choice<T> {
  value: T;
  label: string;
}

/** A row of chips, one of them chosen; screen readers hear each as a toggle button. */
function Choices<T>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="filter-chips">
      {choices.map((choice) => (
        <button
          key={choice.label}
          type="button"
          className="filter-chip"
          aria-pressed={choice.value === value}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

/** The games matching the filter, 20 at a time, under date headings. */
function HistoryList({ userId, filter }: { userId: string; filter: HistoryFilter }) {
  const first = useLoad(
    () => api.history(0, filter),
    `history:${userId}:${filter.game ?? ''}:${filter.outcome ?? ''}`,
  );
  const [later, setLater] = useState<{ games: PastGame[]; more: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (first.state === 'loading') return <p className="muted">Loading your past games…</p>;
  if (first.state === 'error') return <p className="error">{first.message}</p>;
  const games = [...first.data.games, ...(later?.games ?? [])];
  const more = later ? later.more : first.data.more;
  if (games.length === 0) return <p className="muted">No past games match.</p>;

  const showMore = () => {
    setBusy(true);
    setError(null);
    api
      .history(games.length, filter)
      .then((page) =>
        setLater({ games: [...(later?.games ?? []), ...page.games], more: page.more }),
      )
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not load more'))
      .finally(() => setBusy(false));
  };

  // Newest first, so each group's games are already together and in order.
  const now = new Date();
  const groups = DATE_GROUPS.map((name) => ({
    name,
    games: games.filter((game) => dateGroup(game.endedAt, now) === name),
  })).filter((group) => group.games.length > 0);

  return (
    <>
      {groups.map((group) => (
        <div key={group.name} className="history-group">
          <h3>{group.name}</h3>
          <ul className="card-list">
            {group.games.map((game) => (
              <PastGameRow key={game.code} game={game} />
            ))}
          </ul>
        </div>
      ))}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {more && (
        <p>
          <button type="button" disabled={busy} onClick={showMore}>
            Show more
          </button>
        </p>
      )}
    </>
  );
}

/** The players of a game that ended early, by team (there are no scores). */
function playersByTeam(game: PastGame): Omit<PastTeam, 'score'>[] {
  const teams = new Map<number, number[]>();
  for (const { seat } of game.seats) {
    const team = game.seatTeams[seat] ?? seat;
    teams.set(team, [...(teams.get(team) ?? []), seat]);
  }
  return [...teams].map(([team, players]) => ({ team, players, won: false }));
}

/**
 * One past game: name, outcome and date (the link to its results covers the row),
 * each team in its colour with its final score and the winners crowned, and a
 * rematch for finished games.
 */
function PastGameRow({ game }: { game: PastGame }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outcome = outcomeText(game);
  const finished = game.status === 'finished';
  const teams: (Omit<PastTeam, 'score'> & { score?: number })[] = finished
    ? pastStandings(game)
    : playersByTeam(game);
  const letters = (seat: number) =>
    initials(game.seats.find((s) => s.seat === seat)?.displayName ?? `Seat ${seat + 1}`);
  const others = game.seats.filter((s) => s.seat !== game.you).map((s) => s.displayName);

  // The rematch waits in its lobby with everyone in their old seats; it's in their
  // "Your tables" too.
  const playAgain = () => {
    setBusy(true);
    setError(null);
    api
      .rematch(game.code)
      .then((code) => navigate(`/t/${code}`))
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message : "Couldn't start a rematch. Try again.");
        setBusy(false);
      });
  };

  return (
    <li className="past-game">
      <Link to={`/t/${game.code}`} className="past-link">
        <strong>{game.game.name}</strong>{' '}
        <span className={outcome === 'You lost' ? undefined : 'outcome'}>{outcome}</span>
        {game.endedAt && (
          <span className="muted"> · {dateFormat.format(new Date(game.endedAt))}</span>
        )}
      </Link>
      <ol className="past-teams" aria-label={finished ? 'Final scores' : 'Players'}>
        {teams.map((team) => (
          <li
            key={team.team}
            className={team.won ? 'won' : undefined}
            style={{ ['--team' as string]: teamColour(team.team) }}
          >
            <TeamAvatars team={{ id: team.team, players: team.players }} initials={letters} />
            <span>{team.players.map((seat) => pastName(game, seat)).join(' & ')}</span>
            {team.score !== undefined && <strong className="past-score">{team.score}</strong>}
            {team.won && (
              <>
                <span className="crown" aria-hidden="true">
                  ♛
                </span>
                <span className="visually-hidden"> (winner)</span>
              </>
            )}
          </li>
        ))}
      </ol>
      {finished && (
        <p className="past-actions">
          <button type="button" className="small" disabled={busy} onClick={playAgain}>
            Play again with these players
            {others.length > 0 && <span className="visually-hidden">: {nameList(others)}</span>}
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </li>
  );
}

/** How many finished games Home shows under "Recent games". */
export const RECENT_GAMES = 5;

/**
 * Home's short version: your last few games with how each went, linking to their
 * results, and a link to the full list.
 */
export function RecentGames({ userId }: { userId: string }) {
  const recent = useLoad(() => api.history(), `recent:${userId}`);
  if (recent.state === 'loading') return <p className="muted">Loading your past games…</p>;
  if (recent.state === 'error') return <p className="error">{recent.message}</p>;
  const games = recent.data.games.slice(0, RECENT_GAMES);
  if (games.length === 0) return <p className="muted">Games you finish will show up here.</p>;
  return (
    <>
      <ul className="card-list scroll-list">
        {games.map((game) => {
          const outcome = outcomeText(game);
          return (
            <li key={game.code}>
              <Link to={`/t/${game.code}`} className="list-link">
                <strong>{game.game.name}</strong>
                <span>
                  <span className={outcome === 'You lost' ? undefined : 'outcome'}>{outcome}</span>
                  {game.endedAt && (
                    <span className="muted"> · {dateFormat.format(new Date(game.endedAt))}</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="panel-foot">
        <Link to="/history">All past games →</Link>
      </p>
    </>
  );
}
