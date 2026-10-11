import { describe, expect, it } from 'vitest';
import { inlineParts, parseRules } from './rulesText';

describe('parseRules', () => {
  it('reads headings, paragraphs and bullet lists', () => {
    const source = [
      '# Spades',
      '',
      'A partnership game.',
      'Spades are trump.',
      '',
      '## Play',
      '- Follow suit.',
      '- Highest spade',
      '  wins.',
      'After the list.',
      '',
    ].join('\n');
    expect(parseRules(source)).toEqual([
      { type: 'heading', level: 1, text: 'Spades' },
      { type: 'paragraph', text: 'A partnership game. Spades are trump.' },
      { type: 'heading', level: 2, text: 'Play' },
      { type: 'list', items: ['Follow suit.', 'Highest spade wins. After the list.'] },
    ]);
  });

  it('ends a paragraph where a list starts, and handles Windows line endings', () => {
    expect(parseRules('Before:\r\n- one\r\n- two\r\n\r\nAfter.')).toEqual([
      { type: 'paragraph', text: 'Before:' },
      { type: 'list', items: ['one', 'two'] },
      { type: 'paragraph', text: 'After.' },
    ]);
  });

  it('shows anything outside the subset as plain text', () => {
    expect(parseRules('### Deep\n<b>hi</b>\n1. first')).toEqual([
      { type: 'paragraph', text: '### Deep <b>hi</b> 1. first' },
    ]);
  });
});

describe('inlineParts', () => {
  it('splits out bold text', () => {
    expect(inlineParts('**Nil** is a bid of **0** tricks')).toEqual([
      { text: 'Nil', bold: true },
      { text: ' is a bid of ', bold: false },
      { text: '0', bold: true },
      { text: ' tricks', bold: false },
    ]);
  });

  it('leaves an unclosed marker as it is', () => {
    expect(inlineParts('2 ** 3')).toEqual([{ text: '2 ** 3', bold: false }]);
  });
});
