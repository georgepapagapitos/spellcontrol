import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildKeywordMatcher,
  segmentOracle,
  loadKeywordMatcher,
  type KeywordGloss,
  type OracleSegment,
} from './keyword-glossary';

// The glossary rows these tests need, shaped like the generated glossary file
// (the file itself is generated, so tests never read it). The oracle text
// below is real, copied from Scryfall.
const kw = (name: string, rule: string, kind: KeywordGloss['kind'] = 'ability'): KeywordGloss => ({
  name,
  rule,
  kind,
  text: `${name} rule text.`,
});

const GLOSSARY: KeywordGloss[] = [
  kw('Flying', '702.9'),
  kw('First Strike', '702.7'),
  kw('Vigilance', '702.20'),
  kw('Trample', '702.19'),
  kw('Haste', '702.10'),
  kw('Protection', '702.16'),
  kw('Split Second', '702.61'),
  kw('Landwalk', '702.14'),
  kw('Cycling', '702.29'),
  kw('Kicker', '702.33'),
  kw('Flash', '702.8'),
  kw('Flashback', '702.34'),
  kw('Storm', '702.40'),
  kw('Ward', '702.21'),
  kw('Defender', '702.3'),
  kw('Crew', '702.122'),
  kw('Indestructible', '702.12'),
  kw('Daybound and Nightbound', '702.145'),
  kw('Scry', '701.22', 'action'),
  kw('Surveil', '701.25', 'action'),
  kw('Investigate', '701.16', 'action'),
  kw('Goad', '701.15', 'action'),
  kw('Mill', '701.17', 'action'),
  kw('The Ring Tempts You', '701.54', 'action'),
  kw('Manifest', '701.40', 'action'),
  kw('Manifest Dread', '701.62', 'action'),
  kw('Exile', '701.13', 'action'),
  kw('Sacrifice', '701.21', 'action'),
  kw('Transform', '701.28', 'action'),
  kw('∞ (Infinity)', '702.185'),
];

const matcher = buildKeywordMatcher(GLOSSARY);

/** Rules text with each linked keyword in brackets: "[Flying] (This creature …)". */
function show(text: string, names: string[] = []): string {
  const mark = (s: OracleSegment) => (s.kind === 'keyword' ? `[${s.text}]` : s.text);
  return segmentOracle(text, matcher, names)
    .map((line) => line.map(mark).join(''))
    .join('\n');
}

const linked = (text: string, names: string[] = []) =>
  segmentOracle(text, matcher, names)
    .flat()
    .flatMap((s) => (s.kind === 'keyword' ? [s.entry.name] : []));

