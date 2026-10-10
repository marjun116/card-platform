/**
 * Scenario tests for bridge.json: the rules a real table would check.
 * Seats: the dealer D (first to call), then L (left of the dealer), P (the
 * dealer's partner) and R. Partners sit opposite, so team = seat % 2.
 *
 * Auctions are played with real moves. Scoring tests then jump to the last
 * trick with the declarer's side holding a chosen number of tricks.
 */
import {
  applyMove,
  createGame,
  type GameState,
  getLegalMoves,
  type Move,
  type OptionValue,
  playersToAct,
  viewFor,
} from '@card-table/engine';
import { draft, findHiddenCardLeak, id, withZones } from '@card-table/engine/testing';
import { describe, expect, it } from 'vitest';
import { builtInGames } from './index';

const bridge = builtInGames.bridge;
type Options = Record<string, OptionValue>;
type Call = number | 'pass' | 'double' | 'redouble';

const PHASES = bridge.phases.map((p) => p.name);
const phase = (state: GameState) => PHASES[state.cursor.phase];

/** A fresh game; `tracks` sets each team's counters first (games won, part scores…). */
function start(options: Options = {}, tracks: Record<string, number>[] = []) {
  const state = draft(createGame(bridge, options, 4, 'bridge'));
  tracks.forEach((t, team) => Object.assign((state.teams[team] as { tracks: object }).tracks, t));
  const D = state.dealer;
  return { state, D, L: (D + 1) % 4, P: (D + 2) % 4, R: (D + 3) % 4 };
}

/** Makes these calls in turn, starting with whoever is due to call. */
function calls(state: GameState, ...list: Call[]): GameState {
  for (const call of list) {
    const player = state.cursor.current;
    const move: Move =
      call === 'pass' ? { player, type: 'passBid' } : { player, type: 'bid', value: call };
    state = applyMove(state, move);
  }
  return state;
}

const callsOffered = (state: GameState, seat: number) =>
  getLegalMoves(state, seat).flatMap((m) =>
    m.type === 'bid' ? [m.value] : m.type === 'passBid' ? ['pass'] : [],
  );

/** Plays the first legal move of whoever is due, until `done` holds. */
function playUntil(state: GameState, done: (s: GameState) => boolean): GameState {
  for (let guard = 0; !done(state); guard++) {
    if (guard > 200) throw new Error('playUntil went on too long');
    const [actor] = playersToAct(state);
    state = applyMove(state, getLegalMoves(state, actor as number)[0] as Move);
  }
  return state;
}

/**
 * From the start of play: jumps to the 13th trick with the declarer's side
 * holding `declTricks`, plays it (won by the declarer's side if `declWins`) and
 * scores the hand. `playerVars` sets values such as honors held.
 */
function lastTrick(
  state: GameState,
  declTricks: number,
  declWins: boolean,
  playerVars: Record<number, Record<string, number>> = {},
): GameState {
  const declarer = state.vars.declarer as number;
  const winner = declWins ? declarer : (declarer + 1) % 4;
  const small = ['2C', '3C', '4C'];
  const zones: Record<string, string[]> = {};
  for (let seat = 0; seat < 4; seat++) {
    zones[`hand@${seat}`] = [seat === winner ? 'AC' : (small.pop() as string)];
  }
  const next = draft(withZones(state, zones, 'won@t0'));
  next.cursor.tricks = 12;
  (next.trick as { number: number }).number = 13;
  next.vars.declTricks = declTricks;
  for (const [seat, vars] of Object.entries(playerVars)) {
    Object.assign((next.players[Number(seat)] as { vars: object }).vars, vars);
  }
  const round = next.round;
  return playUntil(next, (s) => s.round !== round || s.status === 'over');
}

/** Points each team scored in the hand just played. */
const points = (state: GameState) => state.history.at(-1)?.teams.map((t) => t.points);
const tracks = (state: GameState, team: number) => state.teams[team]?.tracks ?? {};

