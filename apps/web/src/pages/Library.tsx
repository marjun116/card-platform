import { Link } from 'react-router';
import { api } from '../api';
import { playersText } from '../gameText';
import { useLoad } from '../useLoad';

export function Library() {
  const games = useLoad(api.games, 'games');
  return (
    <div className="page">
      <h1>Games</h1>
      {games.state === 'loading' && <p className="muted">Loading games…</p>}
      {games.state === 'error' && <p className="error">{games.message}</p>}
      {games.state === 'done' && (
        <ul className="game-grid">
          {games.data.map((game) => (
            <li key={game.slug} className="panel">
              <h2>{game.name}</h2>
              <p className="muted">{playersText(game)}</p>
              {Object.keys(game.options).length > 0 && (
                <p className="muted">
                  House rules:{' '}
                  {Object.values(game.options)
                    .map((o) => o.label)
                    .join(' · ')}
                </p>
              )}
              <Link to={`/games/${game.slug}/new`} className="button primary">
                New table
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
