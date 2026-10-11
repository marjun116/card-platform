import { Link, useParams } from 'react-router';
import { api } from '../api';
import { GameRules } from '../components/Rules';
import { useLoad } from '../useLoad';

/** A game's rulebook as a page of its own, linked from the Games page. */
export function RulesPage() {
  const { slug = '' } = useParams();
  const games = useLoad(api.games, 'games');
  const game = games.state === 'done' ? games.data.find((g) => g.slug === slug) : undefined;

  return (
    <div className="page narrow prose">
      {games.state === 'loading' && <p className="muted">Loading…</p>}
      {games.state === 'error' && <p className="error">{games.message}</p>}
      {games.state === 'done' && !game && (
        <p>
          There's no game called “{slug}”. <Link to="/games">See all games</Link>.
        </p>
      )}
      {game && (
        <>
          <h1>{game.name} rules</h1>
          <p>
            <Link to={`/games/${game.slug}/new`} className="button primary">
              New table
            </Link>
          </p>
          <GameRules slug={game.slug} level={2} />
        </>
      )}
    </div>
  );
}
