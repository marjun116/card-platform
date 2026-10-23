/**
 * Buttons for the moves you can make right now, built only from the legal
 * moves the server sent. They come in two places:
 *
 * - DecisionPanel, in the middle of the table: decisions that don't use a
 *   card from your hand (bids, suits, drawing from a pile, pass, end turn).
 * - HandActions, under your hand: what the cards you've selected can do.
 */
import type { Move } from '@card-table/engine';
import { useState } from 'react';
import { isRed, SUIT_SYMBOL, suitName } from './cards';
import { type BidLabels, bidLabel, type ChoiceLabels, moveLabel, type SeatNames } from './describe';
import type { Arrangement } from './Hand';
import { SuitText } from './SuitText';
import { type Controls, groupHint, hasDecisions, movesForSelection, regroup } from './moves';

interface ButtonProps {
  names: SeatNames;
  choices?: ChoiceLabels;
  bidLabels?: BidLabels;
  busy: boolean;
  onMove: (move: Move) => void;
}

function moveButton(
  move: Move,
  { names, choices, bidLabels, busy, onMove }: ButtonProps,
  label = moveLabel(move, names, choices, bidLabels),
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
      <SuitText text={label} />
    </button>
  );
}

/**
 * More numeric bids than this (an auction from 20 to 60, say), and the higher
 * ones go in a list instead of a button each. Spades (1–13) and Oh Hell (0–13)
 * keep a button per bid.
 */
const MANY_BIDS = 14;
const BID_BUTTONS = 6;

/**
 * A wide range of bids (an auction from 20 to 60, say): the lowest few as
 * buttons, the rest in a list with a Bid button. Other bids (pass, nil)
 * stay as buttons.
 */
function BidPicker({ bids, ...props }: ButtonProps & { bids: Controls['bids'] }) {
  const numbers = bids.filter(({ value }) => typeof value === 'number');
  const named = bids.filter(({ value }) => typeof value !== 'number');
  const buttons = [...numbers.slice(0, BID_BUTTONS), ...named];
  const rest = numbers.slice(BID_BUTTONS);
  const [picked, setPicked] = useState(0);
  const chosen = rest[picked] ?? rest[0];
  return (
    <>
      {buttons.map(({ value, move }) => moveButton(move, props, bidLabel(value, props.bidLabels)))}
      <span className="bid-picker">
        <select
          aria-label="Higher bid"
          value={picked}
          onChange={(e) => setPicked(Number(e.target.value))}
        >
          {rest.map(({ value }, i) => (
            <option key={String(value)} value={i}>
              {bidLabel(value, props.bidLabels)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={props.busy || !chosen}
          onClick={() => chosen && props.onMove(chosen.move)}
        >
          Bid {chosen ? bidLabel(chosen.value, props.bidLabels) : ''}
        </button>
      </span>
    </>
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
          {controls.bids.filter(({ value }) => typeof value === 'number').length > MANY_BIDS ? (
            <BidPicker bids={controls.bids} {...props} />
          ) : (
            controls.bids.map(({ value, move }) =>
              moveButton(move, props, bidLabel(value, props.bidLabels)),
            )
          )}
        </fieldset>
      )}

      {controls.suits.length > 0 && (
        <fieldset className="choice-grid suit-tiles">
          <legend>
            {controls.suits[0]?.move.type === 'declareTrump' ? 'Choose trump' : 'Choose a suit'}
          </legend>
          {/* A large tile per suit: the symbol in its colour, and the suit's name written out. */}
          {controls.suits.map(({ suit, move }) => (
            <button
              key={suit}
              type="button"
              className="suit-tile"
              disabled={props.busy}
              onClick={() => props.onMove(move)}
            >
              <span
                className={`suit-tile-symbol ${isRed(suit) ? 'red' : 'black'}`}
                aria-hidden="true"
              >
                {SUIT_SYMBOL[suit]}
              </span>
              <span className="suit-tile-name">{suitName(suit)}</span>
            </button>
          ))}
        </fieldset>
      )}

      {controls.choices.length > 0 && (
        <fieldset className="choice-grid">
          <legend>Your choice</legend>
          {controls.choices.map((move) => moveButton(move, props))}
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
  arrangement = null,
  passTo = null,
  ...props
}: ButtonProps & {
  controls: Controls;
  selected: readonly string[];
  onClear: () => void;
  arrangement?: Arrangement;
  /** Who the cards you pass go to, so the hint and button can say so. */
  passTo?: number | null;
}) {
  const to = passTo === null ? '' : ` to ${props.names(passTo)}`;
  const grouped = new Set(arrangement?.groups.flatMap((g) => g.cards) ?? []);
  const arrange = (action: 'group' | 'ungroup') =>
    arrangement &&
    // The server fills in your seat.
    props.onMove({ player: -1, type: 'arrange', groups: regroup(arrangement, selected, action) });
  const forSelection = movesForSelection(controls, selected);
  const hints = groupHint(controls);
  const hint =
    hints && forSelection.length === 0
      ? `${hints
          .map(
            ({ type, sizes }) =>
              `Choose ${sizes.join(' or ')} cards to ${
                type === 'pass' ? `pass${to}` : type === 'meld' ? 'meld' : 'take the pile with'
              }`,
          )
          .join('; ')}${selected.length > 0 ? ` (${selected.length} chosen)` : ''}.`
      : null;
  const empty = !hint && forSelection.length === 0 && selected.length === 0 && !controls.sort;

  // Always rendered at the same height, even when empty, so selecting or clearing
  // cards never moves anything else on the screen (which made the page jump).
  return (
    <div className="action-bar" role="group" aria-label="Moves with your cards">
      {!empty && (
        <div className="action-row fade-in" key={selected.join(',')}>
          {hint && <span className="hint">{hint}</span>}
          {forSelection.map((move) =>
            moveButton(
              move,
              props,
              move.type === 'pass' ? `${moveLabel(move, props.names)}${to}` : undefined,
              'primary',
            ),
          )}
          {arrangement && selected.length >= 2 && (
            <button type="button" disabled={props.busy} onClick={() => arrange('group')}>
              Group
            </button>
          )}
          {arrangement && selected.some((id) => grouped.has(id)) && (
            <button type="button" disabled={props.busy} onClick={() => arrange('ungroup')}>
              Ungroup
            </button>
          )}
          {controls.sort && selected.length === 0 && moveButton(controls.sort, props)}
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
