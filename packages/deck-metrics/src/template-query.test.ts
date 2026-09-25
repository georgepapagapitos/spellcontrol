import { describe, it, expect } from 'vitest';
import {
  evaluateTemplate,
  resolveComboTemplates,
  EMPTY_ORACLE_TAGS,
  type TemplateCard,
  type OracleTagLookup,
} from './template-query';

// Real cards, minimal fields — the shape both apps' ScryfallCard satisfy.
const SOL_RING: TemplateCard = {
  name: 'Sol Ring',
  mana_cost: '{1}',
  cmc: 1,
  type_line: 'Artifact',
  oracle_text: '{T}: Add {C}{C}.',
  colors: [],
  keywords: [],
};
const MOX_AMBER: TemplateCard = {
  name: 'Mox Amber',
  mana_cost: '{0}',
  cmc: 0,
  type_line: 'Legendary Artifact',
  oracle_text: 'Mox Amber enters the battlefield tapped unless you control a legendary creature.',
  colors: [],
  keywords: [],
};
const ORNITHOPTER: TemplateCard = {
  name: 'Ornithopter',
  mana_cost: '{0}',
  cmc: 0,
  type_line: 'Artifact Creature — Thopter',
  oracle_text: 'Flying',
  colors: [],
  keywords: ['Flying'],
  power: '0',
  toughness: '2',
};
const LIGHTNING_BOLT: TemplateCard = {
  name: 'Lightning Bolt',
  mana_cost: '{R}',
  cmc: 1,
  type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  colors: ['R'],
  keywords: [],
};
const FOREST: TemplateCard = {
  name: 'Forest',
  type_line: 'Basic Land — Forest',
  cmc: 0,
  colors: [],
  keywords: [],
};

