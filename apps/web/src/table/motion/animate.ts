/**
 * Card motion on screen, with the browser's own animation support (no library).
 *
 * Before a new view is drawn, `capture` notes where every card is. Once it's
 * drawn, `play` flies a copy of each card that moved from its old spot to its
 * new one on a layer above the page (so nothing clips it), keeping the real
 * card invisible until the copy lands. Cards that left the table fly to where
 * the plan says they went. Only copies move and they ignore the pointer, so
 * nothing here ever stops you making your next move.
 *
 * With "reduce motion" switched on, cards fade in or out where they are
 * instead. Where the browser can't animate (tests), nothing happens.
 */
import { motionSetting } from '../../settings';
import { type Anchor, type MotionPlan } from './plan';

/** Time for one card to fly, in ms (the rules say under about 400). */
const FLIGHT = 320;
/** A deal takes about this long in all, however many cards. */
const DEAL_TIME = 1000;
const EASE = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

/** The speed setting (Settings, saved in the browser): 1 is normal, 2 fast, 0 off. */
export function motionSpeed(): number {
  return { normal: 1, fast: 2, off: 0 }[motionSetting()];
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function canAnimate(): boolean {
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
}

interface Seen {
  rect: DOMRect;
  /** A copy of the card as it looked, to fly if it leaves. */
  copy: HTMLElement;
}

/** The parts of the page cards move between (the felt and your area, not the side panel). */
function roots(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-motion-root]')];
}

/** Every card drawn on the table, by id (the first if a card is somehow drawn twice). */
function cardsOnTable(): Map<string, HTMLElement> {
  const cards = new Map<string, HTMLElement>();
  for (const root of roots()) {
    for (const el of root.querySelectorAll<HTMLElement>('[data-card-id]')) {
      const id = el.dataset.cardId;
      if (id && !cards.has(id) && visible(el.getBoundingClientRect())) cards.set(id, el);
    }
  }
  return cards;
}

/** Hidden by CSS (a closed seat panel on a phone) means no size. */
function visible(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0;
}

function anchorName(anchor: Anchor): string {
  return 'seat' in anchor ? `seat:${anchor.seat}` : `zone:${anchor.zone}`;
}

function findAnchor(anchor: Anchor): HTMLElement | null {
  for (const root of roots()) {
    const el = root.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(anchorName(anchor))}"]`);
    if (el && visible(el.getBoundingClientRect())) return el;
  }
  return null;
}

/** A card-sized box in the middle of an anchor. */
function boxAt(anchor: HTMLElement, width: number, height: number): DOMRect {
  const r = anchor.getBoundingClientRect();
  return new DOMRect(r.x + r.width / 2 - width / 2, r.y + r.height / 2 - height / 2, width, height);
}

export class CardMotion {
  private seen: Map<string, Seen> | null = null;
  private running: Animation[] = [];
  private layer: HTMLElement | null = null;
  private skipListener: (() => void) | null = null;

  /** Notes where every card is, just before the screen changes. */
  readonly capture = (): void => {
    if (!canAnimate()) return;
    // Anything still flying jumps to its end, so its card is where it belongs.
    this.finishAll();
    const seen = new Map<string, Seen>();
    for (const [id, el] of cardsOnTable()) {
      seen.set(id, { rect: el.getBoundingClientRect(), copy: el.cloneNode(true) as HTMLElement });
    }
    this.seen = seen;
  };

