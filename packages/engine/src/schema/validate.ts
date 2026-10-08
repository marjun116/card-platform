/**
 * validate(file): checks a game file against the schema, then checks
 * everything that needs the whole file: referenced zones and options exist
 * and are the right kind, expressions parse and only use names that exist
 * where they're used, the deck is big enough for the deal, and every phase
 * can end. Errors are written for a person reading the file, e.g.
 *   phases[1] ("play").actions[0].to: zone "tricks" doesn't exist
 */
import type { z } from 'zod';
import { isCardCode, isRank, isSuit, parseCardCode, RANKS, SUITS } from '../cards/card';
import { ExprError } from '../errors';
import { compile, walk } from '../expr/evaluate';
import type { Node } from '../expr/parser';
import type {
  DisplayDef,
  ActionDef,
  EffectDef,
  GameFile,
  PhaseDef,
  ScoreRuleDef,
  ZoneDef,
} from '../game/types';
import { ACES, gameFileSchema, LEADER_FIRST, PASS_DIRECTIONS, TIES, WINNERS } from './gameFile';
import { heldNames, PLAYER_PROPERTIES, playerVarNames } from '../game/scope';

export interface ValidationIssue {
  /** Where in the file, e.g. 'phases[1] ("play").actions[0].to'. */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; file: GameFile; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

type Path = readonly (string | number)[];

export function validate(input: unknown): ValidationResult {
  const parsed = gameFileSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => ({
      path: formatPath(issue.path as Path, input),
      message: zodMessage(issue),
    }));
    return { ok: false, errors, warnings: [] };
  }
  const checker = new Checker(parsed.data);
  checker.run();
  if (checker.errors.length > 0) {
    return { ok: false, errors: checker.errors, warnings: checker.warnings };
  }
  return { ok: true, file: parsed.data, warnings: checker.warnings };
}

/** One line per problem, for error messages and the terminal. */
export function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('\n');
}

// ---- paths and messages ----

function formatPath(path: Path, file: unknown): string {
  let text = '';
  let node: unknown = file;
  path.forEach((segment, i) => {
    node =
      node && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined;
    if (typeof segment === 'number') {
      text += `[${segment}]`;
      // Name phases, so "phases[1]" reads as 'phases[1] ("play")'.
      const name = node && typeof node === 'object' ? (node as { name?: unknown }).name : undefined;
      if (i === 1 && path[0] === 'phases' && typeof name === 'string') text += ` ("${name}")`;
    } else {
      text += text ? `.${segment}` : segment;
    }
  });
  return text;
}

function zodMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys.map((k) => `"${k}"`).join(', ');
    return `Unknown key${issue.keys.length > 1 ? 's' : ''} ${keys} (check the spelling)`;
  }
  if (issue.code === 'invalid_type' && issue.message.endsWith('received undefined')) {
    return `Required (expected ${issue.expected})`;
  }
  if (issue.code === 'invalid_value') {
    return `Must be one of ${issue.values.map((v) => JSON.stringify(v)).join(', ')}`;
  }
  if (issue.code === 'invalid_key') {
    return issue.issues[0]?.message ?? 'Invalid name';
  }
  const message = issue.message.replace(/^Invalid input: /, '');
  return message.charAt(0).toUpperCase() + message.slice(1);
}

/** Closest name within two edits, for "did you mean" hints. */
function suggest(name: string, options: Iterable<string>): string {
  let best: string | null = null;
  let bestDistance = 3;
  for (const option of options) {
    const d = distance(name.toLowerCase(), option.toLowerCase());
    if (d < bestDistance && d < name.length) {
      best = option;
      bestDistance = d;
    }
  }
  return best ? ` Did you mean "${best}"?` : '';
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j] as number;
      row[j] = Math.min(
        (row[j] as number) + 1,
        (row[j - 1] as number) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[b.length] as number;
}

// ---- expression checking ----

/** What an expression can refer to at a given place in the file. */
interface ExprContext {
  player: boolean;
  team: boolean;
  card: boolean;
  /** A meld action's `if`, in a game with meld rules: `meld` is the group being melded. */
  meld?: boolean;
  /** A declareTrump action's `if`: `suit` is the suit being considered. */
  suit?: boolean;
  /** A bid action's `if`: `bid` is the bid being considered. */
  bid?: boolean;
}

const NO_CONTEXT: ExprContext = { player: false, team: false, card: false };
const PLAYER: ExprContext = { player: true, team: true, card: false };
const PLAYER_CARD: ExprContext = { player: true, team: true, card: true };
const TEAM: ExprContext = { player: false, team: true, card: false };
const CARD: ExprContext = { player: false, team: false, card: true };

/** The kind of thing an expression node produces, as far as we can tell. */
type Kind =
  | 'player'
  | 'team'
  | 'zone'
  | 'meldZone'
  | 'trick'
  | 'card'
  | 'list'
  | 'options'
  | 'state'
  | 'activePlayers'
  | 'turn'
  | 'meld'
  | 'value';

