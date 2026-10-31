import { describe, it, expect } from 'vitest';
import { plainDashes, plainDashStream } from './plain-dashes';

// Sentences from saved live-run readings (ai-prompt-eval/live-runs, 2026-08/09).
const READINGS: [string, string][] = [
  [
    'Worse, your mana fixing fetchlands—Wooded Foothills, Windswept Heath—only find basics.',
    'Worse, your mana fixing fetchlands, Wooded Foothills, Windswept Heath, only find basics.',
  ],
  [
    'Beast Within or Bone Shredder—both of which cost mana you might need elsewhere.',
    'Beast Within or Bone Shredder, both of which cost mana you might need elsewhere.',
  ],
  [
    'you have no discard payoffs at all — no madness, no flashback.',
    'you have no discard payoffs at all, no madness, no flashback.',
  ],
  [
    'Everything else in the 99 is an enabler - counterspells, cantrips, bounce - that produces nothing.',
    'Everything else in the 99 is an enabler, counterspells, cantrips, bounce, that produces nothing.',
  ],
  ['Diagnosis only – what to do comes next.', 'Diagnosis only, what to do comes next.'],
];

describe('plainDashes', () => {
  it.each(READINGS)('rewrites %j', (input, expected) => {
    expect(plainDashes(input)).toBe(expected);
  });

  it('drops a dash beside other punctuation instead of doubling it', () => {
    expect(plainDashes('It stalls, — badly.')).toBe('It stalls, badly.');
    expect(plainDashes('It stalls —.')).toBe('It stalls.');
    expect(plainDashes('It stalls —\nNext line')).toBe('It stalls\nNext line');
    expect(plainDashes('(— aside)')).toBe('(aside)');
    expect(plainDashes('Two dashes —— here')).toBe('Two dashes, here');
  });

  it('removes a dash that opens a line', () => {
    expect(plainDashes('First.\n— no answer to it')).toBe('First.\nno answer to it');
  });

  it('leaves hyphenated names, ranges and section labels alone', () => {
    const kept = [
      "Lim-Dûl the Necromancer and Will-o'-the-Wisp",
      'Cut 2–3 lands, or 4 - 5 if the curve allows.',
      '---WEAKNESS---\nThe curve is heavy.\n---FIXES---\nAdd 2 lands.\n---END---',
      'A two-drop and a self-mill engine.',
    ];
    for (const s of kept) expect(plainDashes(s)).toBe(s);
  });
});

describe('plainDashStream', () => {
  const whole = [
    '---WEAKNESS---',
    'Your fetchlands—Wooded Foothills, Windswept Heath—only find basics — and the',
    '— engine stalls, — badly. An enabler - counterspells - that produces 4 - 5 mana.',
    '---END---',
  ].join('\n');

  const streamed = (chunks: string[]) => {
    let out = '';
    const s = plainDashStream((t) => (out += t));
    chunks.forEach((c) => s.push(c));
    s.flush();
    return out;
  };

  it('matches the whole-text result at every split point', () => {
    const expected = plainDashes(whole);
    for (let i = 0; i <= whole.length; i++) {
      expect(streamed([whole.slice(0, i), whole.slice(i)])).toBe(expected);
    }
  });

  it('matches it streamed a character at a time', () => {
    expect(streamed([...whole])).toBe(plainDashes(whole));
  });
});