  /** Moves the cards that moved, once the new view is drawn. */
  play(plan: MotionPlan): void {
    const seen = this.seen;
    this.seen = null;
    const speed = motionSpeed();
    if (!canAnimate() || speed === 0) return;
    const reduced = reducedMotion();
    const flight = FLIGHT / speed;
    const now = cardsOnTable();

    // A deal goes round the table one card at a time, finishing in about a second.
    const turns = plan.deal ? dealTurns(plan) : 0;
    const stagger = turns > 1 ? Math.min(80, (DEAL_TIME - flight) / speed / turns) : 0;

    for (const [id, el] of now) {
      const to = el.getBoundingClientRect();
      const before = seen?.get(id);
      const arrival = plan.arrivals.get(id);
      if (reduced) {
        if (!before || moved(before.rect, to)) this.fade(el);
      } else if (before) {
        if (moved(before.rect, to)) this.fly(el, before.rect, to, { flight, lift: true });
      } else if (arrival) {
        const anchor = findAnchor(arrival.from);
        if (anchor) {
          const from = boxAt(anchor, to.width, to.height);
          const delay = (arrival.slot ?? 0) * stagger;
          this.fly(el, from, to, { flight, flip: arrival.flip, delay });
        } else this.fade(el);
      } else if (seen) {
        this.fade(el);
      }
    }

    for (const [id, { rect, copy }] of seen ?? []) {
      if (now.has(id)) continue;
      const departure = plan.departures.get(id);
      if (!departure) continue;
      if (reduced) {
        this.leave(copy, rect, null, flight);
        continue;
      }
      const anchor = findAnchor(departure.to);
      if (!anchor) continue;
      if (departure.turnDown) this.turnDown(copy, rect, anchor, flight);
      else this.leave(copy, rect, boxAt(anchor, rect.width * 0.6, rect.height * 0.6), flight);
    }

    if (!reduced) {
      for (const backs of plan.backs) {
        const from = findAnchor(backs.from);
        const to = findAnchor(backs.to);
        if (!from || !to) continue;
        const { first, every } = backs.slots ?? { first: 0, every: 0 };
        for (let i = 0; i < backs.count; i++) {
          this.flyBack(from, to, flight, (first + i * every) * stagger);
        }
      }
    }

    // A tap anywhere skips the deal.
    if (plan.deal && this.running.length > 0) {
      const skip = () => this.finishAll();
      this.skipListener = skip;
      window.addEventListener('pointerdown', skip, { capture: true, once: true });
    }
  }

  /** Ends every animation at once, as if it had finished. */
  finishAll(): void {
    for (const animation of this.running) animation.finish();
    this.running = [];
    if (this.skipListener) {
      window.removeEventListener('pointerdown', this.skipListener, { capture: true });
      this.skipListener = null;
    }
  }

  // ---- the moves ----

  /** A copy of `el` flies from `from` to where `el` is; `el` shows once it lands. */
  private fly(
    el: HTMLElement,
    from: DOMRect,
    to: DOMRect,
    { flight, flip = false, lift = false, delay = 0 }: FlyOptions,
  ): void {
    const box = this.box(to);
    const card = flip ? flipper(el.cloneNode(true) as HTMLElement) : el.cloneNode(true);
    box.appendChild(card);
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const scale = from.width / to.width;
    const start = `translate(${dx}px, ${dy}px) scale(${scale})`;
    const frames: Keyframe[] = lift
      ? [
          { transform: start },
          {
            transform: `translate(${dx / 2}px, ${dy / 2 - 12}px) scale(${(scale + 1) / 2 + 0.06})`,
          },
          { transform: 'none' },
        ]
      : [{ transform: start }, { transform: 'none' }];
    const timing = { duration: flight, delay, easing: EASE, fill: 'backwards' as const };
    // The real card stays hidden until the copy is there.
    this.track(el.animate({ opacity: [0, 0] }, { duration: flight + delay }));
    this.track(box.animate(frames, timing), box);
    if (flip && card instanceof HTMLElement) {
      this.track(card.animate({ transform: ['rotateY(180deg)', 'rotateY(0deg)'] }, timing));
    }
  }

  /** A card that left the table: its copy flies to `to` and fades, or just fades. */
  private leave(copy: HTMLElement, from: DOMRect, to: DOMRect | null, flight: number): void {
    const box = this.box(from);
    box.appendChild(copy.cloneNode(true));
    const frames: Keyframe[] = to
      ? [
          { transform: 'none', opacity: 1 },
          { opacity: 1, offset: 0.7 },
          {
            transform: `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(${to.width / from.width})`,
            opacity: 0,
          },
        ]
      : [{ opacity: 1 }, { opacity: 0 }];
    this.track(
      box.animate(frames, { duration: to ? flight : 200, easing: EASE, fill: 'forwards' }),
      box,
    );
  }