describe('segmentOracle', () => {
  it('links a keyword a card grants, not only one it has (Samut, Tyrant of Naktamun)', () => {
    expect(
      show(
        "Instant and sorcery spells you control have split second. (As long as a spell with split second is on the stack, players can't cast spells or activate abilities that aren't mana abilities.)",
        ['Samut, Tyrant of Naktamun']
      )
    ).toBe(
      "Instant and sorcery spells you control have [split second]. (As long as a spell with split second is on the stack, players can't cast spells or activate abilities that aren't mana abilities.)"
    );
  });

  it('keeps reminder text as its own segment and never links inside it (Storm Crow)', () => {
    const [line] = segmentOracle(
      "Flying (This creature can't be blocked except by creatures with flying or reach.)",
      matcher,
      ['Storm Crow']
    );
    expect(line.map((s) => s.kind)).toEqual(['keyword', 'text', 'reminder']);
    expect(line[2].text).toBe(
      "(This creature can't be blocked except by creatures with flying or reach.)"
    );
  });

  it('links every keyword on a keyword line, longest name first (Akroma, Angel of Wrath)', () => {
    expect(
      show('Flying, first strike, vigilance, trample, haste, protection from black and from red')
    ).toBe(
      '[Flying], [first strike], [vigilance], [trample], [haste], [protection] from black and from red'
    );
  });

  it('links a keyword once per card, the first time (Emrakul, the Promised End)', () => {
    const text =
      "This spell costs {1} less to cast for each card type among cards in your graveyard.\nWhen you cast this spell, you gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn.\nFlying, trample, protection from instants";
    expect(linked(text)).toEqual(['Flying', 'Trample', 'Protection']);
    // "Flying" and then "creatures with flying" on one face: one link.
    expect(linked('Flying\nOther creatures you control with flying get +1/+1.')).toEqual([
      'Flying',
    ]);
  });

  it('does not find a keyword inside a longer word', () => {
    // Think Twice: flashback is its own keyword, not flash + "back".
    expect(
      show(
        'Draw a card.\nFlashback {2}{U} (You may cast this card from your graveyard for its flashback cost. Then exile it.)'
      )
    ).toBe(
      'Draw a card.\n[Flashback] {2}{U} (You may cast this card from your graveyard for its flashback cost. Then exile it.)'
    );
    expect(linked('Prevent the next X damage that would be dealt toward the reward.')).toEqual([]);
  });

  it("never reads the card's own name as a keyword", () => {
    // Arrow Storm has no storm.
    expect(
      linked(
        "Arrow Storm deals 4 damage to any target.\nRaid — If you attacked this turn, instead Arrow Storm deals 5 damage to that permanent or player and the damage can't be prevented.",
        ['Arrow Storm']
      )
    ).toEqual([]);
    // A legendary is its short name in its own text: "Annie Flash" is not flash,
    // but the Flash on the line above is.
    expect(
      show(
        'Flash\nWhen Annie Flash enters, if you cast it, return target permanent card with mana value 3 or less from your graveyard to the battlefield tapped.',
        ['Annie Flash, the Veteran']
      )
    ).toMatch(/^\[Flash\]\nWhen Annie Flash enters/);
    // Comet Storm: multikicker links, the name does not.
    expect(
      linked(
        'Multikicker {1} (You may pay an additional {1} any number of times as you cast this spell.)\nChoose any target, then choose another target for each time this spell was kicked. Comet Storm deals X damage to each of them.',
        ['Comet Storm']
      )
    ).toEqual(['Kicker']);
  });

  it('reads the printed variants of a keyword as that keyword', () => {
    // Lord of Atlantis
    expect(linked('Other Merfolk get +1/+1 and have islandwalk.')).toEqual(['Landwalk']);
    // Ash Barrens
    expect(show('{T}: Add {C}.\nBasic landcycling {1}')).toBe(
      '{T}: Add {C}.\nBasic [landcycling] {1}'
    );
    // Brutal Cathar // Moonrage Brute, both faces
    expect(
      linked(
        'Daybound (If a player casts no spells during their own turn, it becomes night next turn.)'
      )
    ).toEqual(['Daybound and Nightbound']);
    expect(linked('First strike\nWard—Pay 3 life.\nNightbound')).toEqual([
      'First Strike',
      'Ward',
      'Daybound and Nightbound',
    ]);
  });

  it('reads a keyword action however the sentence conjugates it', () => {
    // Opt, Tireless Tracker, Thoughtbound Phantasm, Stitcher's Supplier, Disrupt Decorum
    expect(
      linked(
        'Scry 1. (Look at the top card of your library. You may put that card on the bottom.)\nDraw a card.'
      )
    ).toEqual(['Scry']);
    expect(linked('Landfall — Whenever a land you control enters, investigate.')).toEqual([
      'Investigate',
    ]);
    expect(linked('Defender\nWhenever you surveil, put a +1/+1 counter on this creature.')).toEqual(
      ['Defender', 'Surveil']
    );
    expect(linked('When this creature enters or dies, mill three cards.')).toEqual(['Mill']);
    expect(linked("Goad all creatures you don't control.")).toEqual(['Goad']);
    expect(linked('Target opponent scries 2, then mills a card.')).toEqual(['Scry', 'Mill']);
    // Call of the Ring
    expect(linked('At the beginning of your upkeep, the Ring tempts you.')).toEqual([
      'The Ring Tempts You',
    ]);
    // Longest action wins at the same position.
    expect(linked('Manifest dread.')).toEqual(['Manifest Dread']);
  });

  it('leaves the everyday verbs of rules text alone', () => {
    // Grim Lavamancer
    expect(
      linked(
        '{R}, {T}, Exile two cards from your graveyard: This creature deals 2 damage to any target.'
      )
    ).toEqual([]);
    expect(linked('Sacrifice a creature, then transform this artifact.')).toEqual([]);
  });

  it('does not offer a keyword whose name cannot be printed in a sentence', () => {
    expect(matcher.entries.some((e) => e.name.startsWith('∞'))).toBe(false);
  });

  it('keeps crew, indestructible and friends as plain keyword links (Esika’s Chariot, Boromir)', () => {
    expect(linked('Crew 4')).toEqual(['Crew']);
    expect(
      linked(
        'Sacrifice Boromir: Creatures you control gain indestructible until end of turn. The Ring tempts you.',
        ['Boromir, Warden of the Tower']
      )
    ).toEqual(['Indestructible', 'The Ring Tempts You']);
  });

  it('returns the text unlinked while there is no matcher', () => {
    expect(segmentOracle('Flying (reminder)\nHaste', null)).toEqual([
      [
        { kind: 'text', text: 'Flying ' },
        { kind: 'reminder', text: '(reminder)' },
      ],
      [{ kind: 'text', text: 'Haste' }],
    ]);
  });
});

describe('loadKeywordMatcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('retries after a failed load instead of caching the failure', async () => {
    const { loadKeywordMatcher: load } = await import('./keyword-glossary');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ meta: { effective: 'x' }, keywords: GLOSSARY }))
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(load()).rejects.toThrow("Couldn't load the keyword glossary.");
    const m = await load();
    expect(m.entries.length).toBeGreaterThan(0);
    // Loaded once, it is kept.
    expect(await load()).toBe(m);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is exported for the card text to share one load', () => {
    expect(typeof loadKeywordMatcher).toBe('function');
  });
});
