/**
 * Before the game: the table drawn as a table, with its seats around the felt
 * where they'll be once it starts (yours at the bottom) and team colours from
 * the start. Empty seats pulse "Sit here". On computers, Start the game and
 * Rules sit in the middle of the felt; on phones, below it. The invite link
 * and house rules follow below.
 */
import type { SeatInfo, TableInfo } from '@card-table/server/protocol';
import { type CSSProperties, useState } from 'react';
import { RulesDialog } from '../components/Rules';
import { rulebookReady, useRulebook } from '../useRulebook';
import { SaveVariant } from '../components/Variants';
import { optionText } from '../gameText';
import { useNarrow } from '../useNarrow';
import { Avatar } from './Avatar';
import { seatInitials, teamColour } from './avatars';
import type { Outgoing, TableConnection } from './connection';
import { humanize, seatPosition } from './zones';

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
  const book = useRulebook(table.game.slug);
  const { games } = book;
  const optionDefs =
    games.state === 'done'
      ? games.data.find((g) => g.slug === table.game.slug)?.options
      : undefined;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);

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

  const narrow = useNarrow();
  const allSeated = table.seats.every((s) => s.user !== null);
  const filled = table.seats.filter((s) => s.user !== null).length;
  const initials = seatInitials(table);

  const seatButtons = (seat: SeatInfo) => {
    const mine = seat.seat === mySeat;
    return (
      <>
        {!seat.user && (
          <button
            type="button"
            className="sit-here"
            disabled={busy}
            onClick={() =>
              void (mySeat === null
                ? run({ type: 'sit', seat: seat.seat })
                : run({ type: 'stand' }, { type: 'sit', seat: seat.seat }))
            }
          >
            {mySeat === null ? 'Sit here' : 'Move here'}
          </button>
        )}
        {!seat.user && isHost && table.botsAllowed && (
          <button
            type="button"
            className="small"
            disabled={busy}
            onClick={() => void run({ type: 'addBot', seat: seat.seat })}
          >
            Add bot
          </button>
        )}
        {isHost && seat.bot && (
          <button
            type="button"
            className="small"
            disabled={busy}
            onClick={() => void run({ type: 'removeBot', seat: seat.seat })}
          >
            Remove bot
          </button>
        )}
        {mine && (
          <button
            type="button"
            className="small"
            disabled={busy}
            onClick={() => void run({ type: 'stand' })}
          >
            Leave seat
          </button>
        )}
        {isHost && seat.user && !mine && !seat.connected && (
          <button
            type="button"
            className="small"
            disabled={busy}
            onClick={() => void run({ type: 'freeSeat', seat: seat.seat })}
          >
            Free seat
          </button>
        )}
      </>
    );
  };

  // The buttons in one row, and what's still needed on its own line below them.
  const hint = !isHost
    ? 'Waiting for the host to start the game.'
    : allSeated
      ? null
      : 'Every seat needs a player to start.';
  const actions = (
    <div className="lobby-actions">
      <div className="lobby-buttons">
        {isHost && (
          <button
            type="button"
            className="primary"
            disabled={busy || !allSeated}
            onClick={() => void run({ type: 'start' })}
          >
            Start the game
          </button>
        )}
        <button type="button" onClick={() => setShowRules(true)}>
          Rules
        </button>
      </div>
      {hint && <span className="lobby-hint">{hint}</span>}
    </div>
  );

  return (
    <div className="page lobby">
      <h1>{table.game.name}</h1>
      <section
        className={`lobby-table${table.playerCount >= 7 ? ' crowded' : ''}`}
        aria-labelledby="lobby-seats"
      >
        <h2 id="lobby-seats" className="visually-hidden">
          Seats
        </h2>
        <div className="lobby-centre">
          <strong>{table.game.name}</strong>
          <span>
            {filled} of {table.playerCount} seats filled
          </span>
          {table.teams && (
            <span className="lobby-teams">
              {table.teams.map((team, i) => (
                <span key={i} style={{ '--team': teamColour(i) } as CSSProperties}>
                  Team {i + 1}: seats {team.map((s) => s + 1).join(' & ')}
                </span>
              ))}
            </span>
          )}
          {!narrow && actions}
        </div>
        <ul className="lobby-seats">
          {table.seats.map((seat) => {
            const team = teamOf(table, seat.seat);
            const mine = seat.seat === mySeat;
            // Where the seat will be at the table, with yours (or the first) at the bottom.
            const { x, y } = seatPosition(seat.seat, mySeat ?? 0, table.playerCount);
            return (
              <li
                key={seat.seat}
                className={`lobby-seat${seat.user ? '' : ' empty'}${mine ? ' mine' : ''}`}
                style={
                  { '--x': x, '--y': y, '--team': teamColour(team ?? seat.seat) } as CSSProperties
                }
              >
                <span className="seat-number">
                  Seat {seat.seat + 1}
                  {team !== null && <> · Team {team + 1}</>}
                </span>
                {seat.user ? (
                  <span className="lobby-player">
                    <Avatar initials={initials(seat.seat)} team={team ?? seat.seat}>
                      <span
                        className={`presence ${seat.connected ? 'on' : 'off'}`}
                        role="img"
                        aria-label={seat.connected ? 'here' : 'away'}
                      />
                    </Avatar>
                    <span className="seat-name">
                      {seat.user.displayName}
                      {mine && ' (you)'}
                    </span>
                    {seat.bot && <span className="bot-badge">Bot</span>}
                  </span>
                ) : (
                  <span className="visually-hidden">Empty</span>
                )}
                <span className="seat-actions">{seatButtons(seat)}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {narrow && actions}

      <div className="lobby-grid">
        <section className="panel">
          <h2>Invite players</h2>
          <InviteLink code={table.code} />
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

      {/* The rules are loaded with the lobby; if they're still on their way, the pop-up
          opens as soon as they arrive rather than empty. */}
      {showRules && rulebookReady(book) && (
        <RulesDialog table={table} book={book} onClose={() => setShowRules(false)} />
      )}
    </div>
  );
}