// Contracts: level × 10 + suit (1 ♣, 2 ♦, 3 ♥, 4 ♠, 5 NT).
const C1 = 11;
const H2 = 23;
const S2 = 24;
const H4 = 43;
const S4 = 44;
const NT3 = 35;
const S6 = 64;
const NT7 = 75;

describe('the auction', () => {
  it('starts with the dealer, who may bid anything from 1♣ to 7NT or pass', () => {
    const { state, D } = start();
    expect(playersToAct(state)).toEqual([D]);
    const offered = callsOffered(state, D);
    expect(offered).toHaveLength(36);
    expect(offered).toContain('pass');
    expect(offered).not.toContain('double');
    expect(viewFor(state, D).bidLabels).toMatchObject({ '11': '1♣', '35': '3NT', '75': '7NT' });
  });

  it('only offers bids higher than the last', () => {
    const { state, L } = start();
    const s = calls(state, H2);
    const bids = callsOffered(s, L).filter((c) => typeof c === 'number');
    expect(Math.min(...bids)).toBe(S2);
    expect(bids).toHaveLength(35 - 8);
    expect(() => calls(s, H2)).toThrow();
  });

  it('lets an opponent double, but not a partner', () => {
    const { state, L, P } = start();
    const s = calls(state, C1);
    expect(callsOffered(s, L)).toContain('double');
    const s2 = calls(s, 'pass');
    expect(callsOffered(s2, P)).not.toContain('double');
  });

  it('lets the doubled side redouble, and a new bid clears the double', () => {
    const { state, P, R, D } = start();
    let s = calls(state, C1, 'double');
    expect(callsOffered(s, P)).toContain('redouble');
    expect(callsOffered(s, P)).not.toContain('double');
    s = calls(s, 'pass');
    // The doubling side can't redouble its own double.
    expect(callsOffered(s, R)).not.toContain('redouble');
    expect(callsOffered(s, R)).not.toContain('double');
    s = calls(s, 'pass');
    expect(callsOffered(s, D)).toContain('redouble');
    s = calls(s, 'redouble');
    expect(s.vars.doubled).toBe(2);
    s = calls(s, 12);
    expect(s.vars.doubled).toBe(0);
  });

  it("doesn't take a player who passed out of the auction", () => {
    const { state, D } = start();
    const s = calls(state, 'pass', C1, 'pass', 'pass');
    expect(s.cursor.current).toBe(D);
    expect(callsOffered(s, D)).toContain(12);
  });

  it('ends after three passes following a bid', () => {
    const { state } = start();
    const s = calls(state, C1, 'pass', 'pass');
    expect(phase(s)).toBe('auction');
    expect(phase(calls(s, 'pass'))).toBe('play');
  });

  it('makes declarer whoever on the side first named the suit', () => {
    const { state, D, L, P } = start();
    // D names hearts first; P raises; D declares, P is dummy, L leads.
    const s = calls(state, 13, 'pass', H2, 'pass', 'pass', 'pass');
    expect(s.vars).toMatchObject({ contract: H2, declarer: D, dummy: P, trump: 'hearts' });
    expect(playersToAct(s)).toEqual([L]);
  });

  it("doesn't count the other side naming the suit first", () => {
    const { state, L, P, R } = start();
    // D bids 1♥, L overcalls 1♠, P bids 2♥, R bids 2♠: R's partner L named spades first.
    const s = calls(state, 13, 14, H2, S2, 'pass', 'pass', 'pass');
    expect(s.vars).toMatchObject({ declarer: L, dummy: R });
    expect(playersToAct(s)).toEqual([P]);
  });

  it('plays a no trump contract with no trump', () => {
    const { state } = start();
    const s = calls(state, NT3, 'pass', 'pass', 'pass');
    expect(s.vars.trump).toBeNull();
  });

  it('throws in a hand everyone passes, and the deal passes on', () => {
    const { state, D, L } = start();
    const s = calls(state, 'pass', 'pass', 'pass', 'pass');
    expect(s.round).toBe(2);
    expect(s.dealer).toBe(L);
    expect(points(s)).toEqual([0, 0]);
    expect(s.history.at(-1)?.round).toBe(1);
    expect(D).not.toBe(L);
  });

  it('in Chicago, has the same dealer deal again after four passes', () => {
    const { state, D } = start({ scoring: 'chicago' });
    const s = calls(state, 'pass', 'pass', 'pass', 'pass');
    expect(s.dealer).toBe(D);
    expect(tracks(s, 0).deals ?? 0).toBe(0);
  });
});

