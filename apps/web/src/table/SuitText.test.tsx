import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { lineText, moveLine, type SeatNames } from './describe';
import { RichLine, SuitText } from './SuitText';

afterEach(cleanup);

const names: SeatNames = (seat) => ['Ana', 'Raj'][seat] ?? `Seat ${seat + 1}`;

describe('SuitText', () => {
  it('colours every suit symbol in text and keeps the text as it is', () => {
    const { container } = render(
      <p>
        <SuitText text="1♣ then 3♥" />
      </p>,
    );
    expect(container.textContent).toBe('1♣ then 3♥');
    expect(screen.getByText('♣').className).toBe('suit-pip black');
    expect(screen.getByText('♥').className).toBe('suit-pip red');
  });

  it('leaves text without suits alone', () => {
    const { container } = render(
      <p>
        <SuitText text="Nil" />
      </p>,
    );
    expect(container.innerHTML).toBe('<p>Nil</p>');
  });
});

describe('log lines in pieces', () => {
  it('names cards and suits as parts, and in words as plain text', () => {
    const played = moveLine({ player: 1, type: 'playToTrick', card: 'QS.0' }, names);
    expect(played).toEqual(['Raj played ', { card: 'QS.0' }]);
    expect(lineText(played)).toBe('Raj played Queen of spades');
    const trump = moveLine({ player: 0, type: 'declareTrump', suit: 'hearts' }, names);
    expect(trump).toEqual(['Ana made ', { suit: 'hearts' }, ' trump']);
    expect(lineText(trump)).toBe('Ana made hearts trump');
    const meld = moveLine({ player: 0, type: 'meld', cards: ['5H.0', '5S.0'] }, names);
    expect(lineText(meld)).toBe('Ana melded 5 of hearts, 5 of spades');
  });

  it('draws cards small, named in full for screen readers, and suits by symbol and name', () => {
    const { container } = render(
      <p>
        <RichLine line={moveLine({ player: 0, type: 'meld', cards: ['5H.0', 'JOKER.1'] }, names)} />{' '}
        <RichLine line={moveLine({ player: 1, type: 'chooseSuit', suit: 'spades' }, names)} />
      </p>,
    );
    expect(container.textContent).toBe('Ana melded 5♥, Joker Raj chose ♠ spades');
    const five = screen.getByRole('img', { name: '5 of hearts' });
    expect(five.className).toBe('inline-card red');
    expect(screen.getByRole('img', { name: 'Joker' })).toBeTruthy();
    expect(screen.getByText('♠').getAttribute('aria-hidden')).toBe('true');
  });
});
