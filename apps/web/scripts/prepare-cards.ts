/**
 * Copies Dmitry Fomin's English pattern card set (CC0, from Wikimedia
 * Commons) into public/cards, named by card id: "QS.svg", "10H.svg".
 *
 * Download the 52 files named "English_pattern_<rank>_of_<suit>.svg" from
 * https://commons.wikimedia.org/wiki/Category:SVG_English_pattern_playing_cards
 * into one folder, then run:
 *
 *   pnpm --filter @card-table/web exec tsx scripts/prepare-cards.ts <folder>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RANKS: Record<string, string> = {
  ace: 'A',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  jack: 'J',
  queen: 'Q',
  king: 'K',
};
const SUITS = { clubs: 'C', diamonds: 'D', hearts: 'H', spades: 'S' } as const;

const source = process.argv[2];
if (!source) throw new Error('Usage: prepare-cards.ts <folder with the downloaded SVGs>');
const out = join(import.meta.dirname, '..', 'public', 'cards');
mkdirSync(out, { recursive: true });

/**
 * Removes editor-only metadata, which is a large part of each file, and adds
 * a viewBox so the card scales to any size instead of being cropped.
 */
function prepare(svg: string): string {
  if (/<script|<foreignObject|javascript:|\son\w+=/i.test(svg)) {
    throw new Error('Card file contains script; refusing to copy it');
  }
  const stripped = svg
    .replace(/<\?xml[^>]*>\s*/, '')
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .replace(/<metadata[\s\S]*?<\/metadata>\s*/g, '')
    .replace(/<sodipodi:namedview[\s\S]*?(\/>|<\/sodipodi:namedview>)\s*/g, '');
  return stripped.replace(/<svg\b[\s\S]*?>/, (tag) => {
    if (/viewBox=/.test(tag)) return tag;
    const width = /\swidth="([\d.]+)"/.exec(tag)?.[1];
    const height = /\sheight="([\d.]+)"/.exec(tag)?.[1];
    if (!width || !height) throw new Error('Card file has no width and height');
    return tag.replace(/<svg\b/, `<svg viewBox="0 0 ${width} ${height}"`);
  });
}

let count = 0;
for (const [suitName, suit] of Object.entries(SUITS)) {
  for (const [rankName, rank] of Object.entries(RANKS)) {
    const file = join(source, `English_pattern_${rankName}_of_${suitName}.svg`);
    const svg = prepare(readFileSync(file, 'utf8'));
    writeFileSync(join(out, `${rank}${suit}.svg`), svg);
    count++;
  }
}
console.log(`Wrote ${count} cards to ${out}`);
