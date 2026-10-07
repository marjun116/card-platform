import type { TableInfo } from '@card-table/server/protocol';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { useSession } from '../useSession';
import { useLoad } from '../useLoad';
import { GuestForm } from './SignIn';

const STATUS: Record<TableInfo['status'], string> = {
  lobby: 'Waiting for players',
  playing: 'Playing',
  paused: 'Paused',
  finished: 'Finished',
  abandoned: 'Ended',
};

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

function MyTables({ userId }: { userId: string }) {
  const tables = useLoad(api.myTables, userId);
  if (tables.state === 'loading') return <p className="muted">Loading your tables…</p>;
  if (tables.state === 'error') return <p className="error">{tables.message}</p>;
  if (tables.data.length === 0) {
    return <p className="muted">You're not at any tables yet.</p>;
  }
  return (
    <ul className="card-list">
      {tables.data.map((table) => {
        const you = table.seats.find((s) => s.user?.id === userId);
        const players = table.seats.filter((s) => s.user).map((s) => s.user?.displayName);
        return (
          <li key={table.code}>
            <Link to={`/t/${table.code}`} className="list-link">
              <strong>{table.game.name}</strong>
              <span>{STATUS[table.status]}</span>
              <span className="muted">
                {players.length > 0 ? players.join(', ') : 'No one seated yet'}
                {you === undefined && table.hostId === userId ? ' · you are hosting' : ''}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function Home() {
  const { user } = useSession();
  const [params] = useSearchParams();

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
        <div className="home-grid">
          <section className="panel">
            <h2>Start a game</h2>
            <p>
              <Link to="/games" className="button primary">
                Choose a game
              </Link>
            </p>
            <JoinForm />
          </section>
          <section className="panel">
            <h2>Your tables</h2>
            <MyTables userId={user.id} />
          </section>
        </div>
      )}
    </div>
  );
}