const PLAYER_PROPS = PLAYER_PROPERTIES;
const TEAM_PROPS = ['id', 'score', 'tricks', 'bid', 'players'];
const CARD_PROPS = ['id', 'code', 'suit', 'rank', 'isJoker'];
const ZONE_PROPS = ['count', 'top', 'cards', 'sameRankAtEnd', 'runAtEnd'];
const SUIT_FUNCTIONS = ['containsSuit', 'onlySuit', 'countSuit'];
const RANK_FUNCTIONS = ['hasRank', 'countRank'];
/** Functions taking a card code such as "QS". */
const CODE_FUNCTIONS = ['hasCard', 'countCard', 'holderOf'];
const TRICK_PROPS = ['leader', 'winner', 'ledSuit', 'number', 'isBeatenBy'];
const FUNCTIONS = [
  'cardValue',
  'sum',
  'min',
  'max',
  'abs',
  'holderOf',
  'countSums',
  'countPairs',
  'runCards',
];
const CODE_HINT = 'use a rank and suit letter, e.g. "QS", "10H", "2C", or JOKER';
const QUANTIFIER_KIND: Record<string, Kind> = {
  anyPlayer: 'player',
  everyPlayer: 'player',
  anyTeam: 'team',
  everyTeam: 'team',
};
const RESERVED = new Set([
  'player',
  'team',
  'card',
  'state',
  'options',
  'round',
  'activePlayers',
  'turn',
  'meld',
  'suit',
  'bid',
  ...FUNCTIONS,
  ...Object.keys(QUANTIFIER_KIND),
  'true',
  'false',
  'null',
  'in',
]);

const CARD_ACTIONS = new Set<ActionDef['type']>([
  'play',
  'playToTrick',
  'discard',
  'layOff',
  'showHand',
]);

class Checker {
  readonly errors: ValidationIssue[] = [];
  readonly warnings: ValidationIssue[] = [];
  private readonly tracks: Set<string>;

  constructor(private readonly file: GameFile) {
    const { perTeam = [], perPlayer = [] } = file.scoring;
    this.tracks = new Set([...perTeam, ...perPlayer].flatMap((r) => Object.keys(r.track ?? {})));
  }

  private error(path: Path, message: string): void {
    this.errors.push({ path: formatPath(path, this.file), message });
  }

  private warn(path: Path, message: string): void {
    this.warnings.push({ path: formatPath(path, this.file), message });
  }

  run(): void {
    this.checkMeta();
    this.checkOptions();
    this.checkMeldRules();
    this.checkZones();
    this.checkDeck();
    this.checkSetup();
    this.file.phases.forEach((phase, i) => this.checkPhase(phase, ['phases', i]));
    this.checkScoring();
    if (this.file.elimination)
      this.checkExpr(this.file.elimination.when, ['elimination', 'when'], PLAYER);
    this.checkEnd();
  }

  // ---- meld rules ----

  private checkMeldRules(): void {
    const wild = this.file.cardOrder?.wild;
    if (wild) this.checkExpr(wild, ['cardOrder', 'wild'], CARD);
    const rules = this.file.meldRules;
    if (!rules) {
      if (wild) this.warn(['cardOrder', 'wild'], 'Wild cards only work in melds with "meldRules"');
      return;
    }
    const path = ['meldRules'];
    if (rules.aces !== undefined) this.checkSetting(rules.aces, ACES, [...path, 'aces']);
    for (const key of ['pureRunRequired', 'autoArrange'] as const) {
      const value = rules[key];
      if (typeof value === 'string') this.checkExpr(value, [...path, key], NO_CONTEXT);
    }
    if (rules.zone !== undefined) {
      this.zone(rules.zone, [...path, 'zone'], { per: 'player', melds: true });
    }
  }

  // ---- meta, options, zones, deck ----

  private playerRange(): [number, number] {
    const { players } = this.file.meta;
    return Array.isArray(players) ? players : [players, players];
  }

  private checkMeta(): void {
    const [min, max] = this.playerRange();
    if (min > max)
      this.error(['meta', 'players'], `The minimum (${min}) is more than the maximum (${max})`);
    const teams = this.file.meta.teams;
    if (!teams) return;
    if (Array.isArray(teams)) {
      if (min !== max) {
        this.error(
          ['meta', 'teams'],
          'Teams need a fixed number of players (e.g. "players": 4), or give teams by ' +
            'player count (e.g. { "4": [[0, 2], [1, 3]] })',
        );
        return;
      }
      this.checkTeams(teams, min, ['meta', 'teams']);
      return;
    }
    for (const [players, list] of Object.entries(teams)) {
      const n = Number(players);
      if (n < min || n > max) {
        this.error(['meta', 'teams', players], `This game is for ${min} to ${max} players`);
      } else {
        this.checkTeams(list, n, ['meta', 'teams', players]);
      }
    }
  }

  private checkTeams(teams: number[][], players: number, path: Path): void {
    const seats = teams.flat().sort((a, b) => a - b);
    if (seats.length !== players || seats.some((seat, i) => seat !== i)) {
      this.error(path, `Teams must list each seat 0 to ${players - 1} exactly once`);
    }
  }

  private checkOptions(): void {
    for (const [name, option] of Object.entries(this.file.options ?? {})) {
      const path = ['options', name];
      if (option.type === 'boolean') {
        if (typeof option.default !== 'boolean') {
          this.error([...path, 'default'], 'A true/false option needs a default of true or false');
        }
        if (option.values) this.error([...path, 'values'], 'A true/false option has no "values"');
      } else if (!option.values) {
        this.error(path, 'A choice option needs a list of "values"');
      } else if (!option.values.includes(option.default)) {
        this.error(
          [...path, 'default'],
          `The default ${JSON.stringify(option.default)} isn't one of the values`,
        );
      }
      const values = option.type === 'boolean' ? [true, false] : (option.values ?? []);
      this.checkLabels(option.labels, values.map(String), [...path, 'labels']);
    }
  }

  private checkLabels(
    labels: Record<string, string> | undefined,
    values: readonly string[],
    path: Path,
  ): void {
    for (const key of Object.keys(labels ?? {})) {
      if (!values.includes(key)) {
        this.error([...path, key], `"${key}" isn't one of the values (${values.join(', ')})`);
      }
    }
  }

