import type { OptionDef, OptionValue } from '@card-table/engine';
import type { GameSummary } from '@card-table/server/protocol';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../api';
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
            {String(v)}
          </option>
        ))}
      </select>
    </label>
  );
}

function CreateForm({ game }: { game: GameSummary }) {
  const navigate = useNavigate();
  const [options, setOptions] = useState<Record<string, OptionValue>>(() =>
    Object.fromEntries(Object.entries(game.options).map(([k, def]) => [k, def.default])),
  );
  const [playerCount, setPlayerCount] = useState(game.players[0] ?? 2);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <form onSubmit={submit} className="stack panel">
      {game.players.length > 1 && (
        <label className="field">
          Players
          <select value={playerCount} onChange={(e) => setPlayerCount(Number(e.target.value))}>
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
              onChange={(value) => setOptions({ ...options, [name]: value })}
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
  );
}

export function CreateTable() {
  const { slug = '' } = useParams();
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
            <CreateForm game={game} />
          </>
        )}
      </div>
    </RequireUser>
  );
}
