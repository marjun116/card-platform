/**
 * Buttons for every move you can make right now, built only from the legal
 * moves the server sent. Card moves show up once you select cards.
 */
import type { Move } from '@card-table/engine';
import { suitClass } from './cards';
import { bidLabel, moveLabel, type SeatNames } from './describe';
import { type Controls, groupHint, movesForSelection } from './moves';
import { useSettings } from '../useSettings';

export function ActionBar({
  controls,
  selected,
  names,
  busy,
  onMove,
  onClear,
}: {
  controls: Controls;
  selected: readonly string[];
  names: SeatNames;
  busy: boolean;
  onMove: (move: Move) => void;
  onClear: () => void;
}) {
  const { settings } = useSettings();
  if (!controls.any) return null;

  const forSelection = movesForSelection(controls, selected);
  const hints = groupHint(controls);
  const pileMoves = [...controls.byPile.values()].flat();
  const button = (move: Move, label = moveLabel(move, names), className?: string) => (
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

  return (
    <div className="action-bar" role="group" aria-label="Your moves">
      {hints && forSelection.length === 0 && (
        <p className="hint">
          {hints
            .map(
              ({ type, sizes }) =>
                `Choose ${sizes.join(' or ')} cards to ${type === 'pass' ? 'pass' : 'meld'}`,
            )
            .join('; ')}
          {selected.length > 0 && ` (${selected.length} chosen)`}.
        </p>
      )}

      {forSelection.length > 0 && (
        <div className="action-row">
          {forSelection.map((move) => button(move, undefined, 'primary'))}
        </div>
      )}

      {controls.bids.length > 0 && (
        <fieldset className="choice-grid">
          <legend>Your bid</legend>
          {controls.bids.map(({ value, move }) => button(move, bidLabel(value)))}
        </fieldset>
      )}

      {controls.suits.length > 0 && (
        <fieldset className="choice-grid">
          <legend>
            {controls.suits[0]?.move.type === 'declareTrump' ? 'Choose trump' : 'Choose a suit'}
          </legend>
          {controls.suits.map(({ suit, move }) =>
            button(
              move,
              undefined,
              // The symbol is coloured; the name is always written out too.
              `suit-button ${suitClass(suit, settings.fourColor)}`,
            ),
          )}
        </fieldset>
      )}

      {(pileMoves.length > 0 || controls.other.length > 0 || selected.length > 0) && (
        <div className="action-row">
          {pileMoves.map((move) => button(move))}
          {controls.other.map((move) => button(move))}
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
