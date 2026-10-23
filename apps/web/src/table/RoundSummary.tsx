/**
 * The end of a round: one card per team in its colour, with its bid against the
 * tricks it took, Made or Set, where its points came from, the round's points
 * counting into the total and its progress toward the target, then a highlight
 * or two. Everything drawn is also written in words for screen readers.
 */
import type { PlayerView, RoundResult } from '@card-table/engine';
import { CountUp } from './CountUp';
import { type SeatInitials, teamColour } from './avatars';
import { bidWords, type SeatNames, teamName } from './describe';
import { highlights, leaders, partsText, progress, signed, teamBid, tracksText } from './summary';
import { TeamAvatars } from './Scores';
import { SuitText } from './SuitText';

type View = Pick<PlayerView, 'teams' | 'goal' | 'moments' | 'bidLabels' | 'trackLabels'>;

export function RoundSummary({
  result,
  view,
  names,
  initials,
  onShowHands,
}: {
  result: RoundResult;
  view: View;
  names: SeatNames;
  initials: SeatInitials;
  /** Opens the round played back with every hand face up. */
  onShowHands?: () => void;
}) {
  const showTricks = result.players.some((p) => p.tricks > 0);
  const lead = leaders(result.teams, view.goal.winner);
  const notes = highlights(result, view.moments, view.teams, names);
  return (
    <>
      <ul className="round-summary" aria-label={`Round ${result.round} results`}>
        {result.teams.map((team) => {
          const members = view.teams.find((t) => t.id === team.id)?.players ?? [];
          const players = result.players.filter((p) => members.includes(p.id));
          const bid = teamBid(result, members, view.bidLabels);
          const parts = partsText(team.parts);
          const tracks = tracksText({ ...team.tracks, ...team.held }, view.trackLabels);
          const leading = lead.includes(team.id);
          const out = players.filter((p) => p.eliminated).map((p) => names(p.id));
          return (
            <li
              key={team.id}
              className={`summary-team${leading ? ' leading' : ''}`}
              style={{ ['--team' as string]: teamColour(team.id) }}
            >
              <div className="summary-head">
                <TeamAvatars team={{ id: team.id, players: members }} initials={initials} />
                <h3 className="summary-name">
                  {teamName({ id: team.id, players: members }, names)}
                  {leading && (
                    <>
                      <span className="crown" aria-hidden="true">
                        ♛
                      </span>
                      <span className="visually-hidden"> (leading)</span>
                    </>
                  )}
                </h3>
                {team.made !== null && (
                  <span className={`made-badge ${team.made ? 'made' : 'set'}`}>
                    {team.made ? 'Made' : 'Set'}
                  </span>
                )}
              </div>

              {bid !== null ? (
                <TrickDots bid={bid} tricks={team.tricks} />
              ) : (
                showTricks && (
                  <p className="summary-line">
                    Took {team.tricks} trick{team.tricks === 1 ? '' : 's'}
                  </p>
                )
              )}
              {/* Who bid what, where partners' bids differ in kind (nil) or have words (1♣). */}
              {members.length > 1 && players.some((p) => p.bid !== null) && (
                <p className="summary-line muted">
                  <SuitText
                    text={`Bids: ${players
                      .map(
                        (p) =>
                          `${names(p.id)} ${p.bid === null ? '–' : bidWords(p.bid, view.bidLabels)}`,
                      )
                      .join(', ')}`}
                  />
                </p>
              )}
              {parts && (
                <p className="summary-line summary-parts">
                  <SuitText text={parts} />
                </p>
              )}

              <p className="summary-score">
                <span className="summary-points">
                  {signed(team.points)}
                  <span className="visually-hidden"> this round,</span>
                </span>
                <span className="summary-total-label">total</span>
                <CountUp
                  value={team.score}
                  from={team.score - team.points}
                  className="summary-total"
                />
              </p>
              {tracks && <p className="summary-line muted">{tracks}</p>}
              {out.length > 0 && <p className="summary-line muted">{out.join(', ')}: out</p>}
              {view.goal.target !== null && (
                <GoalBar
                  score={team.score}
                  before={team.score - team.points}
                  target={view.goal.target}
                  lowWins={view.goal.winner === 'lowestScore'}
                />
              )}
            </li>
          );
        })}
      </ul>
      {notes.length > 0 && (
        <ul className="round-highlights" aria-label="Highlights">
          {notes.map((note) => (
            <li key={note}>
              <span className="highlight-star" aria-hidden="true">
                ★
              </span>{' '}
              <SuitText text={note} />
            </li>
          ))}
        </ul>
      )}
      {onShowHands && (
        <p className="summary-actions">
          <button type="button" className="small" onClick={onShowHands}>
            Show all hands
          </button>
        </p>
      )}
    </>
  );
}

/** The bid as hollow dots, filled for each trick taken; tricks past the bid are extra dots. */
function TrickDots({ bid, tricks }: { bid: number; tricks: number }) {
  const count = Math.max(bid, tricks);
  return (
    <p className="summary-line trick-dots">
      {count > 0 && (
        <span className="dots" aria-hidden="true">
          {Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              className={`dot${i < tricks ? ' taken' : ''}${i < bid ? '' : ' extra'}`}
            />
          ))}
        </span>
      )}
      <span>
        Bid {bid} · took {tricks}
      </span>
    </p>
  );
}

/** Progress toward the target, from where the team was before this round. */
function GoalBar({
  score,
  before,
  target,
  lowWins,
}: {
  score: number;
  before: number;
  target: number;
  lowWins: boolean;
}) {
  const percent = (n: number) => `${Math.round(progress(n, target) * 100)}%`;
  return (
    <div className="goal-bar">
      <span className="goal-track" aria-hidden="true">
        <span
          className="goal-fill"
          style={{ ['--from' as string]: percent(before), ['--to' as string]: percent(score) }}
        />
      </span>
      <span className="goal-text">
        {lowWins
          ? `game ends at ${target}`
          : score >= target
            ? `reached ${target}`
            : `${target - score} to go`}
      </span>
    </div>
  );
}