  private checkZones(): void {
    for (const [name, zone] of Object.entries(this.file.zones)) {
      const path = ['zones', name];
      if (RESERVED.has(name)) {
        this.error(
          path,
          `"${name}" can't be a zone name: expressions already use it for something else`,
        );
      }
      if (zone.per && zone.shared) {
        this.error(path, `A zone can't be both "per": "${zone.per}" and "shared"`);
      }
      if (zone.countVisible && zone.visibility !== 'none') {
        this.warn([...path, 'countVisible'], 'Only matters for zones with "visibility": "none"');
      }
    }
    const hand = this.file.zones.hand;
    if (!hand || hand.per !== 'player' || hand.melds) {
      this.error(['zones'], 'Every game needs a per-player zone called "hand"');
    }
  }

  /** Cards in the deck, after removals that always apply; null if it depends on the table. */
  private deckSize(): number | null {
    const { copies = 1, ranks = RANKS, suits = SUITS, jokers = 0, remove = [] } = this.file.deck;
    if (typeof copies !== 'number' || typeof jokers !== 'number') return null;
    const always = new Set(remove.filter((r) => !r.if).flatMap((r) => r.cards));
    const removed = [...always].filter((code) => this.inDeck(code)).length;
    return copies * (ranks.length * suits.length + jokers - removed);
  }

  /** Is this suited card (by code) in the deck, before removals? */
  private inDeck(code: string): boolean {
    const { ranks = RANKS, suits = SUITS } = this.file.deck;
    const card = parseCardCode(code);
    return card !== null && ranks.includes(card.rank) && suits.includes(card.suit);
  }

  private checkDeck(): void {
    const { copies, jokers } = this.file.deck;
    if (typeof copies === 'string') this.checkExpr(copies, ['deck', 'copies'], NO_CONTEXT);
    if (typeof jokers === 'string') this.checkExpr(jokers, ['deck', 'jokers'], NO_CONTEXT);
    (this.file.deck.remove ?? []).forEach((removal, i) => {
      const path = ['deck', 'remove', i];
      if (removal.if) this.checkExpr(removal.if, [...path, 'if'], NO_CONTEXT);
      removal.cards.forEach((code, j) => {
        if (parseCardCode(code) === null) {
          // Jokers are left out with "jokers": 0, not removed here.
          this.error([...path, 'cards', j], `"${code}" isn't a card (use e.g. "2D" or "10H")`);
        } else if (!this.inDeck(code)) {
          this.warn([...path, 'cards', j], `${code} isn't in the deck anyway`);
        }
      });
    });
    const { deal, flip } = this.file.setup;
    if (typeof deal.count !== 'number') return;
    const [, max] = this.playerRange();
    const needed = deal.count * max + (flip ? 1 : 0);
    const size = this.deckSize();
    if (size !== null && needed > size) {
      this.error(
        ['setup', 'deal', 'count'],
        `The deck has ${size} cards, but dealing ${deal.count} to ${max} players` +
          `${flip ? ' and flipping one' : ''} needs ${needed}`,
      );
    }
    const order = this.file.cardOrder?.ranks;
    const missing = (this.file.deck.ranks ?? RANKS).filter((r) => order && !order.includes(r));
    if (missing.length > 0) {
      this.warn(
        ['cardOrder', 'ranks'],
        `Doesn't include ${missing.join(', ')}, which are in the deck`,
      );
    }
    const declares = this.allActions().some(({ action }) => action.type === 'declareTrump');
    if (this.file.cardOrder?.trump === 'declared' && !declares) {
      this.warn(['cardOrder', 'trump'], '"declared" trump needs a declareTrump action somewhere');
    }
  }

  /**
   * Checks a zone reference. `per` is what kind of zone is needed:
   * "player" (one per player), "shared", or "any".
   */
  private zone(
    name: string,
    path: Path,
    need: { per: 'player' | 'shared' | 'any'; melds?: boolean },
  ): ZoneDef | undefined {
    const zone = this.file.zones[name];
    if (!zone) {
      this.error(
        path,
        `Zone "${name}" doesn't exist.${suggest(name, Object.keys(this.file.zones))}`,
      );
      return undefined;
    }
    if (need.per === 'player' && zone.per !== 'player') {
      this.error(path, `Zone "${name}" must be a per-player zone ("per": "player")`);
    }
    if (need.per === 'shared' && zone.per) {
      this.error(path, `Zone "${name}" must be shared, not one per ${zone.per}`);
    }
    if (need.melds === true && !zone.melds) {
      this.error(path, `Zone "${name}" must hold melds ("melds": true)`);
    }
    if (need.melds !== true && zone.melds) {
      this.error(path, `Zone "${name}" holds melds; use meld or layOff to put cards there`);
    }
    return zone;
  }

  // ---- setup ----

  private checkSetup(): void {
    const { deal, rest, flip } = this.file.setup;
    this.zone(deal.to, ['setup', 'deal', 'to'], { per: 'player' });
    if (typeof deal.count === 'string')
      this.checkExpr(deal.count, ['setup', 'deal', 'count'], NO_CONTEXT);
    if (rest) this.zone(rest, ['setup', 'rest'], { per: 'shared' });
    const flips = Array.isArray(flip) ? flip : flip ? [flip] : [];
    flips.forEach((f, i) => {
      const path = Array.isArray(flip) ? ['setup', 'flip', i] : ['setup', 'flip'];
      if (f.if) this.checkExpr(f.if, [...path, 'if'], NO_CONTEXT);
      this.zone(f.from, [...path, 'from'], { per: 'shared' });
      this.zone(f.to, [...path, 'to'], { per: 'shared' });
      if (f.from !== rest) {
        this.error(
          [...path, 'from'],
          `The starting card must come from the undealt cards ("rest": ${rest ? `"${rest}"` : 'not set'})`,
        );
      }
      if (f.triggerEffects) {
        this.error([...path, 'triggerEffects'], 'Only false is supported for now');
      }
      for (const [key, value] of Object.entries(f.set ?? {})) {
        this.checkSetEntry(key, value, [...path, 'set', key], CARD);
      }
      if (f.reflipIf) this.checkExpr(f.reflipIf, [...path, 'reflipIf'], CARD);
    });
  }