describe('evaluateTemplate — real Spellbook template queries', () => {
  // Template 46, "Permanent Castable for {C}": id 5034--46 (Hullbreaker
  // Horror + Sol Ring) is exactly this template.
  const CASTABLE_FOR_C = 'mv<=1 (mana={0} or mana={1} or mana={C}) is:permanent';

  it('Sol Ring, Mox Amber and Ornithopter all match "Permanent Castable for {C}"', () => {
    expect(evaluateTemplate(CASTABLE_FOR_C, SOL_RING, EMPTY_ORACLE_TAGS)).toBe(true);
    expect(evaluateTemplate(CASTABLE_FOR_C, MOX_AMBER, EMPTY_ORACLE_TAGS)).toBe(true);
    expect(evaluateTemplate(CASTABLE_FOR_C, ORNITHOPTER, EMPTY_ORACLE_TAGS)).toBe(true);
  });

  it('a card that fails: Lightning Bolt is not a permanent', () => {
    expect(evaluateTemplate(CASTABLE_FOR_C, LIGHTNING_BOLT, EMPTY_ORACLE_TAGS)).toBe(false);
  });

  it('an unsupported clause (Scryfall produces:) reads null, never a false match', () => {
    // Real template query (id 141): "t:forest produces:U".
    const r = evaluateTemplate('t:forest produces:U', FOREST, EMPTY_ORACLE_TAGS);
    expect(r).toBeNull();
  });

  it('a null/empty query (the template has none) is always null', () => {
    expect(evaluateTemplate(null, SOL_RING, EMPTY_ORACLE_TAGS)).toBeNull();
    expect(evaluateTemplate(undefined, SOL_RING, EMPTY_ORACLE_TAGS)).toBeNull();
    expect(evaluateTemplate('', SOL_RING, EMPTY_ORACLE_TAGS)).toBeNull();
  });

  it('the unsupported m<{0} operator (11 real templates use it) reads null, not true', () => {
    // Real template query (id 44), "Artifact Castable for {0} that survives".
    const q = 't:artifact (mv=0 or otag:potentially-free) (-t:creature or toughness>0) -m<{0}';
    expect(evaluateTemplate(q, MOX_AMBER, EMPTY_ORACLE_TAGS)).toBeNull();
  });

  it('nested parens + OR + negation: "Ally Creature" (kw:changeling or t:ally) t:creature', () => {
    const q = '(kw:changeling or t:ally) t:creature';
    const ally: TemplateCard = {
      name: 'Kabira Vindicator',
      type_line: 'Creature — Kor Ally',
      cmc: 2,
    };
    const changeling: TemplateCard = {
      name: 'Mistform Ultimus',
      type_line: 'Creature — Shapeshifter',
      cmc: 4,
      keywords: ['Changeling'],
    };
    const neither: TemplateCard = { name: 'Grizzly Bears', type_line: 'Creature — Bear', cmc: 2 };
    expect(evaluateTemplate(q, ally, EMPTY_ORACLE_TAGS)).toBe(true);
    expect(evaluateTemplate(q, changeling, EMPTY_ORACLE_TAGS)).toBe(true);
    expect(evaluateTemplate(q, neither, EMPTY_ORACLE_TAGS)).toBe(false);
  });

  it('explicit "and" keyword parses the same as implicit AND (id 195, repeatable-lifegain query)', () => {
    const q =
      'otag:repeatable-lifegain and (-o:"at the beginning of your second main phase" -o:"end step" and ((o:lifelink power>1 -otag:gains-lifelink) or (-o:lifelink (-o:"1 life" or o:"1 life for each"))))';
    const tags: OracleTagLookup = {
      isKnownTag: (t) => t === 'repeatable-lifegain' || t === 'gains-lifelink',
      hasTag: (name, t) => t === 'repeatable-lifegain' && name === 'Test Lifegainer',
    };
    const card: TemplateCard = {
      name: 'Test Lifegainer',
      type_line: 'Creature — Cleric',
      oracle_text: 'Whenever you gain life, draw a card.',
      cmc: 3,
      power: '2',
      toughness: '2',
      keywords: [],
    };
    expect(evaluateTemplate(q, card, tags)).toBe(true);
  });

  it('~ in an oracle-text clause means "this card\'s own name"', () => {
    const chamberSentry: TemplateCard = {
      name: 'Chamber Sentry',
      type_line: 'Artifact Creature — Construct',
      oracle_text:
        'As Chamber Sentry enters the battlefield, choose a color.\nChamber Sentry enters tapped.',
      cmc: 2,
      power: '0',
      toughness: '0',
    };
    expect(evaluateTemplate('o:"~ enters tapped"', chamberSentry, EMPTY_ORACLE_TAGS)).toBe(true);
    expect(evaluateTemplate('o:"~ enters untapped"', chamberSentry, EMPTY_ORACLE_TAGS)).toBe(false);
  });

  it('a /regex/ oracle clause (id "Any land that taps for one mana")', () => {
    const q =
      'o:/^{T}: Add / -o:"~ enters tapped" -o:"spend this mana only to" -t:land (t:artifact -t:creature or t:creature keyword:haste)';
    const hasteRock: TemplateCard = {
      name: 'Fast Rock',
      type_line: 'Artifact',
      oracle_text: '{T}: Add one mana of any color.',
      cmc: 1,
      keywords: [],
    };
    expect(evaluateTemplate(q, hasteRock, EMPTY_ORACLE_TAGS)).toBe(true);
    const wrongText: TemplateCard = {
      name: 'Slow Rock',
      type_line: 'Artifact',
      oracle_text: 'Tap: Add one mana of any color.',
      cmc: 1,
      keywords: [],
    };
    expect(evaluateTemplate(q, wrongText, EMPTY_ORACLE_TAGS)).toBe(false);
  });

  it('otag: reads null when the tag is unknown to the injected corpus, else checks membership', () => {
    const dork: TemplateCard = {
      name: 'Llanowar Elves',
      type_line: 'Creature — Elf Druid',
      cmc: 1,
    };
    expect(evaluateTemplate('otag:mana-dork', dork, EMPTY_ORACLE_TAGS)).toBeNull();

    const knowsManaDork: OracleTagLookup = {
      isKnownTag: (t) => t === 'mana-dork',
      hasTag: (name, t) => t === 'mana-dork' && name === 'Llanowar Elves',
    };
    expect(evaluateTemplate('otag:mana-dork', dork, knowsManaDork)).toBe(true);
    expect(
      evaluateTemplate(
        'otag:mana-dork',
        { name: 'Grizzly Bears', type_line: 'Creature' },
        knowsManaDork
      )
    ).toBe(false);
  });

  it('mana={X}{X} exact multiset match', () => {
    const card: TemplateCard = { name: 'Stroke of Genius', mana_cost: '{X}{X}{U}', cmc: 2 };
    expect(evaluateTemplate('mana:{X}{X}', card, EMPTY_ORACLE_TAGS)).toBe(true);
    expect(evaluateTemplate('mana={X}{X}', card, EMPTY_ORACLE_TAGS)).toBe(false); // has {U} too
  });

  it('c=c / c=0 / color=colorless all mean colorless', () => {
    const colorless: TemplateCard = {
      name: 'Karn, Scion of Urza',
      type_line: 'Legendary Planeswalker',
      cmc: 4,
      colors: [],
    };
    expect(evaluateTemplate('c=c', colorless, EMPTY_ORACLE_TAGS)).toBe(true);
    expect(evaluateTemplate('c=0', colorless, EMPTY_ORACLE_TAGS)).toBe(true);
    expect(evaluateTemplate('color=colorless', colorless, EMPTY_ORACLE_TAGS)).toBe(true);
    const green: TemplateCard = { name: 'Llanowar Elves', cmc: 1, colors: ['G'] };
    expect(evaluateTemplate('c=c', green, EMPTY_ORACLE_TAGS)).toBe(false);
    expect(evaluateTemplate('c:g', green, EMPTY_ORACLE_TAGS)).toBe(true);
  });

  it('pow/tou comparisons; an unparseable "*" power reads null, not false', () => {
    expect(evaluateTemplate('pow>=3', { name: 'X', cmc: 3, power: '4' }, EMPTY_ORACLE_TAGS)).toBe(
      true
    );
    expect(evaluateTemplate('pow>=3', { name: 'X', cmc: 3, power: '2' }, EMPTY_ORACLE_TAGS)).toBe(
      false
    );
    expect(
      evaluateTemplate('pow>=3', { name: 'X', cmc: 3, power: '*' }, EMPTY_ORACLE_TAGS)
    ).toBeNull();
  });

  it('is:dfc / is:tdfc / is:mdfc by layout', () => {
    const transform: TemplateCard = { name: 'A', cmc: 3, layout: 'transform' };
    const mdfc: TemplateCard = { name: 'B', cmc: 3, layout: 'modal_dfc' };
    expect(evaluateTemplate('is:dfc', transform, EMPTY_ORACLE_TAGS)).toBe(true);
    expect(evaluateTemplate('is:tdfc', transform, EMPTY_ORACLE_TAGS)).toBe(true);
    expect(evaluateTemplate('is:mdfc', transform, EMPTY_ORACLE_TAGS)).toBe(false);
    expect(evaluateTemplate('is:mdfc', mdfc, EMPTY_ORACLE_TAGS)).toBe(true);
    expect(evaluateTemplate('is:tdfc', mdfc, EMPTY_ORACLE_TAGS)).toBe(false);
  });

  it('!"exact name" and its negation', () => {
    expect(evaluateTemplate('!"Sol Ring"', SOL_RING, EMPTY_ORACLE_TAGS)).toBe(true);
    expect(evaluateTemplate('-!"Sol Ring"', SOL_RING, EMPTY_ORACLE_TAGS)).toBe(false);
    expect(evaluateTemplate('!"Sol Ring"', MOX_AMBER, EMPTY_ORACLE_TAGS)).toBe(false);
  });
});

