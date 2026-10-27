/** Past games on a page of their own: filters, date groups and "Play again". */
import { Link } from 'react-router';
import { useSession } from '../useSession';
import { PastGames } from './PastGames';

export function History() {
  const { user } = useSession();
  return (
    <div className="page">
      <h1>Past games</h1>
      {user === null && (
        <p>
          <Link to="/">Pick a name to start</Link>, and the games you finish will show up here.
        </p>
      )}
      {user && (
        <section className="panel" aria-label="Past games">
          <PastGames userId={user.id} />
        </section>
      )}
    </div>
  );
}