  // ---- phases and actions ----

  private allActions(): { action: ActionDef; path: Path; phase: PhaseDef }[] {
    return this.file.phases.flatMap((phase, p) => [
      ...(phase.actions ?? []).map((action, a) => ({
        action,
        phase,
        path: ['phases', p, 'actions', a] as Path,
      })),
      ...(phase.turn ?? []).flatMap((step, s) =>
        step.actions.map((action, a) => ({
          action,
          phase,
          path: ['phases', p, 'turn', s, 'actions', a] as Path,
        })),
      ),
    ]);
  }

  private checkPhase(phase: PhaseDef, path: Path): void {
    if (phase.actions && phase.turn) {
      this.error(path, 'Use either "actions" or "turn", not both');
    } else if (!phase.actions && !phase.turn) {
      this.error(path, 'Needs "actions" (or "turn" steps) saying what players can do');
    }
    if (phase.if) this.checkExpr(phase.if, [...path, 'if'], NO_CONTEXT);
    if (phase.until) this.checkExpr(phase.until, [...path, 'until'], PLAYER);
    if (phase.leader?.first !== undefined) {
      this.checkSetting(phase.leader.first, LEADER_FIRST, [...path, 'leader', 'first']);
    }

    const actions = [
      ...(phase.actions ?? []).map((a, i) => ({ action: a, path: [...path, 'actions', i] })),
      ...(phase.turn ?? []).flatMap((step, s) =>
        step.actions.map((a, i) => ({ action: a, path: [...path, 'turn', s, 'actions', i] })),
      ),
    ];
    for (const { action, path: actionPath } of actions) this.checkAction(action, actionPath, phase);

    const isTrick = actions.some(({ action }) => action.type === 'playToTrick');
    // A reshuffle limit also ends the round once the reshuffles are used up.
    const endsRound = Object.values(phase.whenEmpty ?? {}).some(
      (policy) =>
        policy === 'endRound' || (typeof policy === 'object' && policy.limit !== undefined),
    );
    if (isTrick) {
      const after = phase.afterTrick ?? [];
      const resolve = after.findIndex((e) => e.resolveTrick);
      if (resolve < 0) {
        this.error(
          [...path, 'afterTrick'],
          'A trick phase needs a resolveTrick effect in "afterTrick"',
        );
      }
      const move = after.findIndex((e) => e.moveTrick);
      if (move >= 0 && move < resolve) {
        this.error([...path, 'afterTrick', move], 'moveTrick must come after resolveTrick');
      }
      after.forEach((e, i) => this.checkEffect(e, [...path, 'afterTrick', i], NO_CONTEXT, true));
    } else {
      if (phase.repeat !== undefined) {
        this.error([...path, 'repeat'], '"repeat" only applies to trick phases (with playToTrick)');
      }
      if (phase.afterTrick) {
        this.error(
          [...path, 'afterTrick'],
          '"afterTrick" only applies to trick phases (with playToTrick)',
        );
      }
      if (phase.rounds === undefined && !phase.until && !endsRound) {
        this.error(
          path,
          'This phase never ends: give it "rounds", "until" or a "whenEmpty" endRound',
        );
      }
    }

    for (const [zone, policy] of Object.entries(phase.whenEmpty ?? {})) {
      this.zone(zone, [...path, 'whenEmpty', zone], { per: 'any' });
      const reshuffles = policy !== 'endRound';
      if (reshuffles && !this.file.zones.discard) {
        this.error([...path, 'whenEmpty', zone], 'Reshuffling needs a zone called "discard"');
      }
      if (typeof policy === 'object' && typeof policy.limit === 'string') {
        this.checkExpr(policy.limit, [...path, 'whenEmpty', zone, 'limit'], NO_CONTEXT);
      }
    }
  }

