export function About() {
  return (
    <div className="page narrow prose">
      <h1>About Card Table</h1>
      <p>
        Turn-based card games for points, played with standard 52-card decks. Nothing here has cash
        value.
      </p>

      <h2>Playing with a keyboard</h2>
      <ul>
        <li>
          <kbd>Tab</kbd> moves between the players, the piles, your hand and the action buttons.
        </li>
        <li>
          In your hand, <kbd>←</kbd> and <kbd>→</kbd> move between cards (<kbd>Home</kbd> and{' '}
          <kbd>End</kbd> jump to the ends).
        </li>
        <li>
          <kbd>Enter</kbd> or <kbd>Space</kbd> selects a card; pressing it again plays it when
          that's the only thing it can do. Otherwise use the buttons below your hand.
        </li>
        <li>
          <kbd>Esc</kbd> clears your selection.
        </li>
      </ul>

      <h2>Credits</h2>
      <p>
        Card faces: “English pattern playing cards” by Dmitry Fomin, from{' '}
        <a href="https://commons.wikimedia.org/wiki/Category:SVG_English_pattern_playing_cards">
          Wikimedia Commons
        </a>
        , dedicated to the public domain under{' '}
        <a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0</a>. The card back and
        the jokers are our own.
      </p>
    </div>
  );
}