describe('the dummy', () => {
  const contract = () => {
    const { state, D, L, P } = start();
    return { state: calls(state, S4, 'pass', 'pass', 'pass'), D, L, P };
  };

  it('stays hidden until the opening lead, then is shown to everyone', () => {
    const { state, L, P } = contract();
    expect(viewFor(state, L).zones[`hand@${P}`]).toMatchObject({ kind: 'count' });
    const s = applyMove(state, getLegalMoves(state, L)[0] as Move);
    for (let seat = 0; seat < 4; seat++) {
      expect(viewFor(s, seat).zones[`hand@${P}`]).toMatchObject({ kind: 'cards' });
    }
    expect(findHiddenCardLeak(s)).toBeNull();
  });

  it('is played by the declarer, and has no moves of its own', () => {
    const { state, D, L, P } = contract();
    const s = applyMove(state, getLegalMoves(state, L)[0] as Move);
    expect(getLegalMoves(s, P)).toEqual([]);
    expect(playersToAct(s)).toEqual([D]);
    const move = getLegalMoves(s, D)[0] as Move;
    expect(move).toMatchObject({ player: P, by: D, type: 'playToTrick' });
    const after = applyMove(s, move);
    expect(after.zones[`hand@${P}`]).toHaveLength(12);
  });

  it('must follow suit like anyone else', () => {
    const { state, D, L, P } = contract();
    const clubs = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].map((r) => `${r}C`);
    const diamonds = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q'].map((r) => `${r}D`);
    const s0 = withZones(
      state,
      { [`hand@${L}`]: ['2H', ...clubs], [`hand@${P}`]: ['3H', '4H', ...diamonds] },
      'won@t0',
    );
    const s = applyMove(s0, { player: L, type: 'playToTrick', card: id('2H') });
    const dummyCards = getLegalMoves(s, D)
      .filter((m) => m.player === P)
      .flatMap((m) => (m.type === 'playToTrick' ? [m.card] : []));
    expect(dummyCards.sort()).toEqual([id('3H'), id('4H')].sort());
  });
});

