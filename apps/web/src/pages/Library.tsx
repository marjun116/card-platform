import type { VariantInfo } from '@card-table/server/protocol';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError, variantLink, variantPath } from '../api';
import { CopyButton } from '../components/Variants';
import { playersText } from '../gameText';
import { useLoad } from '../useLoad';
import { useSession } from '../useSession';

/** The variants you've saved, each with its share link. */
function MyVariants({ userId }: { userId: string }) {
  const variants = useLoad(api.myVariants, userId);
  const [deleted, setDeleted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  if (variants.state !== 'done') return null;
  const shown = variants.data.filter((v) => !deleted.includes(v.code));
  if (shown.length === 0) return null;

  const remove = (variant: VariantInfo) => {
    if (!window.confirm(`Delete “${variant.name}”? Links to it will stop working.`)) return;
    setError(null);
    api
      .deleteVariant(variant.code)
      .then(() => setDeleted([...deleted, variant.code]))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not delete it'));
  };

  return (
    <section className="panel my-variants">
      <h2>Your variants</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ul className="card-list">
        {shown.map((variant) => (
          <li key={variant.code} className="variant-row">
            <span>
              <strong>{variant.name}</strong>
              <span className="muted">
                {' '}
                · {variant.game.name}, {variant.playerCount} players
              </span>
            </span>
            <span className="actions">
              <Link to={variantPath(variant)} className="button small primary">
                New table
              </Link>
              <CopyButton text={variantLink(variant)} />
              <button type="button" className="small danger" onClick={() => remove(variant)}>
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Library() {
  const { user } = useSession();
  const games = useLoad(api.games, 'games');
  return (
    <div className="page">
      <h1>Games</h1>
      {user && <MyVariants userId={user.id} />}
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
              <p className="actions">
                <Link to={`/games/${game.slug}/new`} className="button primary">
                  New table
                </Link>
                <Link to={`/games/${game.slug}/rules`}>Rules</Link>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