  /** A face-up card turns face down where it lies. */
  private turnDown(copy: HTMLElement, rect: DOMRect, anchor: HTMLElement, flight: number): void {
    const box = this.box(rect);
    const card = flipper(copy.cloneNode(true) as HTMLElement);
    box.appendChild(card);
    const hidden = anchor.querySelector<HTMLElement>('.card');
    if (hidden) this.track(hidden.animate({ opacity: [0, 0] }, { duration: flight }));
    this.track(
      card.animate(
        { transform: ['rotateY(0deg)', 'rotateY(180deg)'] },
        { duration: flight, easing: EASE },
      ),
      box,
    );
  }

  /** A face-down card going from one place to another (a deal, someone drawing). */
  private flyBack(from: HTMLElement, to: HTMLElement, flight: number, delay: number): void {
    const back = document.createElement('span');
    back.className = 'card back size-small';
    // As big as the small cards (--small-w), which changes with the screen size.
    const width =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--small-w')) || 46;
    const a = boxAt(from, width, width * 1.5);
    const b = boxAt(to, width, width * 1.5);
    const box = this.box(b);
    box.appendChild(back);
    const frames: Keyframe[] = [
      { transform: `translate(${a.x - b.x}px, ${a.y - b.y}px)`, opacity: 1 },
      { opacity: 1, offset: 0.8 },
      { transform: 'none', opacity: 0 },
    ];
    this.track(box.animate(frames, { duration: flight, delay, easing: EASE, fill: 'both' }), box);
  }

  /** Fades a card in where it is. */
  private fade(el: HTMLElement): void {
    this.track(el.animate({ opacity: [0, 1] }, { duration: 200 }));
  }

  // ---- the layer above the page ----

  /** An empty box on the motion layer, placed over `rect`. */
  private box(rect: DOMRect): HTMLElement {
    if (!this.layer || !this.layer.isConnected) {
      this.layer = document.createElement('div');
      this.layer.className = 'motion-layer';
      this.layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(this.layer);
    }
    const box = document.createElement('div');
    box.className = 'motion-box';
    Object.assign(box.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    // The card inside is drawn at the box's size, whatever size it was drawn at before.
    for (const name of ['--card-w', '--small-w', '--tiny-w']) {
      box.style.setProperty(name, `${rect.width}px`);
    }
    this.layer.appendChild(box);
    return box;
  }

  /** Keeps an animation so it can be finished early; removes `box` once it's done. */
  private track(animation: Animation, box?: HTMLElement): void {
    this.running.push(animation);
    const done = () => {
      box?.remove();
      this.running = this.running.filter((a) => a !== animation);
    };
    animation.addEventListener('finish', done);
    animation.addEventListener('cancel', done);
  }

  /**
   * Tidies up as the table closes. Cards still flying are left to land (they
   * remove themselves): in development React closes and reopens the table
   * once on purpose, which mustn't cut the deal short.
   */
  dispose(): void {
    if (this.running.length > 0) return;
    this.layer?.remove();
    this.layer = null;
  }
}

interface FlyOptions {
  flight: number;
  flip?: boolean;
  lift?: boolean;
  delay?: number;
}

/** How many cards a deal deals, one after another (the last turn plus one). */
function dealTurns(plan: MotionPlan): number {
  let last = -1;
  for (const { slot = 0 } of plan.arrivals.values()) last = Math.max(last, slot);
  for (const { count, slots } of plan.backs) {
    if (slots) last = Math.max(last, slots.first + (count - 1) * slots.every);
  }
  return last + 1;
}

/** Moved enough to notice. */
function moved(a: DOMRect, b: DOMRect): boolean {
  return Math.abs(a.x - b.x) > 2 || Math.abs(a.y - b.y) > 2;
}

/** A card with a back behind it, to turn over (see .motion-flip in styles.css). */
function flipper(face: HTMLElement): HTMLElement {
  const card = document.createElement('div');
  card.className = 'motion-flip';
  face.classList.add('motion-front');
  const back = document.createElement('span');
  // The same size of card as the face.
  back.className = `${[...face.classList].filter((c) => c.startsWith('size-')).join(' ')} card back motion-back`;
  card.append(face, back);
  return card;
}
