/**
 * The table while a game is being played. Generic: it draws whatever zones
 * the view contains and offers exactly the legal moves the server sent.
 * See docs/decisions.md ("Web client (Phase 4)") for the layout rules.
 */
import type { Card as CardData, Move } from '@card-table/engine';
import type { ErrorCode, TableInfo } from '@card-table/server/protocol';
import { useMemo, useState } from 'react';
import { ActionBar } from './ActionBar';
import type { GameMessage, TableConnection } from './connection';
import { bidLabel, describeMove, seatNames } from './describe';
import { Hand } from './Hand';
import { buildControls, quickMove } from './moves';
import { Dialog, HistoryTable, RoundTable, Scoreboard } from './Scores';
import { Seat } from './Seat';
import { layoutZones, humanize } from './zones';
import { Pile, Trick, ZoneDisplay } from './ZoneViews';

const FRIENDLY: Partial<Record<ErrorCode | 'DISCONNECTED', string>> = {
  STALE_SEQ: 'The game moved on before your move arrived. Have another look and try again.',
  NOT_THEIR_TURN: "It's not your turn any more.",
  RATE_LIMITED: 'Slow down a little and try again.',
};

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const { code, message } = error as { code: ErrorCode; message: string };
    return FRIENDLY[code] ?? message;
  }
  return 'Something went wrong. Try again.';
}