describe('scoring a made contract', () => {
  it('scores trick points below the line for a part score', () => {
    const { state, D } = start();
    const s = lastTrick(calls(state, H2, 'pass', 'pass', 'pass'), 7, true);
    const team = D % 2;
    expect(points(s)?.[team]).toBe(60);
    expect(tracks(s, team).below).toBe(60);
    expect(tracks(s, team).games ?? 0).toBe(0);
  });

  it('counts overtricks above the line, and makes game at 100 below', () => {
    const { state, D } = start({}, [{}, {}]);
    // 3NT making 10 tricks: 100 below (game), plus 30 for the overtrick.
    const s = lastTrick(calls(state, NT3, 'pass', 'pass', 'pass'), 9, true);
    const team = D % 2;
    expect(points(s)?.[team]).toBe(130);
    expect(tracks(s, team)).toMatchObject({ games: 1, below: 0 });
    expect(tracks(s, 1 - team)).toMatchObject({ oppGames: 1 });
  });

  it("adds to an earlier part score to make game, and wipes out the other side's", () => {
    const { state, D } = start({}, []);
    const team = D % 2;
    const s0 = draft(state);
    (s0.teams[team] as { tracks: Record<string, number> }).tracks.below = 40;
    (s0.teams[1 - team] as { tracks: Record<string, number> }).tracks.below = 70;
    // 2♠ is 60: 40 + 60 makes game.
    const s = lastTrick(calls(s0, S2, 'pass', 'pass', 'pass'), 7, true);
    expect(tracks(s, team)).toMatchObject({ games: 1, below: 0 });
    expect(tracks(s, 1 - team)).toMatchObject({ below: 0 });
  });

  it('doubles trick points when doubled, with 50 for making it and 100 a doubled overtrick', () => {
    const { state, D } = start();
    // 2♠ doubled making 9: 120 below (game), 100 for the overtrick, 50 for making it.
    const s = lastTrick(calls(state, S2, 'double', 'pass', 'pass', 'pass'), 8, true);
    expect(points(s)?.[D % 2]).toBe(270);
    expect(tracks(s, D % 2)).toMatchObject({ games: 1 });
  });

  it('quadruples when redoubled, and redoubled overtricks score 400 vulnerable', () => {
    const { state, D } = start({}, D_VUL());
    // 1♣ redoubled, vulnerable, making 8: 80 below, 400 overtrick, 100 for making it.
    const s = lastTrick(calls(state, C1, 'double', 'redouble', 'pass', 'pass', 'pass'), 7, true);
    expect(points(s)?.[D % 2]).toBe(80 + 400 + 100);
  });

  it('scores slam bonuses: 500 small slam not vulnerable, 1,500 grand slam vulnerable', () => {
    const small = start();
    const s1 = lastTrick(calls(small.state, S6, 'pass', 'pass', 'pass'), 11, true);
    expect(points(s1)?.[small.D % 2]).toBe(180 + 500);

    const grand = start({}, D_VUL());
    const s2 = lastTrick(calls(grand.state, NT7, 'pass', 'pass', 'pass'), 12, true);
    // 220 below, 1,500 for the slam, and this game wins the rubber: 700 more.
    expect(points(s2)?.[grand.D % 2]).toBe(220 + 1500 + 700);
  });
});

/** Tracks making the dealer's side vulnerable (it has won a game; the other side hasn't). */
function D_VUL(): Record<string, number>[] {
  // The seed's dealer: worked out once so tests can say "the dealer's side".
  const dealer = createGame(bridge, {}, 4, 'bridge').dealer;
  const tracksFor: Record<string, number>[] = [{}, {}];
  tracksFor[dealer % 2] = { games: 1 };
  tracksFor[1 - (dealer % 2)] = { oppGames: 1 };
  return tracksFor;
}

describe('scoring a contract that goes down', () => {
  const down = (doubling: Call[], tricks: number, vul = false) => {
    const { state, D } = start({}, vul ? D_VUL() : []);
    const s = lastTrick(calls(state, H4, 'pass', 'pass', ...doubling, 'pass'), tricks - 1, true);
    return { declarer: points(s)?.[D % 2], defenders: points(s)?.[1 - (D % 2)] };
  };

  it('gives the defenders 50 a trick, 100 vulnerable', () => {
    expect(down([], 8)).toEqual({ declarer: 0, defenders: 100 });
    expect(down([], 8, true)).toEqual({ declarer: 0, defenders: 200 });
  });

  it('doubled, not vulnerable: 100, 300, 500, then 300 more a trick', () => {
    const doubled = (tricks: number) => down(['double', 'pass', 'pass'], tricks).defenders;
    expect([doubled(9), doubled(8), doubled(7), doubled(6), doubled(5)]).toEqual([
      100, 300, 500, 800, 1100,
    ]);
  });

  it('doubled, vulnerable: 200, 500, 800, then 300 more a trick', () => {
    const doubled = (tricks: number) => down(['double', 'pass', 'pass'], tricks, true).defenders;
    expect([doubled(9), doubled(8), doubled(7), doubled(6)]).toEqual([200, 500, 800, 1100]);
  });

  it('redoubled: twice the doubled penalty', () => {
    const redoubled = (tricks: number, vul = false) =>
      down(['double', 'redouble', 'pass', 'pass'], tricks, vul).defenders;
    expect(redoubled(9)).toBe(200);
    expect(redoubled(8, true)).toBe(1000);
  });

  it("doesn't change either side's part score", () => {
    const { state, D } = start();
    const s = lastTrick(calls(state, H4, 'pass', 'pass', 'pass'), 5, false);
    expect(tracks(s, D % 2).below ?? 0).toBe(0);
    expect(tracks(s, 1 - (D % 2)).below ?? 0).toBe(0);
  });
});

