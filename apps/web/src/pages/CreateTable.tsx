import type { OptionDef, OptionValue } from '@card-table/engine';
import type { GameSummary, VariantInfo } from '@card-table/server/protocol';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, ApiError, variantPath } from '../api';
import { SaveVariant } from '../components/Variants';
import { useSession } from '../useSession';
import { useLoad } from '../useLoad';
import { playersText } from '../gameText';
import { RequireUser } from './SignIn';

/** One house-rule control, built from the option's definition in the game file. */
function OptionField({
  name,
  def,
  value,
  onChange,
}: {
  name: string;
  def: OptionDef;
  value: OptionValue;
  onChange: (value: OptionValue) => void;
}) {
  if (def.type === 'boolean') {
    return (
      <label className="check">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {def.label}
      </label>
    );
  }
  const values = def.values ?? [def.default];
  return (
    <label className="field">
      {def.label}
      {/* Values can be numbers or strings, so the select works with their positions. */}
      <select
        name={name}
        value={values.indexOf(value)}
        onChange={(e) => onChange(values[Number(e.target.value)] ?? def.default)}
      >
        {values.map((v, i) => (
          <option key={String(v)} value={i}>
            {def.labels?.[String(v)] ?? String(v)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The game's standard settings: every option at its default, the fewest players. */
function standard(game: GameSummary): Settings {
  return {
    options: Object.fromEntries(Object.entries(game.options).map(([k, def]) => [k, def.default])),
    playerCount: game.players[0] ?? 2,
  };
}

interface Settings {
  options: Record<string, OptionValue>;
  playerCount: number;
}

function CreateForm({
  game,
  variants,
  shared,
  onSaved,
}: {
  game: GameSummary;
  /** Variants that can be picked as a starting point. */
  variants: VariantInfo[];
  /** The variant the page's link opened, if any: the form starts from it. */
  shared: VariantInfo | null;
  onSaved: (variant: VariantInfo) => void;
}) {
  const navigate = useNavigate();
  const { user } = useSession();
  const [from, setFrom] = useState(shared?.code ?? '');
  const [settings, setSettings] = useState<Settings>(() => shared ?? standard(game));
  const { options, playerCount } = settings;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startFrom = (code: string) => {
    setFrom(code);
    const variant = variants.find((v) => v.code === code);
    setSettings(
      variant ? { options: variant.options, playerCount: variant.playerCount } : standard(game),
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    api
      .createTable(game.slug, options, playerCount)
      .then((table) => navigate(`/t/${table.code}`))
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message : 'Could not create the table');
        setBusy(false);
      });
  };

  const hasSettings = game.players.length > 1 || Object.keys(game.options).length > 0;

  return (
    <>
      <form onSubmit={submit} className="stack panel">
        {variants.length > 0 && (
          <label className="field">
            Start from
            <select value={from} onChange={(e) => startFrom(e.target.value)}>
              <option value="">Standard rules</option>
              {variants.map((v) => (
                <option key={v.code} value={v.code}>
                  {v.name}
                  {v.owner.id !== user?.id && ` (from ${v.owner.displayName})`}
                </option>
              ))}
            </select>
          </label>
        )}
        {game.players.length > 1 && (
          <label className="field">
            Players
            <select
              value={playerCount}
              onChange={(e) => setSettings({ options, playerCount: Number(e.target.value) })}
            >
              {game.players.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        {Object.keys(game.options).length > 0 && (
          <fieldset className="stack">
            <legend>House rules</legend>
            {Object.entries(game.options).map(([name, def]) => (
              <OptionField
                key={name}
                name={name}
                def={def}
                value={options[name] ?? def.default}
                onChange={(value) =>
                  setSettings({ options: { ...options, [name]: value }, playerCount })
                }
              />
            ))}
          </fieldset>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          Create table
        </button>
      </form>
      {hasSettings && (
        <section className="panel keep-rules">
          <h2>Keep these rules</h2>
          <p className="muted">
            Save these settings under a name to start from them next time, or share the link so
            others can play by your rules.
          </p>
          <SaveVariant
            game={game.slug}
            options={options}
            playerCount={playerCount}
            onSaved={(variant) => {
              onSaved(variant);
              setFrom(variant.code);
            }}
          />
        </section>
      )}
    </>
  );
}

/** Loads the variants the form can start from, then shows it. */
function CreatePanel({ game, variantCode }: { game: GameSummary; variantCode: string | null }) {
  const { user } = useSession();
  const mine = useLoad(api.myVariants, `mine:${user?.id ?? ''}`);
  const shared = useLoad(
    () => (variantCode ? api.variant(variantCode) : Promise.resolve(null)),
    `shared:${variantCode ?? ''}`,
  );
  const [added, setAdded] = useState<VariantInfo[]>([]);

  if (mine.state === 'loading' || shared.state === 'loading') {
    return <p className="muted">Loading…</p>;
  }
  // Without the lists the form still works, from the standard rules.
  const sharedVariant = shared.state === 'done' ? shared.data : null;
  const forThisGame = sharedVariant?.game.slug === game.slug ? sharedVariant : null;
  const own = [...added, ...(mine.state === 'done' ? mine.data : [])];
  const variants = [
    ...(forThisGame && !own.some((v) => v.code === forThisGame.code) ? [forThisGame] : []),
    ...own,
  ].filter((v) => v.game.slug === game.slug);

  return (
    <>
      {shared.state === 'error' && (
        <p role="alert" className="error">
          {shared.status === 404
            ? 'That variant link no longer works (it may have been deleted). Starting from the standard rules.'
            : shared.message}
        </p>
      )}
      {sharedVariant && !forThisGame && (
        <p role="alert" className="error">
          That variant is for {sharedVariant.game.name}.{' '}
          <Link to={variantPath(sharedVariant)}>
            Start a {sharedVariant.game.name} table instead
          </Link>
          .
        </p>
      )}
      {forThisGame && (
        <p className="muted">
          Starting from “{forThisGame.name}”, saved by {forThisGame.owner.displayName}.
        </p>
      )}
      <CreateForm
        game={game}
        variants={variants}
        shared={forThisGame}
        onSaved={(variant) => setAdded([variant, ...added])}
      />
    </>
  );
}

export function CreateTable() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const games = useLoad(api.games, 'games');
  const game = games.state === 'done' ? games.data.find((g) => g.slug === slug) : undefined;

  return (
    <RequireUser why="Pick a name to create a table">
      <div className="page narrow">
        {games.state === 'loading' && <p className="muted">Loading…</p>}
        {games.state === 'error' && <p className="error">{games.message}</p>}
        {games.state === 'done' && !game && (
          <p>
            There's no game called “{slug}”. <Link to="/games">See all games</Link>.
          </p>
        )}
        {game && (
          <>
            <h1>New {game.name} table</h1>
            <p className="muted">{playersText(game)}</p>
            <CreatePanel game={game} variantCode={params.get('variant')} />
          </>
        )}
      </div>
    </RequireUser>
  );
}