  private checkAction(action: ActionDef, path: Path, phase: PhaseDef): void {
    const ctx = CARD_ACTIONS.has(action.type) ? PLAYER_CARD : PLAYER;
    const ifCtx =
      action.type === 'meld' && this.file.meldRules
        ? { ...PLAYER, meld: true }
        : action.type === 'declareTrump'
          ? { ...PLAYER, suit: true }
          : action.type === 'bid'
            ? { ...PLAYER, bid: true }
            : ctx;
    // A one-card draw's effects can see the card drawn.
    const effectCtx = action.type === 'draw' ? PLAYER_CARD : ctx;
    if (action.if) this.checkExpr(action.if, [...path, 'if'], ifCtx);
    action.effects?.forEach((e, i) =>
      this.checkEffect(e, [...path, 'effects', i], effectCtx, false),
    );
    const hand = (from: string | undefined) =>
      this.zone(from ?? 'hand', [...path, 'from'], { per: 'player' });

    switch (action.type) {
      case 'play':
      case 'discard':
        hand(action.from);
        this.zone(action.to, [...path, 'to'], { per: 'any' });
        break;
      case 'playToTrick':
        this.zone(action.to ?? 'trick', [...path, 'to'], { per: 'shared' });
        if (action.leadRestriction?.unless) {
          this.checkExpr(
            action.leadRestriction.unless,
            [...path, 'leadRestriction', 'unless'],
            PLAYER,
          );
        }
        action.restrictions?.forEach((r, i) => {
          const where = [...path, 'restrictions', i];
          if (r.if) this.checkExpr(r.if, [...where, 'if'], PLAYER);
          if ((r.mustPlay === undefined) === (r.cannotPlay === undefined)) {
            this.error(where, 'Give exactly one of "mustPlay" or "cannotPlay"');
          }
          if (r.mustPlay) this.checkExpr(r.mustPlay, [...where, 'mustPlay'], PLAYER_CARD);
          if (r.cannotPlay) this.checkExpr(r.cannotPlay, [...where, 'cannotPlay'], PLAYER_CARD);
        });
        break;
      case 'draw': {
        this.zone(action.from, [...path, 'from'], { per: 'any' });
        // Usually into a hand; a shared zone turns a card up for everyone (a starter card).
        this.zone(action.to ?? 'hand', [...path, 'to'], { per: 'any' });
        const phaseActions = [
          ...(phase.actions ?? []),
          ...(phase.turn ?? []).flatMap((s) => s.actions),
        ];
        if (action.then && !phaseActions.some((a) => a.type === 'play')) {
          this.error([...path, 'then'], '"mayPlayDrawnCard" needs a play action in the same phase');
        }
        if (typeof action.count === 'string') {
          this.checkExpr(action.count, [...path, 'count'], PLAYER);
        }
        if (action.then && (action.count ?? 1) !== 1) {
          this.error([...path, 'then'], '"mayPlayDrawnCard" only works when drawing one card');
        }
        break;
      }
      case 'pass':
        hand(action.from);
        this.checkSetting(action.direction, PASS_DIRECTIONS, [...path, 'direction']);
        break;
      case 'showHand':
        this.zone(action.to, [...path, 'to'], { per: 'any' });
        if (!this.file.meldRules) {
          this.error(path, '"showHand" needs "meldRules" (players arrange their hands)');
        }
        break;
      case 'choose':
        this.checkStatePath(action.set, [...path, 'set'], PLAYER);
        this.checkLabels(action.labels, action.values, [...path, 'labels']);
        if (new Set(action.values).size !== action.values.length) {
          this.error([...path, 'values'], 'Each choice must be different');
        }
        break;
      case 'meld':
      case 'layOff':
        hand(action.from);
        this.zone(action.to, [...path, 'to'], { per: 'any', melds: true });
        break;
      case 'pickUpPile':
        this.zone(action.from, [...path, 'from'], { per: 'any' });
        this.zone(action.to ?? 'hand', [...path, 'to'], { per: 'player' });
        break;
      case 'bid':
        if (!Array.isArray(action.values)) {
          const [low, high] = action.values.range;
          if (low > high) this.error([...path, 'values', 'range'], `${low} is more than ${high}`);
        }
        break;
      case 'passBid':
      case 'declareTrump':
        break;
    }
  }

  private checkEffect(effect: EffectDef, path: Path, ctx: ExprContext, afterTrick: boolean): void {
    if (effect.if) this.checkExpr(effect.if, [...path, 'if'], ctx);

    const verbs = [
      effect.choose ? 'choose' : effect.set !== undefined ? 'set' : null,
      effect.resolveTrick && 'resolveTrick',
      effect.moveTrick && 'moveTrick',
      effect.nextPlayer && 'nextPlayer',
      effect.skip && 'skip',
      effect.reverse && 'reverse',
      effect.winnerLeads && 'winnerLeads',
      effect.breakSuit && 'breakSuit',
      effect.layOutMelds && 'layOutMelds',
      effect.sitOut !== undefined && 'sitOut',
      effect.score !== undefined && 'score',
      effect.returnCards && 'returnCards',
    ].filter((v): v is string => typeof v === 'string');
    if (verbs.length === 0) this.error(path, "This effect doesn't do anything");
    if (verbs.length > 1) {
      this.error(path, `Each effect should do one thing; this one has ${verbs.join(', ')}`);
    }

    if (effect.of && !effect.moveTrick)
      this.error([...path, 'of'], '"of" only goes with moveTrick');
    if (effect.to && !effect.returnCards)
      this.error([...path, 'to'], '"to" only goes with returnCards');
    if (effect.label && effect.score === undefined)
      this.error([...path, 'label'], '"label" only goes with score');
    if (effect.into && effect.score === undefined)
      this.error([...path, 'into'], '"into" only goes with score');
    if (effect.into && (TEAM_PROPS.includes(effect.into) || this.tracks.has(effect.into))) {
      this.error(
        [...path, 'into'],
        `"${effect.into}" is already something else; pick another name`,
      );
    }
    if (effect.score !== undefined) {
      if (typeof effect.score === 'string') this.checkExpr(effect.score, [...path, 'score'], ctx);
      if (!ctx.player) {
        this.error(path, "score needs a player to score for: use it in an action's effects");
      }
    }
    if (effect.returnCards) {
      this.zone(effect.returnCards, [...path, 'returnCards'], { per: 'shared' });
      this.zone(effect.to ?? 'hand', [...path, 'to'], { per: 'player' });
    }
    if ((effect.resolveTrick || effect.moveTrick || effect.winnerLeads) && !afterTrick) {
      this.error(path, `${verbs[0] ?? 'This'} only works in a trick phase's "afterTrick"`);
    }
    if (effect.moveTrick) this.zone(effect.moveTrick, [...path, 'moveTrick'], { per: 'any' });
    if (effect.sitOut !== undefined) this.checkExpr(effect.sitOut, [...path, 'sitOut'], ctx);
    if (effect.layOutMelds) {
      this.zone(effect.layOutMelds, [...path, 'layOutMelds'], { per: 'player', melds: true });
      if (!ctx.player) {
        this.error(path, "layOutMelds needs a player: use it in an action's effects");
      }
      if (!this.file.meldRules) {
        this.error(path, '"layOutMelds" needs "meldRules" (players arrange their hands)');
      }
    }

    if (effect.choose) {
      if (typeof effect.set !== 'string') {
        this.error([...path, 'set'], '"choose" needs "set": "state.<name>" to store the choice');
      } else {
        this.checkStatePath(effect.set, [...path, 'set'], NO_CONTEXT);
      }
      if (!ctx.player)
        this.error([...path, 'choose'], "Only a player can choose: use it in an action's effects");
    } else if (typeof effect.set === 'string') {
      this.checkStatePath(effect.set, [...path, 'set'], ctx);
    } else if (effect.set) {
      for (const [key, value] of Object.entries(effect.set)) {
        this.checkSetEntry(key, value, [...path, 'set', key], ctx);
      }
    }

    if (effect.nextPlayer) {
      const { draw, from, skip } = effect.nextPlayer;
      if (!draw && !skip) this.error([...path, 'nextPlayer'], 'Needs "draw" and/or "skip"');
      if (draw) this.zone(from ?? 'stock', [...path, 'nextPlayer', 'from'], { per: 'any' });
      if (typeof draw === 'string') this.checkExpr(draw, [...path, 'nextPlayer', 'draw'], ctx);
    }
  }

