/** The scoreboard, round summaries and the history of every round. */
import type { BidValue, PlayerView, RoundResult } from '@card-table/engine';
import { type ReactNode, useEffect, useRef } from 'react';
import { type BidLabels, bidWords, type SeatNames, teamName } from './describe';
import { ZoneDisplay } from './ZoneViews';
import { humanize, type PlacedZone, zoneCount } from './zones';

type Team = PlayerView['teams'][number];

/** Words for tracked counters (`view.trackLabels`); null hides a counter. */
export type TrackLabels = Record<string, string | null>;

function tracksText(tracks: Record<string, number>, labels: TrackLabels = {}): string {
  return Object.entries(tracks)
    .filter(([name]) => labels[name] !== null)
    .map(([name, value]) => `${labels[name] ?? humanize(name)} ${value}`)
    .join(' · ');
}

function bidText(bid: BidValue | null, labels: BidLabels = {}): string {
  return bid === null ? '–' : bidWords(bid, labels);
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** Current scores, and this round's bids and tricks so far. */
export function Scoreboard({
  view,
  names,
  teamZones,
  showTricks,
}: {
  view: PlayerView;
  names: SeatNames;
  teamZones: Map<number, PlacedZone[]>;
  showTricks: boolean;
}) {
  const showBids = view.players.some((p) => p.bid !== null);
  return (
    <section className="scoreboard" aria-label="Scores">
      <h2>Scores</h2>
      <ul>
        {view.teams.map((team) => {
          const mine = team.players.includes(view.you);
          const tracks = tracksText({ ...team.tracks, ...team.held }, view.trackLabels);
          return (
            <li key={team.id} className={mine ? 'mine' : undefined}>
              <div className="team-row">
                <span className="team-name">{teamName(team, names)}</span>
                <span className="team-score">{team.score}</span>
              </div>
              {tracks && <div className="muted">{tracks}</div>}
              {/* One-player teams already show their name; their bid and tricks fit on one line. */}
              {(showBids || showTricks) && team.players.length === 1 && (
                <div className="muted">
                  {[
                    showBids
                      ? `bid ${bidText(view.players[team.players[0] ?? 0]?.bid ?? null, view.bidLabels)}`
                      : null,
                    showTricks ? `won ${view.players[team.players[0] ?? 0]?.tricks ?? 0}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              )}
              {(showBids || showTricks) && team.players.length > 1 && (
                <ul className="team-players">
                  {team.players.map((seat) => {
                    const player = view.players[seat];
                    if (!player) return null;
                    return (
                      <li key={seat}>
                        <span>{names(seat)}</span>
                        {showBids && <span>bid {bidText(player.bid, view.bidLabels)}</span>}
                        {showTricks && <span>won {player.tricks}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {(teamZones.get(team.id) ?? []).map((zone) => {
                const count = zoneCount(zone.view);
                // Cards a team can see are drawn; piles it can't are just a count.
                return zone.view.kind === 'cards' || zone.view.kind === 'melds' ? (
                  <ZoneDisplay key={zone.key} zone={zone} />
                ) : count === null ? null : (
                  <div key={zone.key} className="muted">
                    {humanize(zone.name)} pile: {count} card{count === 1 ? '' : 's'}
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** One finished round: what each team bid, took and scored. */
export function RoundTable({
  result,
  teams,
  names,
  bidLabels = {},
  trackLabels = {},
}: {
  result: RoundResult;
  /** Who is on which team (teams never change during a game). */
  teams: Pick<Team, 'id' | 'players'>[];
  names: SeatNames;
  bidLabels?: BidLabels;
  trackLabels?: TrackLabels;
}) {
  const showBids = result.players.some((p) => p.bid !== null);
  const showTricks = result.players.some((p) => p.tricks > 0);
  return (
    <table className="round-table">
      <caption className="visually-hidden">Round {result.round} results</caption>
      <thead>
        <tr>
          <th scope="col">Player</th>
          {showBids && <th scope="col">Bid</th>}
          {showTricks && <th scope="col">Won</th>}
          <th scope="col">Points</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      {result.teams.map((team) => {
        const members = teams.find((t) => t.id === team.id)?.players ?? [];
        const players = result.players.filter((p) => members.includes(p.id));
        const tracks = tracksText({ ...team.tracks, ...team.held }, trackLabels);
        return (
          <tbody key={team.id}>
            {players.map((player, i) => (
              <tr key={player.id}>
                <th scope="row">
                  {names(player.id)}
                  {player.eliminated && <span className="muted"> (out)</span>}
                </th>
                {showBids && <td>{bidText(player.bid, bidLabels)}</td>}
                {showTricks && <td>{player.tricks}</td>}
                {i === 0 && (
                  <>
                    <td rowSpan={players.length} className="points">
                      {signed(team.points)}
                    </td>
                    <td rowSpan={players.length} className="total">
                      {team.score}
                      {tracks && <div className="muted">{tracks}</div>}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        );
      })}
    </table>
  );
}

/** All rounds so far, with each team's running total. */
export function HistoryTable({
  history,
  teams,
  names,
}: {
  history: RoundResult[];
  teams: Pick<Team, 'id' | 'players'>[];
  names: SeatNames;
}) {
  if (history.length === 0) return <p className="muted">No rounds finished yet.</p>;
  return (
    <table className="history-table">
      <caption className="visually-hidden">Scores after each round</caption>
      <thead>
        <tr>
          <th scope="col">Round</th>
          {teams.map((team) => (
            <th scope="col" key={team.id}>
              {teamName(team, names)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {history.map((result) => (
          <tr key={result.round}>
            <th scope="row">{result.round}</th>
            {result.teams.map((team) => (
              <td key={team.id}>
                {team.score} <span className="muted">({signed(team.points)})</span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A modal dialog using the browser's own <dialog>, which traps focus and closes on Esc. */
export function Dialog({
  title,
  onClose,
  children,
  closeLabel = 'Continue',
  startAtTop = false,
  closeOnOutsideClick = false,
  extraAction,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
  /** Focus the title rather than the button, so long content opens at its start. */
  startAtTop?: boolean;
  /** A click on the darkened page around the dialog closes it too. */
  closeOnOutsideClick?: boolean;
  /** A second button beside the close button, which doesn't close the dialog itself. */
  extraAction?: { label: string; onSelect: () => void };
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Set while the page takes the dialog away, so that isn't taken for the player closing it.
  const removing = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    removing.current = false;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    if (startAtTop) titleRef.current?.focus();
    return () => {
      removing.current = true;
      if (typeof dialog.close === 'function') dialog.close();
    };
  }, [startAtTop]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      // The close event arrives after the fact; ignore it if the dialog was opened again
      // meanwhile (React mounts components twice in development).
      onClose={() => {
        if (!removing.current && !ref.current?.open) onClose();
      }}
      // A click on the backdrop is reported as a click on the dialog itself, as is one on
      // its padding, so only a click outside the dialog's box counts.
      onClick={(event) => {
        const dialog = ref.current;
        if (!closeOnOutsideClick || !dialog || event.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        const outside =
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom;
        if (!outside) return;
        if (typeof dialog.close === 'function') dialog.close();
        else onClose();
      }}
    >
      <h2 id="dialog-title" ref={titleRef} tabIndex={startAtTop ? -1 : undefined}>
        {title}
      </h2>
      {children}
      <form method="dialog" className="dialog-actions">
        {extraAction && (
          <button type="button" onClick={extraAction.onSelect}>
            {extraAction.label}
          </button>
        )}
        <button type="submit" className="primary" autoFocus={!startAtTop}>
          {closeLabel}
        </button>
      </form>
    </dialog>
  );
}
