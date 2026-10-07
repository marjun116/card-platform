/**
 * Hidden-card tests: no message sent to a player ever contains a card they
 * aren't allowed to see.
 *
 * The rule is worked out here from the game file's zone visibility, not
 * from the engine's viewFor, so a bug in viewFor can't hide itself:
 *   - a player may see a card if, at that point in the game or any earlier
 *     point, it sat somewhere visible to them (their own hand once they've
 *     looked at it, the trick, a face-up pile, the top of a topCardOnly pile);
 *   - every other card is hidden, and its id must not appear anywhere in the
 *     raw text of any frame their socket received (views, move logs, legal
 *     moves, lobby updates, acks, everything).
 * The seed and the RNG state must never appear either.
 */
import {
  applyMove,
  createGame,
  type GameState,
  type GameFile,
  type Move,
  type ZoneDef,
} from '@card-table/engine';
import { builtInGames } from '@card-table/games';
import { afterEach, describe, expect, it } from 'vitest';
import { guest, testServer, type TestServer } from '../testing';
import { TestClient } from '../testing/client';
import { listen, type Player, playRandomly, spadesTable } from '../testing/tables';
import type { ServerMessage } from './protocol';

let server: TestServer;
const clients: TestClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await server.app.close();
});

const CARD_ID = /"(?:10|[2-9JQKA])[CDHS]\.\d+"|"JOKER\.\d+"/;

/** Card ids `viewer` may see in this state, worked out from the zone definitions. */
function visibleTo(state: GameState, viewer: number): string[] {
  const me = state.players[viewer];
  if (!me) throw new Error(`No player ${viewer}`);
  const blind = state.lookRequired && !me.hasLookedAtHand;
  const seen: string[] = [];
  const zones: [string, { id: string }[]][] = [
    ...Object.entries(state.zones),
    ...Object.entries(state.melds).map(([k, melds]): [string, { id: string }[]] => [
      k,
      melds.flat(),
    ]),
  ];
  for (const [key, cards] of zones) {
    const [name = key, owner] = key.split('@');
    const def = state.file.zones[name] as ZoneDef;
    const ownedByMe =
      owner === String(viewer) || (owner?.startsWith('t') && Number(owner.slice(1)) === me.team);
    const ownHandWhileBlind = blind && owner === String(viewer) && def.per === 'player';
    if (def.visibility === 'all') seen.push(...cards.map((c) => c.id));
    if (def.visibility === 'topCardOnly' && cards.length > 0)
      seen.push((cards.at(-1) as { id: string }).id);
    if (def.visibility === 'owner' && ownedByMe && !ownHandWhileBlind)
      seen.push(...cards.map((c) => c.id));
  }
  // A card played into a face-up trick was seen by everyone, even the last
  // card of a trick, which moves to the winner's pile in the same move.
  for (const trick of [state.trick, state.lastTrick]) {
    const name = trick?.zone.split('@')[0] ?? '';
    if (trick && state.file.zones[name]?.visibility === 'all') {
      seen.push(...trick.plays.map((p) => p.card.id));
    }
  }
  // Cards being passed stay hidden from everyone until delivered.
  return seen;
}

function allCards(state: GameState): string[] {
  return [
    ...Object.values(state.zones).flat(),
    ...Object.values(state.melds).flat(2),
    ...state.passing.flat(),
  ].map((c) => c.id);
}

/**
 * For each seat, the cards hidden from it after `seq` moves, for every seq.
 * A card stays allowed once it has been seen.
 */
function hiddenBySeq(
  file: GameFile,
  options: Record<string, unknown>,
  seed: string,
  moves: Move[],
) {
  let state = createGame(file, options as never, 4, seed);
  const states = [state];
  for (const move of moves) states.push((state = applyMove(state, move)));
  // A card played to a face-up trick was seen by everyone, including the last
  // card of a round, which no snapshot shows in the trick.
  const trickZone = states.find((s) => s.trick)?.trick?.zone.split('@')[0] ?? '';
  const faceUpTricks = file.zones[trickZone]?.visibility === 'all';
  const playedAt = (k: number) => {
    const move = moves[k - 1];
    return faceUpTricks && move?.type === 'playToTrick' ? [move.card] : [];
  };
  return [0, 1, 2, 3].map((seat) => {
    const revealed = new Set<string>();
    return states.map((s, k) => {
      for (const id of [...visibleTo(s, seat), ...playedAt(k)]) revealed.add(id);
      return new Set(allCards(s).filter((id) => !revealed.has(id)));
    });
  });
}

/** Checks every frame a seated player received. Returns how many frames were checked. */
function checkFrames(player: Player, seat: number, hidden: Set<string>[][], seed: string): number {
  const forSeat = hidden[seat] as Set<string>[];
  for (const frame of player.client.frames) {
    expect(frame).not.toContain(seed);
    expect(frame).not.toMatch(/"rng"|"seed"/);
    const message = JSON.parse(frame) as ServerMessage;
    if (message.type !== 'game') {
      // Lobby updates, acks, errors, nudges and results carry no cards at all.
      expect(frame, `${message.type} frame to seat ${seat}`).not.toMatch(CARD_ID);
      continue;
    }
    expect(message.view.you).toBe(seat);
    const secret = forSeat[message.seq] as Set<string>;
    for (const id of secret) {
      if (frame.includes(`"${id}"`)) {
        throw new Error(
          `Seat ${seat} was sent ${id}, which it may not see, after ${message.seq} moves`,
        );
      }
    }
  }
  return player.client.frames.length;
}