  /** A setting that is one of `allowed`, or an expression giving one of them. */
  private checkSetting(value: string, allowed: readonly string[], path: Path): void {
    if (!allowed.includes(value)) this.checkExpr(value, path, NO_CONTEXT);
  }

  /** "state.<name>", or "player.<name>" where there is a player. */
  private checkStatePath(path: string, where: Path, ctx: ExprContext): void {
    if (/^state\.[A-Za-z_][A-Za-z0-9_]*$/.test(path)) return;
    if (/^player\.[A-Za-z_][A-Za-z0-9_]*$/.test(path)) {
      const name = path.slice('player.'.length);
      if (!ctx.player) this.error(where, `"${path}" needs a player, and there is none here`);
      else if (PLAYER_PROPS.includes(name) || Object.hasOwn(this.file.zones, name)) {
        this.error(where, `"${path}" is already something else; pick another name`);
      }
      return;
    }
    this.error(
      where,
      `Can only set custom values written as "state.<name>" or "player.<name>", not "${path}"`,
    );
  }

  private checkSetEntry(
    key: string,
    value: string | number | boolean | null,
    path: Path,
    ctx: ExprContext,
  ): void {
    this.checkStatePath(key, path, ctx);
    if (typeof value === 'string') this.checkExpr(value, path, ctx);
  }

  // ---- scoring and end ----

  private playerValueNames(): string[] {
    return Object.keys(this.file.scoring.playerValues ?? {});
  }

  private checkScoring(): void {
    const { perTeam = [], perPlayer = [], cardValue = {}, playerValues = {} } = this.file.scoring;
    const valueNames = this.playerValueNames();
    for (const [name, source] of Object.entries(playerValues)) {
      const path = ['scoring', 'playerValues', name];
      if (RESERVED.has(name) || Object.hasOwn(this.file.zones, name)) {
        this.error(path, `"${name}" is already the name of something else`);
      }
      const ast = this.checkExpr(source, path, PLAYER);
      // A value using another value could go round in circles, so it isn't allowed.
      let usesValue = false;
      if (ast)
        walk(ast, (node) => {
          if (node.kind === 'name' && valueNames.includes(node.name)) usesValue = true;
        });
      if (usesValue) this.error(path, "A player value can't use another player value");
    }
    perTeam.forEach((rule, i) => this.checkRule(rule, ['scoring', 'perTeam', i], TEAM, true));
    (this.file.scoring.atGameEnd ?? []).forEach((rule, i) =>
      this.checkRule(rule, ['scoring', 'atGameEnd', i], PLAYER, false),
    );
    perPlayer.forEach((rule, i) =>
      this.checkRule(rule, ['scoring', 'perPlayer', i], PLAYER, false),
    );
    for (const key of Object.keys(cardValue)) {
      if (!isRank(key) && !isSuit(key) && !isCardCode(key) && key !== 'default') {
        this.error(
          ['scoring', 'cardValue', key],
          `"${key}" isn't a card ("QS"), rank ("Q"), suit ("spades"), JOKER or default`,
        );
      }
    }
  }

  private checkRule(rule: ScoreRuleDef, path: Path, ctx: ExprContext, perTeam: boolean): void {
    if (rule.if) this.checkExpr(rule.if, [...path, 'if'], ctx);
    if (typeof rule.add === 'string') this.checkExpr(rule.add, [...path, 'add'], ctx);
    for (const [name, value] of Object.entries(rule.track ?? {})) {
      if (typeof value === 'string') this.checkExpr(value, [...path, 'track', name], ctx);
    }
    if (perTeam && rule.to) this.error([...path, 'to'], '"to" only applies to perPlayer rules');
  }

  private checkEnd(): void {
    const { when, winner, ties, notes = [], priority } = this.file.endCondition;
    if (priority) this.checkExpr(priority, ['endCondition', 'priority'], TEAM);
    notes.forEach((note, i) =>
      this.checkExpr(note.if, ['endCondition', 'notes', i, 'if'], NO_CONTEXT),
    );
    (this.file.display ?? []).forEach((item, i) => this.checkDisplay(item, ['display', i]));
    const ast = this.checkExpr(when, ['endCondition', 'when'], NO_CONTEXT);
    if (ties !== undefined) this.checkSetting(ties, TIES, ['endCondition', 'ties']);
    this.checkSetting(winner, WINNERS, ['endCondition', 'winner']);
    if (winner === 'lastActivePlayer' && !this.file.elimination) {
      this.warn(
        ['endCondition', 'winner'],
        '"lastActivePlayer" needs an "elimination" rule to knock players out',
      );
    }
    if (!ast || (ast.kind === 'lit' && ast.value === true)) return;
    const changing = new Set([
      'score',
      'round',
      'activePlayers',
      'tricks',
      'active',
      'count',
      'bags',
    ]);
    let mentions = false;
    walk(ast, (node) => {
      if ((node.kind === 'name' || node.kind === 'member') && changing.has(node.name))
        mentions = true;
      if (node.kind === 'member' && this.tracks.has(node.name)) mentions = true;
    });
    if (!mentions) {
      this.warn(
        ['endCondition', 'when'],
        "This may never become true: it doesn't mention scores, rounds or players left",
      );
    }
  }