describe('resolveComboTemplates', () => {
  const CASTABLE_FOR_C = 'mv<=1 (mana={0} or mana={1} or mana={C}) is:permanent';

  it('satisfied: a deck card not among the named pieces matches the template', () => {
    const r = resolveComboTemplates(
      [CASTABLE_FOR_C],
      ['Hullbreaker Horror'],
      [{ name: 'Hullbreaker Horror', type_line: 'Creature', cmc: 8 }, SOL_RING, LIGHTNING_BOLT],
      EMPTY_ORACLE_TAGS
    );
    expect(r.satisfied).toBe(true);
    expect(r.satisfyingCards).toEqual(['Sol Ring']);
  });

  it('unsatisfied: no deck card matches', () => {
    const r = resolveComboTemplates(
      [CASTABLE_FOR_C],
      ['Hullbreaker Horror'],
      [{ name: 'Hullbreaker Horror', type_line: 'Creature', cmc: 8 }, LIGHTNING_BOLT],
      EMPTY_ORACLE_TAGS
    );
    expect(r.satisfied).toBe(false);
    expect(r.satisfyingCards).toEqual([null]);
  });

  it("the combo's own named pieces never count as the satisfying card", () => {
    // Sol Ring itself matches the template's query, but it's a NAMED piece —
    // the deck needs a DIFFERENT permanent-for-{C}.
    const r = resolveComboTemplates([CASTABLE_FOR_C], ['Sol Ring'], [SOL_RING], EMPTY_ORACLE_TAGS);
    expect(r.satisfied).toBe(false);
  });

  it('two templates need two DISTINCT deck cards', () => {
    const r = resolveComboTemplates(
      [CASTABLE_FOR_C, CASTABLE_FOR_C],
      [],
      [SOL_RING, MOX_AMBER],
      EMPTY_ORACLE_TAGS
    );
    expect(r.satisfied).toBe(true);
    expect(new Set(r.satisfyingCards)).toEqual(new Set(['Sol Ring', 'Mox Amber']));
  });

  it('two templates with only one candidate card fail — no double-booking', () => {
    const r = resolveComboTemplates(
      [CASTABLE_FOR_C, CASTABLE_FOR_C],
      [],
      [SOL_RING, LIGHTNING_BOLT],
      EMPTY_ORACLE_TAGS
    );
    expect(r.satisfied).toBe(false);
    expect(r.satisfyingCards).toEqual([null, null]);
  });

  it('an explicit empty array (caller confirmed zero templates) is trivially satisfied', () => {
    expect(resolveComboTemplates([], [], [], EMPTY_ORACLE_TAGS)).toEqual({
      satisfied: true,
      satisfyingCards: [],
    });
  });

  it('null/undefined (no query data — could be "none" or stale ingest data) stays unresolved', () => {
    // Never trivially "satisfied": a comboId with Spellbook's `--` suffix
    // implies at least one template exists, and null here can't tell that
    // apart from a genuinely template-free combo.
    expect(resolveComboTemplates(null, [], [], EMPTY_ORACLE_TAGS).satisfied).toBe(false);
    expect(resolveComboTemplates(undefined, [], [], EMPTY_ORACLE_TAGS).satisfied).toBe(false);
  });

  it('a null query for one of several templates makes that one unsatisfiable', () => {
    const r = resolveComboTemplates([null], [], [SOL_RING], EMPTY_ORACLE_TAGS);
    expect(r.satisfied).toBe(false);
  });
});

