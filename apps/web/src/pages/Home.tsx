import type { TableInfo } from '@card-table/server/protocol';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../api';
import { GameTile } from '../components/GameTile';
import { useSession } from '../useSession';
import { useLoad } from '../useLoad';
import { useNarrow } from '../useNarrow';
import { RecentGames } from './PastGames';
import { GuestForm } from './SignIn';

const STATUS: Record<TableInfo['status'], string> = {
  lobby: 'Waiting for players',
  playing: 'Playing',
  paused: 'Paused',
  finished: 'Finished',
  abandoned: 'Ended',
};

/** Every game as a compact tile: one tap starts a new table. */
function GameChoices() {
  const games = useLoad(api.games, 'games');
  if (games.state === 'loading') return <p className="muted">Loading games…</p>;
  if (games.state === 'error') return <p className="error">{games.message}</p>;
  return (
    <ul className="tile-row" aria-label="Games">
      {games.data.map((game) => (
        <GameTile key={game.slug} game={game} compact />
      ))}
    </ul>
  );
}

function JoinForm() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    // Accept a pasted invite link as well as a bare code.
    const clean = code.trim().split('/').pop()?.toUpperCase() ?? '';
    if (clean) void navigate(`/t/${clean}`);
  };
  return (
    <form onSubmit={submit} className="inline-form">
      <label className="field">
        Join with an invite code or link
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="K7QX2M9PLA"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </label>
      <button type="submit" disabled={code.trim() === ''}>
        Join
      </button>
    </form>
  );
}

/**
 * Your unfinished tables, for someone coming back to a game. On phones it's first
 * on the page, and only there once you have some (nothing while they load, so the
 * page doesn't show an empty panel first). On wide screens it's always there,
 * beside the games, so the page doesn't move when your last table goes.
 */
function MyTables({ userId, always }: { userId: string; always: boolean }) {
  const tables = useLoad(api.myTables, userId);
  const [deleted, setDeleted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const panel = (body: ReactNode) => (
    <section className="panel home-tables">
      <h2>Your tables</h2>
      {body}
    </section>
  );
  if (tables.state === 'loading') return always ? panel(null) : null;
  if (tables.state === 'error') return panel(<p className="error">{tables.message}</p>);
  const shown = tables.data.filter((t) => !deleted.includes(t.code));
  if (shown.length === 0) {
    return always ? panel(<p className="muted">No games in progress.</p>) : null;
  }

  // Hosts can delete a table; a game in progress ends for everyone and leaves no record.
  const remove = (table: TableInfo) => {
    const started = table.status !== 'lobby';
    const others = table.seats.some((s) => s.user && s.user.id !== userId && !s.bot);
    const warning = started
      ? `Delete this ${table.game.name} table? The game ends${others ? ' for everyone' : ''} and won't appear in past games.`
      : `Delete this ${table.game.name} table?`;
    if (!window.confirm(warning)) return;
    setError(null);
    api
      .deleteTable(table.code)
      .then(() => setDeleted([...deleted, table.code]))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not delete it'));
  };

  return panel(
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ul className="card-list scroll-list">
        {shown.map((table) => {
          const you = table.seats.find((s) => s.user?.id === userId);
          const players = table.seats.filter((s) => s.user).map((s) => s.user?.displayName);
          return (
            <li key={table.code} className="table-row">
              <Link to={`/t/${table.code}`} className="list-link">
                <strong>{table.game.name}</strong>
                <span>{STATUS[table.status]}</span>
                <span className="muted">
                  {players.length > 0 ? players.join(', ') : 'No one seated yet'}
                  {you === undefined && table.hostId === userId ? ' · you are hosting' : ''}
                </span>
              </Link>
              {table.hostId === userId && (
                <button
                  type="button"
                  className="small danger"
                  aria-label={`Delete this ${table.game.name} table`}
                  onClick={() => remove(table)}
                >
                  Delete
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>,
  );
}

export function Home() {
  const { user } = useSession();
  const [params] = useSearchParams();
  const narrow = useNarrow();

  return (
    <div className="page">
      {params.get('signin') === 'expired' && (
        <p role="alert" className="error">
          That sign-in link has expired or was already used.{' '}
          <Link to="/sign-in">Ask for a new one</Link>.
        </p>
      )}
      <h1>Card Table</h1>
      <p className="lede">Play spades and other card games with family and friends, for points.</p>

      {user === null && (
        <section className="panel narrow">
          <h2>Pick a name to start</h2>
          <GuestForm />
          <p className="muted">
            Or <Link to="/sign-in">sign in with email</Link> to keep your seats on every device.
          </p>
        </section>
      )}

      {user && (
        // Phones: your tables first (for coming back to a game), the games, then a link
        // to past games. Wide screens: the games on the left; your tables and recent
        // games on the right, each half its height and scrolling within it.
        <div className="home-sections">
          <MyTables userId={user.id} always={!narrow} />
          <section className="panel home-start">
            <div className="start-head">
              <h2>Start a game</h2>
              <JoinForm />
            </div>
            <GameChoices />
            <p>
              <Link to="/games">All games, house rules and saved variants</Link>
            </p>
          </section>
          {narrow ? (
            <p className="home-history-link">
              <Link to="/history">Past games →</Link>
            </p>
          ) : (
            <section className="panel home-recent">
              <h2>Recent games</h2>
              <RecentGames userId={user.id} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
