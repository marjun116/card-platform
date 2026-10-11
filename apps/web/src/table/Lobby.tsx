import type { OptionDef, OptionValue } from '@card-table/engine';
import type { TableInfo } from '@card-table/server/protocol';
import { useState } from 'react';
import { api } from '../api';
import { SaveVariant } from '../components/Variants';
import { useLoad } from '../useLoad';
import type { Outgoing, TableConnection } from './connection';
import { humanize } from './zones';

function optionText(value: OptionValue, def: OptionDef | undefined): string {
  const label = def?.labels?.[String(value)];
  if (label) return label;
  if (value === true) return 'On';
  if (value === false) return 'Off';
  return String(value);
}

/** Team number for a seat, if the game has teams. */
function teamOf(table: Pick<TableInfo, 'teams'>, seat: number): number | null {
  const index = table.teams?.findIndex((team) => team.includes(seat)) ?? -1;
  return index === -1 ? null : index;
}

function InviteLink({ code }: { code: string }) {
  const link = `${window.location.origin}/t/${code}`;
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      .writeText(link)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };
  return (
    <div className="invite">
      <label className="field">
        Invite link
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <button type="button" onClick={copy}>
        Copy link
      </button>
      <span role="status" className="muted">
        {copied ? 'Copied' : ''}
      </span>
      <p className="muted">
        Or tell them the code: <strong className="code">{code}</strong>
      </p>
    </div>
  );
}

export function Lobby({
  table,
  connection,
  mySeat,
  isHost,
}: {
  table: TableInfo;
  connection: TableConnection;
  mySeat: number | null;
  isHost: boolean;
}) {
  const games = useLoad(api.games, 'games');
  const optionDefs =
    games.state === 'done'
      ? games.data.find((g) => g.slug === table.game.slug)?.options
      : undefined;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (...messages: Outgoing[]) => {
    setBusy(true);
    setError(null);
    try {
      for (const message of messages) await connection.send(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const allSeated = table.seats.every((s) => s.user !== null);

  return (
    <div className="page lobby">
      <h1>{table.game.name}</h1>
      <div className="lobby-grid">
        <section className="panel">
          <h2>Invite players</h2>
          <InviteLink code={table.code} />
        </section>

        <section className="panel">
          <h2>Seats</h2>
          {table.teams && (
            <p className="muted">
              {table.teams
                .map((team, i) => `Team ${i + 1} is seats ${team.map((s) => s + 1).join(' and ')}`)
                .join('; ')}
              .
            </p>
          )}
          <ul className="seat-list">
            {table.seats.map((seat) => {
              const team = teamOf(table, seat.seat);
              const mine = seat.seat === mySeat;
              return (
                <li key={seat.seat} className={mine ? 'mine' : undefined}>
                  <span className="seat-number">
                    Seat {seat.seat + 1}
                    {team !== null && <span className="muted"> · Team {team + 1}</span>}
                  </span>
                  <span className="seat-name">
                    {seat.user ? (
                      <>
                        <span
                          className={`presence ${seat.connected ? 'on' : 'off'}`}
                          role="img"
                          aria-label={seat.connected ? 'here' : 'away'}
                        />
                        {seat.user.displayName}
                        {mine && ' (you)'}
                        {seat.bot && <span className="bot-badge">Bot</span>}
                      </>
                    ) : (
                      <span className="muted">Empty</span>
                    )}
                  </span>
                  <span className="seat-actions">
                    {!seat.user && isHost && table.botsAllowed && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run({ type: 'addBot', seat: seat.seat })}
                      >
                        Add bot
                      </button>
                    )}
                    {isHost && seat.bot && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run({ type: 'removeBot', seat: seat.seat })}
                      >
                        Remove bot
                      </button>
                    )}
                    {!seat.user && mySeat === null && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run({ type: 'sit', seat: seat.seat })}
                      >
                        Sit here
                      </button>
                    )}
                    {!seat.user && mySeat !== null && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run({ type: 'stand' }, { type: 'sit', seat: seat.seat })
                        }
                      >
                        Move here
                      </button>
                    )}
                    {mine && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run({ type: 'stand' })}
                      >
                        Leave seat
                      </button>
                    )}
                    {isHost && seat.user && !mine && !seat.connected && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run({ type: 'freeSeat', seat: seat.seat })}
                      >
                        Free seat
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {Object.keys(table.options).length > 0 && (
          <section className="panel">
            <h2>House rules</h2>
            <dl className="options">
              {Object.entries(table.options).map(([name, value]) => (
                <div key={name}>
                  <dt>{optionDefs?.[name]?.label ?? humanize(name)}</dt>
                  <dd>{optionText(value, optionDefs?.[name])}</dd>
                </div>
              ))}
            </dl>
            <SaveVariant
              game={table.game.slug}
              options={table.options}
              playerCount={table.playerCount}
            />
          </section>
        )}
      </div>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <div className="lobby-actions">
        {isHost ? (
          <>
            <button
              type="button"
              className="primary"
              disabled={busy || !allSeated}
              onClick={() => void run({ type: 'start' })}
            >
              Start the game
            </button>
            {!allSeated && <span className="muted">Every seat needs a player to start.</span>}
          </>
        ) : (
          <span className="muted">Waiting for the host to start the game.</span>
        )}
      </div>
    </div>
  );
}
