/**
 * Buttons for the moves you can make right now, built only from the legal
 * moves the server sent. They come in two places:
 *
 * - DecisionPanel, in the middle of the table: decisions that don't use a
 *   card from your hand (bids, suits, drawing from a pile, pass, end turn).
 * - HandActions, under your hand: what the cards you've selected can do.
 */
import type { Move } from '@card-table/engine';
import { isRed } from './cards';
import { bidLabel, moveLabel, type SeatNames } from './describe';
import { type Controls, groupHint, hasDecisions, movesForSelection } from './moves';

interface ButtonProps {
  names: SeatNames;
  busy: boolean;
  onMove: (move: Move) => void;
}

function moveButton(
  move: Move,
  { names, busy, onMove }: ButtonProps,
  label = moveLabel(move, names),
  className?: string,
) {
  return (
    <button
      key={JSON.stringify(move)}
      type="button"
      className={className}
      disabled={busy}
      onClick={() => onMove(move)}
    >
      {label}
    </button>
  );
}

export function DecisionPanel({ controls, ...props }: ButtonProps & { controls: Controls }) {
  if (!hasDecisions(controls)) return null;
  const pileMoves = [...controls.byPile.values()].flat();
  return (
    <div className="decision-panel" role="group" aria-label="Your decision">
      {controls.bids.length > 0 && (
        <fieldset className="choice-grid">
          <legend>Your bid</legend>
          {controls.bids.map(({ value, move }) => moveButton(move, props, bidLabel(value)))}
        </fieldset>
      )}

      {controls.suits.length > 0 && (
        <fieldset className="choice-grid">
          <legend>
            {controls.suits[0]?.move.type === 'declareTrump' ? 'Choose trump' : 'Choose a suit'}
          </legend>
          {controls.suits.map(({ suit, move }) =>
            // The symbol is coloured, and the suit's name is always written out too.
            moveButton(move, props, undefined, `suit-button ${isRed(suit) ? 'red' : 'black'}`),
          )}
        </fieldset>
      )}

      {(pileMoves.length > 0 || controls.other.length > 0) && (
        <div className="action-row">
          {pileMoves.map((move) => moveButton(move, props))}
          {controls.other.map((move) => moveButton(move, props))}
        </div>
      )}
    </div>
  );
}

export function HandActions({
  controls,
  selected,
  onClear,
  ...props
}: ButtonProps & {
  controls: Controls;
  selected: readonly string[];
  onClear: () => void;
}) {
  const forSelection = movesForSelection(controls, selected);
  const hints = groupHint(controls);
  const hint =
    hints && forSelection.length === 0
      ? `${hints
          .map(
            ({ type, sizes }) =>
              `Choose ${sizes.join(' or ')} cards to ${type === 'pass' ? 'pass' : 'meld'}`,
          )
          .join('; ')}${selected.length > 0 ? ` (${selected.length} chosen)` : ''}.`
      : null;
  const empty = !hint && forSelection.length === 0 && selected.length === 0;

  // Always rendered at the same height, even when empty, so selecting or clearing
  // cards never moves anything else on the screen (which made the page jump).
  return (
    <div className="action-bar" role="group" aria-label="Moves with your cards">
      {!empty && (
        <div className="action-row fade-in" key={selected.join(',')}>
          {hint && <span className="hint">{hint}</span>}
          {forSelection.map((move) => moveButton(move, props, undefined, 'primary'))}
          {selected.length > 0 && (
            <button type="button" className="link-button" onClick={onClear}>
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}