async function playAndCheck(seed: string, options: Record<string, unknown> = {}) {
  server = await testServer();
  const baseUrl = await listen(server);
  const { code, players } = await spadesTable(server, baseUrl, { options: options as never });
  clients.push(...players.map((p) => p.client));

  // Someone who has the invite link but no seat, watching the whole game.
  const watcher = await guest(server.app, 'Watcher');
  const onlooker = await TestClient.connect(baseUrl, code, watcher.token, 'Watcher');
  clients.push(onlooker);

  await playRandomly(players, seed);

  const table = await server.store.getTableByInviteCode(code);
  if (!table) throw new Error('Table missing');
  const moves = await server.store.listMoves(table.id);
  const hidden = hiddenBySeq(builtInGames.spades, table.options, table.seed, moves);

  // The rule isn't vacuous: at the deal, each seat may not see 39 cards.
  for (const seat of [0, 1, 2, 3]) expect(hidden[seat]?.[0]?.size).toBeGreaterThanOrEqual(39);

  let frames = 0;
  for (const [seat, player] of players.entries()) {
    frames += checkFrames(player, seat, hidden, table.seed);
  }
  expect(frames).toBeGreaterThan(moves.length * 4);

  // The onlooker only ever got lobby updates.
  expect(onlooker.messages.every((m) => m.type === 'table')).toBe(true);
  for (const frame of onlooker.frames) expect(frame).not.toMatch(CARD_ID);
  return { players, moves, table };
}

describe('hidden cards', () => {
  it.each(['leak-1', 'leak-2', 'leak-3', 'leak-4'])(
    'never sends a player a card they may not see (%s)',
    async (seed) => {
      await playAndCheck(seed);
    },
  );

  it.each(['blind-1', 'blind-2', 'blind-3'])(
    'keeps blind-nil hands face down until their owner looks (%s)',
    async (seed) => {
      const { players } = await playAndCheck(seed, { blindNil: true });
      // At the deal, each player's own hand was hidden from them too.
      for (const p of players) {
        const first = p.client.messages.find((m) => m.type === 'game');
        if (first?.type !== 'game') throw new Error('No first view');
        const own = first.view.zones[`hand@${first.view.you}`];
        expect(own).toEqual({ kind: 'count', count: 13, top: null });
      }
    },
  );

  it('shows a blind player their hand once they look, and nobody else', async () => {
    server = await testServer();
    const baseUrl = await listen(server);
    const { players } = await spadesTable(server, baseUrl, { options: { blindNil: true } });
    clients.push(...players.map((p) => p.client));
    const [north, east] = players as [Player, Player, ...Player[]];

    await east.client.ok({ type: 'move', seq: 0, move: { type: 'lookAtHand' } });
    const eastView = (await east.client.game(1)).view;
    const northView = (await north.client.game(1)).view;
    const eastHand = eastView.zones['hand@1'];
    if (eastHand?.kind !== 'cards') throw new Error('East should see their hand');
    expect(eastHand.cards).toHaveLength(13);
    expect(northView.zones['hand@1']).toEqual({ kind: 'count', count: 13, top: null });
    for (const card of eastHand.cards) {
      for (const p of players.filter((x) => x !== east)) {
        expect(p.client.frames.some((f) => f.includes(`"${card.id}"`))).toBe(false);
      }
    }
  });

  it("rejects card moves from a blind player, so they can't probe their hand", async () => {
    server = await testServer();
    const baseUrl = await listen(server);
    const { players } = await spadesTable(server, baseUrl, { options: { blindNil: true } });
    clients.push(...players.map((p) => p.client));
    const actor = players[players[0]?.client.lastGame?.toAct[0] as number] as Player;
    const legal = actor.client.lastGame?.legalMoves ?? [];
    expect(legal.some((m) => 'card' in m || 'cards' in m)).toBe(false);

    for (const card of ['AS.0', '2C.0', 'KH.0']) {
      const reply = await actor.client.request({
        type: 'move',
        seq: 0,
        move: { type: 'playToTrick', card },
      });
      expect(reply).toMatchObject({
        type: 'error',
        code: 'ILLEGAL_MOVE',
        message: 'Look at your hand first',
      });
    }
  });

  it('catches a leak when there is one (checks the checker)', () => {
    const state = createGame(builtInGames.spades, {}, 4, 'checker');
    const hidden = hiddenBySeq(builtInGames.spades, {}, 'checker', []);
    const eastCard = state.zones['hand@1']?.[0]?.id as string;
    const frame = JSON.stringify({ type: 'game', seq: 0, view: { you: 0, sneaky: eastCard } });
    const fake = { client: { frames: [frame] } } as unknown as Player;
    expect(() => checkFrames(fake, 0, hidden, 'unrelated-seed')).toThrow(/Seat 0 was sent/);
    const lobby = JSON.stringify({ type: 'table', table: { note: eastCard } });
    const fakeLobby = { client: { frames: [lobby] } } as unknown as Player;
    expect(() => checkFrames(fakeLobby, 0, hidden, 'unrelated-seed')).toThrow();
  });

  it("ignores the player named in a move: you can't play from someone else's hand", async () => {
    server = await testServer();
    const baseUrl = await listen(server);
    const { players } = await spadesTable(server, baseUrl);
    clients.push(...players.map((p) => p.client));
    const view = players[0]?.client.lastGame;
    const actor = view?.toAct[0] as number;
    const other = players[(actor + 1) % 4] as Player;
    const theirMove = players[actor]?.client.lastGame?.legalMoves[0] as Move;

    // Another player sends the acting player's exact legal move, naming them.
    const reply = await other.client.request({ type: 'move', seq: 0, move: theirMove });
    expect(reply).toMatchObject({ type: 'error', code: 'ILLEGAL_MOVE' });
    const code = players[0]?.client.lastTable?.code ?? '';
    const table = await server.store.getTableByInviteCode(code);
    expect(await server.store.listMoves(table?.id ?? '')).toEqual([]);
  });
});