  /**
   * Shown to every player, so a display may only use values everyone already
   * sees (state, options, round): never a pile, which could hold hidden cards.
   */
  private checkDisplay(item: DisplayDef, path: Path): void {
    for (const [key, source] of [
      ['value', item.value],
      ['if', item.if],
    ] as const) {
      if (source === undefined) continue;
      const ast = this.checkExpr(source, [...path, key], NO_CONTEXT);
      if (!ast) continue;
      const names = new Set<string>();
      walk(ast, (node) => {
        if (node.kind === 'name') names.add(node.name);
      });
      const others = [...names].filter((n) => !['state', 'options', 'round'].includes(n));
      if (others.length > 0) {
        this.error(
          [...path, key],
          `A display can only use state, options and round (so it never shows hidden cards), ` +
            `not ${others.map((n) => `"${n}"`).join(', ')}`,
        );
      }
    }
  }

  // ---- expressions ----

  /** Parses an expression and checks the names in it; returns the tree if it parsed. */
  private checkExpr(source: string, path: Path, ctx: ExprContext): Node | null {
    let ast: Node;
    try {
      ast = compile(source).ast;
    } catch (error) {
      this.error(path, error instanceof ExprError ? error.message : String(error));
      return null;
    }
    const problems: string[] = [];
    this.kindOf(ast, ctx, problems);
    for (const problem of [...new Set(problems)]) this.error(path, `${problem} in "${source}"`);
    this.checkNegatedQuantifier(ast, source, path);
    return ast;
  }

  /**
   * anyPlayer/everyPlayer apply to the whole expression, so "!anyPlayer.x"
   * means "some player isn't x", which is easy to misread as "nobody is x".
   */
  private checkNegatedQuantifier(ast: Node, source: string, path: Path): void {
    walk(ast, (node) => {
      if (node.kind !== 'unary' || node.op !== '!') return;
      let target = node.arg;
      while (target.kind === 'member') target = target.object;
      if (target.kind !== 'name' || !Object.hasOwn(QUANTIFIER_KIND, target.name)) return;
      const q = target.name;
      const other = q.startsWith('any') ? q.replace('any', 'every') : q.replace('every', 'any');
      this.warn(
        path,
        `"!${q}…" in "${source}" means "${q.startsWith('any') ? 'some' : 'every'} ` +
          `${q.endsWith('Player') ? 'player' : 'team'} doesn't…", because ${q} applies to the ` +
          `whole expression. For "${q.startsWith('any') ? 'none' : 'not all'}", write ` +
          `"${other}.… == false"`,
      );
    });
  }

  private zoneNames(per: 'player' | 'team' | undefined): string[] {
    return Object.entries(this.file.zones)
      .filter(([, z]) => z.per === per)
      .map(([name]) => name);
  }

  private zoneKind(name: string): Kind {
    return this.file.zones[name]?.melds ? 'meldZone' : 'zone';
  }

  /** Works out what a node refers to, recording problems along the way. */
  private kindOf(node: Node, ctx: ExprContext, problems: string[]): Kind {
    switch (node.kind) {
      case 'lit':
        return 'value';
      case 'array':
        node.items.forEach((item) => this.kindOf(item, ctx, problems));
        return 'list';
      case 'unary':
        this.kindOf(node.arg, ctx, problems);
        return 'value';
      case 'cond':
        this.kindOf(node.test, ctx, problems);
        this.kindOf(node.then, ctx, problems);
        this.kindOf(node.else, ctx, problems);
        return 'value';
      case 'binary':
        this.kindOf(node.left, ctx, problems);
        this.kindOf(node.right, ctx, problems);
        this.checkComparison(node, problems);
        return 'value';
      case 'call':
        this.kindOf(node.callee, ctx, problems);
        node.args.forEach((arg) => this.kindOf(arg, ctx, problems));
        if (node.callee.kind === 'member' || node.callee.kind === 'name')
          this.checkCallArgs(node.callee.name, node.args, problems);
        return 'value';
      case 'name':
        return this.nameKind(node.name, ctx, problems);
      case 'member':
        return this.memberKind(this.kindOf(node.object, ctx, problems), node.name, problems);
    }
  }

  private nameKind(name: string, ctx: ExprContext, problems: string[]): Kind {
    const quantifier = QUANTIFIER_KIND[name];
    if (quantifier) return quantifier;
    const unavailable = (what: string) => {
      problems.push(`"${name}" isn't available here (${what})`);
      return 'value' as const;
    };
    switch (name) {
      case 'player':
        return ctx.player ? 'player' : unavailable('there is no current player');
      case 'team':
        return ctx.team ? 'team' : unavailable('there is no current team');
      case 'card':
        return ctx.card ? 'card' : unavailable('only card actions and their effects have a card');
      case 'trick':
        return 'trick';
      case 'state':
        return 'state';
      case 'options':
        return 'options';
      case 'activePlayers':
        return 'activePlayers';
      case 'turn':
        return 'turn';
      case 'meld':
        return ctx.meld ? 'meld' : unavailable('only a meld action\'s "if" has a meld');
      case 'suit':
        return ctx.suit ? 'value' : unavailable('only a declareTrump action\'s "if" has a suit');
      case 'bid':
        return ctx.bid ? 'value' : unavailable('only a bid action\'s "if" has a bid');
      case 'round':
        return 'value';
    }
    if (FUNCTIONS.includes(name) || this.playerValueNames().includes(name)) return 'value';
    const zone = this.file.zones[name];
    if (zone) {
      if (zone.per === 'player' && !ctx.player)
        return unavailable('"' + name + '" belongs to a player, and there is no current player');
      if (zone.per === 'team' && !ctx.team)
        return unavailable('"' + name + '" belongs to a team, and there is no current team');
      return this.zoneKind(name);
    }
    const known = [
      ...Object.keys(this.file.zones),
      'player',
      'team',
      'card',
      'trick',
      'state',
      'options',
      'round',
      'activePlayers',
      'turn',
      ...FUNCTIONS,
      ...this.playerValueNames(),
      ...Object.keys(QUANTIFIER_KIND),
    ];
    problems.push(`Unknown name "${name}".${suggest(name, known)}`);
    return 'value';
  }

