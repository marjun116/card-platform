/**
 * "Show all hands": a finished round played back move by move with every
 * player's cards face up. The server sends a round only once it's over.
 * Moves are stepped through with buttons or played at a steady pace; with
 * "reduce motion" the frames simply change, as there's no motion in them.
 */
import type { PlayerView, RoundReplay } from '@card-table/engine';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLoad } from '../useLoad';
import { Avatar } from './Avatar';
import { type SeatInitials, teamColour } from './avatars';
import { bidWords, moveLine, type SeatNames, teamName } from './describe';
import { replayZones, shownTrick } from './replay';
import { Dialog } from './Scores';
import { RichLine } from './SuitText';
import { Trick, ZoneDisplay } from './ZoneViews';

/** Time between moves while playing, in ms. */
const STEP_MS = 1100;

export function ReplayDialog({
  code,
  round,
  view,
  names,
  initials,
  onClose,
}: {
  code: string;
  round: number;
  view: PlayerView;
  names: SeatNames;
  initials: SeatInitials;
  onClose: () => void;
}) {
  const loaded = useLoad(() => api.roundReplay(code, round), `${code}:${round}`);
  return (
    <Dialog title={`Round ${round}: all hands`} onClose={onClose} closeLabel="Close">
      {loaded.state === 'loading' && <p className="muted">Loading the round…</p>}
      {loaded.state === 'error' && (
        <p role="alert" className="error">
          {loaded.message}
        </p>
      )}
      {loaded.state === 'done' && (
        <ReplayPlayer replay={loaded.data} view={view} names={names} initials={initials} />
      )}
    </Dialog>
  );
}

export function ReplayPlayer({
  replay,
  view,
  names,
  initials,
}: {
  replay: RoundReplay;
  view: PlayerView;
  names: SeatNames;
  initials: SeatInitials;
}) {
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = replay.frames.length - 1;
  // Playing stops by itself at the end of the round.
  const running = playing && at < last;
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setAt((i) => Math.min(i + 1, last)), STEP_MS);
    return () => clearTimeout(timer);
  }, [running, at, last]);

  const frame = replay.frames[at];
  if (!frame) return null;
  const move = at > 0 ? (replay.moves[at - 1] ?? null) : null;
  const zones = replayZones(frame, replay.trickZones, view.sortSuits);
  const trick = shownTrick(frame, move);
  const showTricks = replay.trickZones.length > 0;
  const go = (i: number) => {
    setPlaying(false);
    setAt(Math.max(0, Math.min(last, i)));
  };

  return (
    <div className="replay">
      <p className="replay-caption" aria-live="polite">
        <span className="replay-count">{at === 0 ? 'The deal' : `Move ${at} of ${last}`}</span>{' '}
        {move ? (
          <RichLine line={moveLine(move, names, view.choiceLabels, view.bidLabels)} />
        ) : (
          `${names(replay.dealer)} dealt.`
        )}
      </p>

      <div className="replay-controls" role="group" aria-label="Play back the round">
        <button type="button" className="small" onClick={() => go(0)} disabled={at === 0}>
          <span aria-hidden="true">⏮</span> Start
        </button>
        <button type="button" className="small" onClick={() => go(at - 1)} disabled={at === 0}>
          <span aria-hidden="true">◀</span> Back
        </button>
        <button
          type="button"
          className="small primary"
          onClick={() => {
            if (running) {
              setPlaying(false);
            } else {
              // Played to the end: play it again from the deal.
              if (at >= last) setAt(0);
              setPlaying(true);
            }
          }}
        >
          {running ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="small" onClick={() => go(at + 1)} disabled={at === last}>
          Forward <span aria-hidden="true">▶</span>
        </button>
        <button type="button" className="small" onClick={() => go(last)} disabled={at === last}>
          End <span aria-hidden="true">⏭</span>
        </button>
      </div>

      {zones.piles.length > 0 && (
        <div className="replay-piles">
          {zones.piles.map((zone) => (
            <ZoneDisplay key={zone.key} zone={zone} size="tiny" />
          ))}
        </div>
      )}
      {trick && (
        <div className="replay-trick">
          <Trick trick={trick} view={view} names={names} label="The trick" />
        </div>
      )}

      <ul className="replay-seats">
        {view.players.map((player) => {
          const now = frame.players[player.id];
          const stats = [
            now?.bid != null ? `bid ${bidWords(now.bid, view.bidLabels)}` : null,
            showTricks ? `won ${now?.tricks ?? 0}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li
              key={player.id}
              className="replay-seat"
              style={{ ['--team' as string]: teamColour(player.team) }}
            >
              <div className="replay-who">
                <Avatar initials={initials(player.id)} team={player.team} size="small" />
                <strong>{names(player.id)}</strong>
                {stats && <span className="muted">{stats}</span>}
              </div>
              {(zones.seats.get(player.id) ?? []).map((zone) => (
                <ZoneDisplay key={zone.key} zone={zone} size="tiny" />
              ))}
            </li>
          );
        })}
      </ul>

      {[...zones.teams].map(([id, list]) => {
        const team = view.teams.find((t) => t.id === id);
        return (
          <div key={id} className="replay-team" style={{ ['--team' as string]: teamColour(id) }}>
            <strong>{team ? teamName(team, names) : `Team ${id + 1}`}</strong>
            {list.map((zone) => (
              <ZoneDisplay key={zone.key} zone={zone} size="tiny" compact />
            ))}
          </div>
        );
      })}
    </div>
  );
}