describe('vulnerability and the rubber', () => {
  it('shows who is vulnerable, the contract and the declarer', () => {
    const { state, D } = start({}, D_VUL());
    const s = calls(state, S4, 'double', 'pass', 'pass', 'pass');
    expect(viewFor(s, 0).display).toEqual([
      { label: 'Vulnerable', value: D % 2, format: 'team' },
      { label: 'Contract', value: '4♠' },
      { label: 'Doubled', value: 'Yes' },
      { label: 'Declarer', value: D, format: 'player' },
      { label: 'Tricks needed', value: 10 },
    ]);
    expect(viewFor(start().state, 0).trackLabels).toMatchObject({
      below: 'Part score',
      oppGames: null,
    });
  });

  it('shows neither and both sides vulnerable', () => {
    const neither = calls(start().state, 'pass');
    expect(viewFor(neither, 0).display[0]).toEqual({ label: 'Vulnerable', value: 'Neither side' });
    const both = calls(
      start({}, [
        { games: 1, oppGames: 1 },
        { games: 1, oppGames: 1 },
      ]).state,
      'pass',
    );
    expect(viewFor(both, 0).display[0]).toEqual({ label: 'Vulnerable', value: 'Both sides' });
  });

  it('ends the rubber at two games: 700 when the other side has none, and the game is over', () => {
    const { state, D } = start({}, D_VUL());
    const s = lastTrick(calls(state, H4, 'pass', 'pass', 'pass'), 9, true);
    expect(points(s)?.[D % 2]).toBe(120 + 700);
    expect(s.status).toBe('over');
    expect(s.winners).toEqual([D % 2, (D % 2) + 2]);
  });

  it('scores 500 for the rubber when the other side has a game, and plays on with 2 rubbers', () => {
    const { state, D } = start({ rubbers: 2 }, [
      { games: 1, oppGames: 1 },
      { games: 1, oppGames: 1 },
    ]);
    const s = lastTrick(calls(state, H4, 'pass', 'pass', 'pass'), 9, true);
    expect(points(s)?.[D % 2]).toBe(120 + 500);
    expect(s.status).toBe('inProgress');
    for (const team of [0, 1]) {
      expect(tracks(s, team)).toMatchObject({ games: 0, oppGames: 0, rubbers: 1 });
    }
  });
});

describe('honors', () => {
  it('counts the top trumps a player holds when they play their first card', () => {
    const { state, D, L } = start();
    const s0 = calls(state, S4, 'pass', 'pass', 'pass');
    const s = withZones(
      s0,
      {
        [`hand@${L}`]: [
          'AS',
          'KS',
          'QS',
          'JS',
          '2C',
          '3C',
          '4C',
          '5C',
          '6C',
          '7C',
          '8C',
          '9C',
          '10C',
        ],
        [`hand@${D}`]: [
          '10S',
          '2D',
          '3D',
          '4D',
          '5D',
          '6D',
          '7D',
          '8D',
          '9D',
          '10D',
          'JD',
          'QD',
          'KD',
        ],
      },
      'won@t0',
    );
    const after = applyMove(s, { player: L, type: 'playToTrick', card: id('2C') });
    expect(after.players[L]?.vars.honors).toBe(4);
    const played = applyMove(s, { player: L, type: 'playToTrick', card: id('AS') });
    expect(played.players[L]?.vars.honors).toBe(4);
  });

  it("scores 100 for four honors and 150 for five, to the holder's side, made or not", () => {
    const { state, D, L } = start();
    const s0 = calls(state, S4, 'pass', 'pass', 'pass');
    const s = lastTrick(s0, 8, false, { [L]: { honors: 4 }, [D]: { honors: 5 } });
    // Down 2 not vulnerable: 100 to the defenders, plus their 100 honors.
    expect(points(s)).toEqual(D % 2 === 0 ? [150, 100 + 100] : [100 + 100, 150]);
  });

  it('scores 150 for four aces at no trump, and nothing with honors switched off', () => {
    const { state, D } = start();
    const s0 = calls(state, NT3, 'pass', 'pass', 'pass');
    const s = lastTrick(s0, 8, true, { [D]: { aces: 4 } });
    expect(points(s)?.[D % 2]).toBe(100 + 150);
    const off = start({ honors: false });
    const s1 = lastTrick(calls(off.state, NT3, 'pass', 'pass', 'pass'), 8, true, {
      [off.D]: { aces: 4 },
    });
    expect(points(s1)?.[off.D % 2]).toBe(100);
  });
});