  private memberKind(object: Kind, prop: string, problems: string[]): Kind {
    const check = (what: string, props: string[], result: (p: string) => Kind): Kind => {
      if (props.includes(prop)) return result(prop);
      problems.push(`${what} has no "${prop}".${suggest(prop, props)}`);
      return 'value';
    };
    const zoneProps = (extra: string[]) => [
      ...ZONE_PROPS,
      ...SUIT_FUNCTIONS,
      ...RANK_FUNCTIONS,
      'hasCard',
      'countCard',
      ...extra,
    ];
    const zoneResult = (p: string): Kind =>
      p === 'top' ? 'card' : p === 'cards' ? 'list' : 'value';

    switch (object) {
      case 'player': {
        const zones = this.zoneNames('player');
        const vars = [...playerVarNames({ file: this.file })];
        return check('A player', [...PLAYER_PROPS, ...zones, ...this.tracks, ...vars], (p) =>
          zones.includes(p) ? this.zoneKind(p) : 'value',
        );
      }
      case 'team': {
        const zones = this.zoneNames('team');
        const held = [...heldNames({ file: this.file })];
        return check('A team', [...TEAM_PROPS, ...zones, ...this.tracks, ...held], (p) =>
          zones.includes(p) ? this.zoneKind(p) : 'value',
        );
      }
      case 'zone':
        return check('A zone', zoneProps([]), zoneResult);
      case 'meldZone':
        return check('A meld zone', zoneProps(['melds']), zoneResult);
      case 'trick':
        return check('The trick', zoneProps(TRICK_PROPS), zoneResult);
      case 'card':
        return check('A card', CARD_PROPS, () => 'value');
      case 'list':
        return check('A list', ['count'], () => 'value');
      case 'activePlayers':
        return check('activePlayers', ['count'], () => 'value');
      case 'turn':
        return check('turn', ['draws'], () => 'value');
      case 'meld':
        return check('A meld', ['kind', 'size', 'isPure', 'usesWild'], () => 'value');
      case 'options': {
        const options = Object.keys(this.file.options ?? {});
        if (!options.includes(prop)) {
          const declared =
            options.length > 0 ? ` (options: ${options.join(', ')})` : ' (no options are declared)';
          problems.push(`Option "${prop}" isn't declared${declared}.${suggest(prop, options)}`);
        }
        return 'value';
      }
      case 'state':
      case 'value':
        return 'value';
    }
  }

  private checkCallArgs(fn: string, args: Node[], problems: string[]): void {
    // hasCard('J', suit) takes a rank and a suit instead of a card code.
    if ((fn === 'hasCard' || fn === 'countCard') && args.length === 2) {
      fn = 'hasRank';
      args = args.slice(0, 1);
    }
    for (const arg of args) {
      if (arg.kind !== 'lit' || typeof arg.value !== 'string') continue;
      if (SUIT_FUNCTIONS.includes(fn) && !isSuit(arg.value)) {
        problems.push(`"${arg.value}" isn't a suit (use clubs, diamonds, hearts or spades)`);
      }
      if (RANK_FUNCTIONS.includes(fn) && !isRank(arg.value) && arg.value !== 'JOKER') {
        problems.push(`"${arg.value}" isn't a rank (use 2–10, J, Q, K, A or JOKER)`);
      }
      if (CODE_FUNCTIONS.includes(fn) && !isCardCode(arg.value)) {
        problems.push(`"${arg.value}" isn't a card (${CODE_HINT})`);
      }
    }
  }

  /** Catches card.suit == 'spade' and card.rank in ['1', 'J']. */
  private checkComparison(node: Extract<Node, { kind: 'binary' }>, problems: string[]): void {
    if (node.op !== '==' && node.op !== '!=' && node.op !== 'in') return;
    const field = (n: Node) =>
      n.kind === 'member' && ['suit', 'rank', 'code'].includes(n.name) ? n.name : null;
    const literals = (n: Node): string[] =>
      n.kind === 'lit' && typeof n.value === 'string'
        ? [n.value]
        : n.kind === 'array'
          ? n.items.flatMap((i) =>
              i.kind === 'lit' && typeof i.value === 'string' ? [i.value] : [],
            )
          : [];
    const pairs: [string | null, string[]][] = [
      [field(node.left), literals(node.right)],
      [field(node.right), node.op === 'in' ? [] : literals(node.left)],
    ];
    for (const [kind, values] of pairs) {
      for (const value of values) {
        if (kind === 'suit' && !isSuit(value)) {
          problems.push(`"${value}" isn't a suit (use clubs, diamonds, hearts or spades)`);
        }
        if (kind === 'rank' && !isRank(value) && value !== 'JOKER') {
          problems.push(`"${value}" isn't a rank (use 2–10, J, Q, K, A or JOKER)`);
        }
        if (kind === 'code' && !isCardCode(value)) {
          problems.push(`"${value}" isn't a card (${CODE_HINT})`);
        }
      }
    }
  }
}
