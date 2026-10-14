/**
 * The table while a game is being played. Generic: it draws whatever zones
 * the view contains and offers exactly the legal moves the server sent.
 * See docs/decisions.md ("Web client (Phase 4)") for the layout rules.
 */
import type { Card as CardData, Move } from '@card-table/engine';
import type { ErrorCode, TableInfo } from '@card-table/server/protocol';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, type MenuItem } from '../components/Menu';
import { RulesDialog } from '../components/Rules';
import { useHeaderSlot } from '../headerSlot';
import { DecisionPanel, HandActions } from './ActionBar';
import type { GameMessage, TableConnection } from './connection';
import { bidWords, logLines, seatNames, teamName } from './describe';
import { GroupSummary, Hand } from './Hand';
import { buildControls, quickMove, turnPrompt } from './moves';
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
  const paused = table.status === 'paused';
  // While paused nobody can move, so no controls are shown.
  const controls = useMemo(() => buildControls(paused ? [] : legalMoves), [legalMoves, paused]);

  // A selection belongs to the game as it was when it was made; any new move clears it.
  const [selection, setSelection] = useState<{ seq: number; cards: string[] }>({ seq, cards: [] });
  const selected = selection.seq === seq ? selection.cards : [];
  const [busy, setBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showLastTrick, setShowLastTrick] = useState(false);
  // Rounds already summarised; a new entry in the history opens the round summary.
  const [roundsSeen, setRoundsSeen] = useState(view.history.length);
  const newRound = view.history.length > roundsSeen ? view.history[view.history.length - 1] : null;

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

  const arrangement = view.arrangement;
  const press = (card: CardData) => {
    setMoveError(null);
    if (selected.includes(card.id)) {
      const quick = selected.length === 1 ? quickMove(controls, card.id) : null;
      if (quick && !busy) act(quick);
      else setSelection({ seq, cards: selected.filter((id) => id !== card.id) });
      return;
    }
    // Cards that can be chosen together (to pass, meld, or group) add to the selection.
    const together =
      arrangement !== null ||
      (controls.groupCards.has(card.id) && selected.every((id) => controls.groupCards.has(id)));
    setSelection({ seq, cards: together ? [...selected, card.id] : [card.id] });
  };

  // Clear selection removes the button that was pressed, so put keyboard focus back on
  // the card that was selected rather than letting it drop to the top of the page.
  const clearFromButton = () => {
    const first = selected[0];
    setSelection({ seq, cards: [] });
    const card = first && document.querySelector<HTMLElement>(`.hand [data-card="${first}"]`);
    if (card) card.focus({ preventScroll: true });
  };

  const log = useMemo(() => logLines(view, names), [view, names]);
  const lastLog = log[log.length - 1];
  const announcement = [lastLog ?? null, yourTurn && !paused ? turnPrompt(controls, names) : null]
    .filter(Boolean)
    .join('. ');

  // Bots wait while anyone still has the last round's scores open; say who, not the bot.
  const readers = table.readingScores.filter((seat) => seat !== view.you);
  const botsWaiting = readers.length > 0 && toAct.some((seat) => table.seats[seat]?.bot === true);
  const status = paused
    ? 'The host paused the game.'
    : yourTurn
      ? turnPrompt(controls, names)
      : botsWaiting
        ? `Waiting for ${readers.map(names).join(', ')} to close the round scores…`
        : `Waiting for ${toAct.map(names).join(', ') || 'the next round'}…`;

  const others = view.players.filter((p) => p.id !== view.you);
  // A finished trick stays on the table until the next one starts, so everyone can see
  // the last card played and who won it.
  const trickStarted = (view.trick?.plays.length ?? 0) > 0;
  const trickToShow =
    view.lastTrick && (showLastTrick || !trickStarted) ? view.lastTrick : view.trick;
  const hostEnd = () => {
    if (window.confirm('End this game for everyone? The result won’t be recorded.')) {
      send({ type: 'end' });
    }
  };

  // The game's name, round and buttons go in the site header, not a second bar.
  const header = useHeaderSlot();
  const menuItems: MenuItem[] = [
    ...(isHost
      ? [
          {
            label: paused ? 'Resume' : 'Pause',
            onSelect: () => send({ type: paused ? 'resume' : 'pause' }),
          },
          { label: 'End game', onSelect: hostEnd, danger: true },
        ]
      : []),
    ...(view.history.length > 0
      ? [{ label: 'Every round', onSelect: () => setShowHistory(true) }]
      : []),
    { label: 'Rules', onSelect: () => setShowRules(true) },
  ];
  const gameBar = (
    <div className="game-bar">
      <div className="game-title">
        <strong>{view.game}</strong>
        <span className="muted">
          <span className="wide-only">Round {view.round}</span>
          <span className="phone-only">R{view.round}</span> · {humanize(view.phase)}
        </span>
      </div>
      <div className="game-tools">
        <button
          type="button"
          className="small phone-only"
          aria-expanded={panelOpen}
          aria-controls="side-panel"
          onClick={() => setPanelOpen(!panelOpen)}
        >
          {panelOpen ? 'Hide scores' : 'Scores'}
        </button>
        <button type="button" className="small wide-only" onClick={() => setShowRules(true)}>
          Rules
        </button>
        {isHost && (
          <span className="wide-only game-host">
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
          </span>
        )}
        <Menu className="phone-only" label="Game menu" buttonText="⋯" items={menuItems} />
      </div>
    </div>
  );

  return (
    <div className="table-screen">
      {header ? header.slot && createPortal(gameBar, header.slot) : gameBar}
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
          // Seven or more: smaller seat panels on wide screens.
          // Five or more players: seats become chips on phones (see Seat.tsx).
          className={`felt${view.players.length >= 5 ? ' many' : ''}${view.players.length >= 7 ? ' crowded' : ''}`}
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
                controls={controls}
                selected={selected}
                onPress={press}
                {...(isHost && {
                  onReplace: (seat: number) => {
                    if (window.confirm(`Let a bot play for ${names(seat)} from now on?`)) {
                      send({ type: 'replaceWithBot', seat });
                    }
                  },
                })}
              />
            ))}
          </div>
          <div className="center">
            {view.display.length > 0 && (
              <p className="display-values">
                {view.display.map((item) => {
                  const team =
                    item.format === 'team' && typeof item.value === 'number'
                      ? view.teams[item.value]
                      : undefined;
                  const text =
                    item.format === 'player' && typeof item.value === 'number'
                      ? names(item.value)
                      : team
                        ? teamName(team, names)
                        : String(item.value);
                  return (
                    <span key={item.label}>
                      <span className="muted">{item.label}</span> <strong>{text}</strong>
                    </span>
                  );
                })}
              </p>
            )}
            <div className="center-row">
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
            {/* Decisions that don't use a card from your hand go where you're already looking. */}
            <DecisionPanel
              controls={controls}
              names={names}
              choices={view.choiceLabels}
              bidLabels={view.bidLabels}
              busy={busy}
              onMove={act}
            />
          </div>
          {view.lastTrick && trickStarted && (
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
              {log
                .slice(-30)
                .reverse()
                .map((line, i) => (
                  <li key={log.length - i}>{line}</li>
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
            {myBid != null && ` Your bid: ${bidWords(myBid, view.bidLabels)}.`}
            {view.control?.seat === view.you && ` ${names(view.control.by)} is playing your cards.`}
            {showTricks && ` You've won ${view.players[view.you]?.tricks ?? 0}.`}
          </span>
        </div>
        <GroupSummary arrangement={arrangement} />
        <Hand
          zone={layout.hand?.view ?? null}
          controls={controls}
          arrangement={arrangement}
          selected={selected}
          onPress={press}
          onClear={() => setSelection({ seq, cards: [] })}
        />
        {moveError && (
          <p role="alert" className="error">
            {moveError}
          </p>
        )}
        <HandActions
          controls={controls}
          arrangement={arrangement}
          selected={selected}
          names={names}
          busy={busy}
          onMove={act}
          onClear={clearFromButton}
        />
      </div>

      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>

      {newRound && (
        <Dialog
          title={`Round ${newRound.round} scores`}
          onClose={() => {
            setRoundsSeen(view.history.length);
            // The bots wait until everyone has closed the scores.
            send({ type: 'roundSeen' });
          }}
        >
          <RoundTable
            result={newRound}
            teams={view.teams}
            names={names}
            bidLabels={view.bidLabels}
            trackLabels={view.trackLabels}
          />
        </Dialog>
      )}
      {showRules && <RulesDialog table={table} onClose={() => setShowRules(false)} />}
      {showHistory && !newRound && (
        <Dialog title="Every round" onClose={() => setShowHistory(false)}>
          <HistoryTable history={view.history} teams={view.teams} names={names} />
        </Dialog>
      )}
    </div>
  );
}
