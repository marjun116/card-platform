/**
 * Rulebooks are written in a small subset of Markdown, shown by our own
 * renderer (components/Rules.tsx) so no HTML in the text ever reaches the
 * page: `#` and `##` headings, paragraphs (lines joined until a blank line),
 * `- ` bullet lists and `**bold**`. Anything else is shown as plain text.
 */

export type RulesBlock =
  | { type: 'heading'; level: 1 | 2; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

export function parseRules(source: string): RulesBlock[] {
  const blocks: RulesBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    if (list) blocks.push({ type: 'list', items: list });
    paragraph = [];
    list = null;
  };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{1,2})\s+(.*)$/.exec(line);
    if (line === '') {
      flush();
    } else if (heading) {
      flush();
      blocks.push({
        type: 'heading',
        level: heading[1] === '#' ? 1 : 2,
        text: heading[2] ?? '',
      });
    } else if (line.startsWith('- ')) {
      if (paragraph.length > 0) flush();
      list ??= [];
      list.push(line.slice(2).trim());
    } else if (list) {
      // A line under a bullet continues it.
      list[list.length - 1] += ` ${line}`;
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

/** A line of text split into plain and bold parts. An unclosed `**` is plain text. */
export function inlineParts(text: string): { text: string; bold: boolean }[] {
  const parts: { text: string; bold: boolean }[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), bold: false });
    parts.push({ text: match[1] ?? '', bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false });
  return parts;
}