export function TableView({
  table,
  game,
  connection,
  error,
  nudgedBy,
  isHost,
}: {
  table: TableInfo;
  game: GameMessage;
  connection: TableConnection;
  error: { code: ErrorCode; message: string } | null;
  nudgedBy: number | null;
  isHost: boolean;
}) {
  const { view, legalMoves, toAct, seq } = game;
  const names = useMemo(() => seatNames(table, view.you), [table, view.you]);
  const layout = useMemo(() => layoutZones(view), [view]);
  const controls = useMemo(() => buildControls(legalMoves), [legalMoves]);

  // A selection belongs to the game as it was when it was made; any new move clears it.
  const [selection, setSelection] = useState<{ seq: number; cards: string[] }>({ seq, cards: [] });
  const selected = selection.seq === seq ? selection.cards : [];
  const [busy, setBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showLastTrick, setShowLastTrick] = useState(false);
  // Rounds already summarised; a new entry in the history opens the round summary.
  const [roundsSeen, setRoundsSeen] = useState(view.history.length);
  const newRound = view.history.length > roundsSeen ? view.history[view.history.length - 1] : null;

  const paused = table.status === 'paused';
  const yourTurn = toAct.includes(view.you);
  const showTricks = view.trickZones.length > 0;
  const myBid = view.players[view.you]?.bid;

  const act = (move: Move) => {
    setBusy(true);
    setMoveError(null);
    connection
      .move(move)
      .then(() => setSelection({ seq: -1, cards: [] }))
      .catch((e: unknown) => setMoveError(errorText(e)))
      .finally(() => setBusy(false));
  };

  const send = (message: Parameters<TableConnection['send']>[0]) => {
    connection.send(message).catch((e: unknown) => setMoveError(errorText(e)));
  };

  const press = (card: CardData) => {
    setMoveError(null);
    if (selected.includes(card.id)) {
      const quick = selected.length === 1 ? quickMove(controls, card.id) : null;
      if (quick && !busy) act(quick);
      else setSelection({ seq, cards: selected.filter((id) => id !== card.id) });
      return;
    }
    // Cards that can be chosen together (to pass or meld) add to the selection.
    const together =
      controls.groupCards.has(card.id) && selected.every((id) => controls.groupCards.has(id));
    setSelection({ seq, cards: together ? [...selected, card.id] : [card.id] });
  };

  const lastLog = view.log[view.log.length - 1];
  const announcement = [
    lastLog ? describeMove(lastLog, names) : null,
    yourTurn && !paused ? 'Your turn.' : null,
  ]
    .filter(Boolean)
    .join('. ');

  const status = paused
    ? 'The host paused the game.'
    : yourTurn
      ? view.pending?.kind === 'chooseSuit'
        ? 'Your turn: choose a suit.'
        : 'Your turn.'
      : `Waiting for ${toAct.map(names).join(', ') || 'the next round'}…`;

  const others = view.players.filter((p) => p.id !== view.you);
  const trickToShow = showLastTrick && view.lastTrick ? view.lastTrick : view.trick;
  const hostEnd = () => {
    if (window.confirm('End this game for everyone? The result won’t be recorded.')) {
      send({ type: 'end' });
    }
  };

  return (
    <div className="table-screen">
      <div className="table-bar">
        <div className="table-title">
          <strong>{view.game}</strong>
          <span className="muted">
            Round {view.round} · {humanize(view.phase)}
          </span>
        </div>
        <div className="table-tools">
          <button
            type="button"
            className="small panel-toggle"
            aria-expanded={panelOpen}
            aria-controls="side-panel"
            onClick={() => setPanelOpen(!panelOpen)}
          >
            {panelOpen ? 'Hide scores' : 'Scores'}
          </button>
          {isHost && (
            <>
              <button
                type="button"
                className="small"
                onClick={() => send({ type: paused ? 'resume' : 'pause' })}
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button type="button" className="small danger" onClick={hostEnd}>
                End game
              </button>
            </>
          )}
        </div>
      </div>

      {nudgedBy !== null && (
        <p className="banner" role="alert">
          {names(nudgedBy)} nudged you: it's your turn.{' '}
          <button type="button" className="link-button" onClick={() => connection.dismissNudge()}>
            OK
          </button>
        </p>
      )}
      {error && (
        <p className="banner warn" role="alert">
          {FRIENDLY[error.code] ?? error.message}{' '}
          <button type="button" className="link-button" onClick={() => connection.dismissError()}>
            Dismiss
          </button>
        </p>
      )}

      <div className="table-main">
        <div
          // Many players: smaller seat panels so they fit around the table.
          className={`felt${view.players.length >= 7 ? ' crowded' : ''}`}
          role="region"
          aria-label="Table"
        >
          <div className="seats">
            {others.map((player) => (
              <Seat
                key={player.id}
                seat={player.id}
                view={view}
                table={table}
                zones={layout.seats.get(player.id) ?? []}
                names={names}
                toAct={paused ? [] : toAct}
                showTricks={showTricks}
                onNudge={(seat) => send({ type: 'nudge', seat })}
              />
            ))}
          </div>
          <div className="center">
            {trickToShow && trickToShow.plays.length > 0 && (
              <Trick
                trick={trickToShow}
                view={view}
                names={names}
                label={trickToShow === view.trick ? 'Current trick' : 'Last trick'}
              />
            )}
            {layout.piles.length > 0 && (
              <div className="piles">
                {layout.piles.map((zone) => (
                  <Pile
                    key={zone.key}
                    zone={zone}
                    moves={controls.byPile.get(zone.name) ?? []}
                    names={names}
                    onMove={act}
                    busy={busy}
                  />
                ))}
              </div>
            )}
          </div>
          {view.lastTrick && view.lastTrick !== view.trick && (
            <button
              type="button"
              className="small last-trick"
              aria-pressed={showLastTrick}
              onClick={() => setShowLastTrick(!showLastTrick)}
            >
              {showLastTrick ? 'Show current trick' : 'Last trick'}
            </button>
          )}
        </div>

        <aside
          id="side-panel"
          className={`side${panelOpen ? ' open' : ''}`}
          aria-label="Scores and log"
        >
          <Scoreboard view={view} names={names} teamZones={layout.teams} showTricks={showTricks} />
          {view.history.length > 0 && (
            <button type="button" className="small" onClick={() => setShowHistory(true)}>
              Every round
            </button>
          )}
          <section className="log" aria-label="Game log">
            <h2>Log</h2>
            <ol reversed>
              {view.log
                .slice(-30)
                .reverse()
                .map((move, i) => (
                  <li key={view.log.length - i}>{describeMove(move, names)}</li>
                ))}
            </ol>
          </section>
        </aside>
      </div>

      <div className={`you-area${yourTurn && !paused ? ' your-turn' : ''}`}>
        {layout.mine.length > 0 && (
          <div className="your-zones">
            {layout.mine.map((zone) => (
              <ZoneDisplay key={zone.key} zone={zone} size="small" compact />
            ))}
          </div>
        )}
        <div className="status-line">
          <strong>{status}</strong>
          <span className="muted">
            {layout.hand?.view.kind === 'count' && ' Your cards are face down.'}
            {myBid != null && ` Your bid: ${bidLabel(myBid).toLowerCase()}.`}
            {showTricks && ` You've won ${view.players[view.you]?.tricks ?? 0}.`}
          </span>
        </div>
        <Hand
          zone={layout.hand?.view ?? null}
          controls={paused ? buildControls([]) : controls}
          selected={selected}
          onPress={press}
          onClear={() => setSelection({ seq, cards: [] })}
        />
        {moveError && (
          <p role="alert" className="error">
            {moveError}
          </p>
        )}
        <ActionBar
          controls={paused ? buildControls([]) : controls}
          selected={selected}
          names={names}
          busy={busy}
          onMove={act}
          onClear={() => setSelection({ seq, cards: [] })}
        />
      </div>

      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>

      {newRound && (
        <Dialog
          title={`Round ${newRound.round} scores`}
          onClose={() => setRoundsSeen(view.history.length)}
        >
          <RoundTable result={newRound} teams={view.teams} names={names} />
        </Dialog>
      )}
      {showHistory && !newRound && (
        <Dialog title="Every round" onClose={() => setShowHistory(false)}>
          <HistoryTable history={view.history} teams={view.teams} names={names} />
        </Dialog>
      )}
    </div>
  );
}