describe('Chicago', () => {
  /** Plays a hand: the dealer bids `contract` and makes it exactly (or goes down with `down`). */
  const hand = (state: GameState, contract: number, made = true) => {
    const s = calls(state, contract, 'pass', 'pass', 'pass');
    const needed = Math.floor(contract / 10) + 6;
    return lastTrick(s, made ? needed - 1 : needed - 2, true);
  };

  it('sets vulnerability by deal: neither, dealer, dealer, both', () => {
    let state = start({ scoring: 'chicago', rubbers: 2 }).state;
    const seen: (string | number | boolean)[] = [];
    for (let deal = 0; deal < 4; deal++) {
      const dealer = state.dealer;
      const view = viewFor(calls(state, 'pass'), 0).display[0]?.value as string | number;
      seen.push(typeof view === 'number' ? (view === dealer % 2 ? 'dealer' : 'other') : view);
      state = hand(state, C1, false);
    }
    expect(seen).toEqual(['Neither side', 'dealer', 'dealer', 'Both sides']);
  });

  it('scores 300 for a game not vulnerable and 500 vulnerable, clearing part scores', () => {
    const { state, D } = start({ scoring: 'chicago' });
    const s = hand(state, H4);
    expect(points(s)?.[D % 2]).toBe(120 + 300);
    // Deal 2: the new dealer's side is vulnerable.
    const D2 = s.dealer;
    const s2 = hand(s, H4);
    expect(points(s2)?.[D2 % 2]).toBe(120 + 500);
    expect(tracks(s2, 0).below ?? 0).toBe(0);
  });

  it('carries part scores over, and gives 100 for a part score on the fourth deal', () => {
    let state = start({ scoring: 'chicago' }).state;
    for (let deal = 0; deal < 3; deal++) state = hand(state, C1, false);
    const D4 = state.dealer;
    const s = hand(state, H2);
    expect(points(s)?.[D4 % 2]).toBe(60 + 100);
    expect(s.status).toBe('over');
  });

  it("doesn't give the fourth-deal bonus for a game", () => {
    let state = start({ scoring: 'chicago' }).state;
    for (let deal = 0; deal < 3; deal++) state = hand(state, C1, false);
    const D4 = state.dealer;
    const s = hand(state, NT3);
    // Both sides are vulnerable on the fourth deal.
    expect(points(s)?.[D4 % 2]).toBe(100 + 500);
  });
});

describe('a whole game', () => {
  it('plays a rubber to the end with real moves', () => {
    let state: GameState = createGame(bridge, {}, 4, 'whole');
    for (let guard = 0; state.status !== 'over'; guard++) {
      if (guard > 20_000) throw new Error('The rubber never ended');
      const [actor] = playersToAct(state);
      const moves = getLegalMoves(state, actor as number);
      // Bid the lowest bid on offer once per hand, then pass; play the first legal card.
      const lowest = moves.find((m) => m.type === 'bid' && typeof m.value === 'number');
      const pass = moves.find((m) => m.type === 'passBid');
      const move = state.vars.contract == null && lowest ? lowest : (pass ?? moves[0]);
      state = applyMove(state, move as Move);
    }
    expect(state.winners).toHaveLength(2);
  });
});