describe('evaluateTemplate — input from Spellbook runs in bounded time', () => {
  it('compiles the anchored literal regexes Spellbook uses', () => {
    // Templates 13 and 42, verbatim.
    expect(evaluateTemplate('o:/^{T}:/', SOL_RING, EMPTY_ORACLE_TAGS)).toBe(true);
    const outlet: TemplateCard = {
      name: 'Goblin Bombardment',
      type_line: 'Enchantment',
      oracle_text: 'Sacrifice a Goblin: deals 1 damage to any target.',
      cmc: 2,
      keywords: [],
    };
    expect(evaluateTemplate('o:/^Sacrifice a Goblin:/', outlet, EMPTY_ORACLE_TAGS)).toBe(true);
    expect(evaluateTemplate('o:/^Sacrifice a Goblin:/', SOL_RING, EMPTY_ORACLE_TAGS)).toBe(false);
  });

  it('reads a regex with an open-ended repeat as unsupported, never compiling it', () => {
    // (a+)+$ is the classic catastrophic-backtracking shape.
    expect(evaluateTemplate('o:/^(a+)+$/', SOL_RING, EMPTY_ORACLE_TAGS)).toBeNull();
    expect(evaluateTemplate('o:/x*y/', SOL_RING, EMPTY_ORACLE_TAGS)).toBeNull();
    expect(evaluateTemplate('o:/a{2,}/', SOL_RING, EMPTY_ORACLE_TAGS)).toBeNull();
    // An escaped + is a literal, not a repeat.
    const plusOne: TemplateCard = { ...SOL_RING, oracle_text: 'Put a +1 counter on it.' };
    expect(evaluateTemplate('o:/\\+1/', plusOne, EMPTY_ORACLE_TAGS)).toBe(true);
  });

  it('scans a long run of unclosed braces in linear time', () => {
    const brace: TemplateCard = { ...SOL_RING, mana_cost: '{'.repeat(50_000) };
    const started = Date.now();
    expect(evaluateTemplate('is:hybrid', brace, EMPTY_ORACLE_TAGS)).toBe(false);
    evaluateTemplate(`mana:${'{'.repeat(50_000)}`, brace, EMPTY_ORACLE_TAGS);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
