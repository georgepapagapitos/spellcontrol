# Commander-eligible binder rule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single "Commander" rule to binder filters that matches commander-eligible cards (legendary creatures _or_ cards whose text says "can be your commander", legal in Commander) — including planeswalker-commanders that current rules miss.

**Architecture:** Extract the existing `isValidCommander` logic into a shape-agnostic core (`isCommanderEligibleFrom`) so the deck-builder (`ScryfallCard`) and binder (`EnrichedCard`) paths share one definition and cannot drift. Add an optional tri-state `commanderEligible?: boolean` field to `BinderFilter`, wire it through the compile/match hot path in `lib/rules.ts`, and surface it in `BinderEditor` via the editor's existing radiogroup-pill pattern. Frontend-only; no DB/migration.

**Tech Stack:** React 18 + TypeScript, Zustand, Vitest. Spec: `docs/superpowers/specs/2026-05-18-commander-eligible-binder-rule-design.md`.

---

## File Structure

- `frontend/src/lib/commanders.ts` — **modify.** Add `isCommanderEligibleFrom` (core) and `isCommanderEligible(EnrichedCard)`; refactor `isValidCommander` to delegate. One responsibility: the commander-eligibility predicate, for every card shape.
- `frontend/src/lib/commanders.test.ts` — **modify.** Extend with core + EnrichedCard cases; keep existing `isValidCommander` cases green (proves no behavior drift).
- `frontend/src/types/index.ts` — **modify.** Add `commanderEligible?: boolean` to `BinderFilter` (interface at line 219; field added after `borderColors` at line 247).
- `frontend/src/lib/rules.ts` — **modify.** Thread the flag through `CompiledFilter`, `compileFilter`, `cardMatchesCompiled`, `isFilterEmpty`.
- `frontend/src/lib/rules.test.ts` — **modify.** New `describe` block for the commander-eligible matcher; uses the existing `makeCard` helper (line 38).
- `frontend/src/components/BinderEditor.tsx` — **modify.** Add one `rule-row` with a 3-pill radiogroup near the Oracle-text row (~line 1281), reusing the `binder-mode-toggle`/`binder-mode-pill` pattern (lines 654-679).
- `README.md` — **modify.** Add the new "Commander" field to the rule-fields list.

---

### Task 1: Shared commander-eligibility core + EnrichedCard helper

**Files:**

- Modify: `frontend/src/lib/commanders.ts`
- Test: `frontend/src/lib/commanders.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these to `frontend/src/lib/commanders.test.ts` (after the closing `});` of the `isValidCommander` describe block, line 69). Also update the import on line 2 from `import { isValidCommander } from './commanders';` to:

```ts
import { isValidCommander, isCommanderEligibleFrom, isCommanderEligible } from './commanders';
import type { EnrichedCard } from '../types';
```

Append:

```ts
describe('isCommanderEligibleFrom', () => {
  it('accepts a commander-legal legendary creature', () => {
    expect(isCommanderEligibleFrom('Legendary Creature — Elf', '', 'legal')).toBe(true);
  });

  it('accepts a planeswalker whose text says "can be your commander"', () => {
    expect(
      isCommanderEligibleFrom(
        'Legendary Planeswalker — Daretti',
        'Daretti can be your commander.',
        'legal'
      )
    ).toBe(true);
  });

  it('accepts restricted as eligible', () => {
    expect(isCommanderEligibleFrom('Legendary Creature — God', '', 'restricted')).toBe(true);
  });

  it('rejects a legendary creature banned in commander', () => {
    expect(isCommanderEligibleFrom('Legendary Creature — Human', '', 'banned')).toBe(false);
  });

  it('rejects a legendary creature with no commander legality', () => {
    expect(isCommanderEligibleFrom('Legendary Creature — Human', '', undefined)).toBe(false);
  });

  it('rejects a non-legendary card with no commander clause', () => {
    expect(isCommanderEligibleFrom('Creature — Beast', 'flying', 'legal')).toBe(false);
  });

  it('is case-insensitive on type and text', () => {
    expect(isCommanderEligibleFrom('LEGENDARY CREATURE — DRAGON', '', 'legal')).toBe(true);
    expect(isCommanderEligibleFrom('planeswalker', 'X CAN BE YOUR COMMANDER.', 'legal')).toBe(true);
  });
});

describe('isCommanderEligible (EnrichedCard)', () => {
  function ec(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
    return {
      copyId: 'c1',
      name: 'Test',
      setCode: 'tst',
      setName: 'Test',
      collectorNumber: '1',
      rarity: 'mythic',
      scryfallId: 'sf1',
      purchasePrice: 0,
      sourceCategory: '',
      sourceFormat: 'plain',
      finish: 'nonfoil',
      foil: false,
      typeLine: 'Legendary Creature — Human',
      oracleText: '',
      legalities: { commander: 'legal' },
      ...overrides,
    } as EnrichedCard;
  }

  it('accepts a commander-legal legendary creature', () => {
    expect(isCommanderEligible(ec())).toBe(true);
  });

  it('accepts a planeswalker-commander via oracle text', () => {
    expect(
      isCommanderEligible(
        ec({
          typeLine: 'Legendary Planeswalker — Teferi',
          oracleText: 'teferi can be your commander.',
        })
      )
    ).toBe(true);
  });

  it('rejects a banned legend', () => {
    expect(isCommanderEligible(ec({ legalities: { commander: 'banned' } }))).toBe(false);
  });

  it('rejects a vanilla creature', () => {
    expect(isCommanderEligible(ec({ typeLine: 'Creature — Bear', oracleText: '' }))).toBe(false);
  });

  it('rejects when type/oracle/legality are missing', () => {
    expect(
      isCommanderEligible(ec({ typeLine: undefined, oracleText: undefined, legalities: undefined }))
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix frontend -- src/lib/commanders.test.ts`
Expected: FAIL — `isCommanderEligibleFrom`/`isCommanderEligible` are not exported (TypeScript / import error).

- [ ] **Step 3: Refactor `commanders.ts` to add the core and delegate**

Replace the **entire contents** of `frontend/src/lib/commanders.ts` with:

```ts
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types';

/**
 * Shape-agnostic commander-eligibility core. A card is commander-eligible
 * iff it is a legendary creature (or its text declares "can be your
 * commander") AND it is legal/restricted in the Commander format.
 *
 * Every card-shaped caller (deck-builder ScryfallCard, binder EnrichedCard)
 * funnels through this so the two definitions cannot drift.
 */
export function isCommanderEligibleFrom(
  typeLine: string,
  oracleText: string,
  commanderLegality: string | undefined
): boolean {
  const tl = typeLine.toLowerCase();
  const ot = oracleText.toLowerCase();
  const isLegendaryCreature = tl.includes('legendary') && tl.includes('creature');
  const canBeCommander = ot.includes('can be your commander');
  if (!isLegendaryCreature && !canBeCommander) return false;
  return commanderLegality === 'legal' || commanderLegality === 'restricted';
}

/**
 * True if the card is a legal commander: a legendary creature (or a card
 * whose text declares "can be your commander") that is legal in the
 * Commander format on Scryfall.
 */
export function isValidCommander(card: ScryfallCard): boolean {
  const typeLine = card.type_line ?? card.card_faces?.[0]?.type_line ?? '';
  const oracleText =
    card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text ?? '').join(' ') ?? '';
  return isCommanderEligibleFrom(typeLine, oracleText, card.legalities?.commander);
}

/**
 * Binder-path commander-eligibility check over an EnrichedCard. `typeLine` /
 * `oracleText` already join multi-face cards (per their type docs);
 * `oracleText` is stored lowercased but the core lowercases defensively.
 * Missing fields → not eligible.
 */
export function isCommanderEligible(card: EnrichedCard): boolean {
  return isCommanderEligibleFrom(
    card.typeLine ?? '',
    card.oracleText ?? '',
    card.legalities?.commander
  );
}
```

Note: behavior of `isValidCommander` is preserved exactly — the original lowercased after the face-join; the core lowercases the same joined strings.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix frontend -- src/lib/commanders.test.ts`
Expected: PASS — all new cases plus the **7 original `isValidCommander` cases still green** (no drift).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/commanders.ts frontend/src/lib/commanders.test.ts
git commit -m "refactor(commanders): extract shape-agnostic eligibility core + EnrichedCard helper"
```

---

### Task 2: Add `commanderEligible` to the `BinderFilter` type

**Files:**

- Modify: `frontend/src/types/index.ts` (interface `BinderFilter`, ends at line 248)

- [ ] **Step 1: Add the field**

In `frontend/src/types/index.ts`, inside `interface BinderFilter`, immediately after the `borderColors?: ChipExpression;` line (line 247), add:

```ts
  /**
   * Commander-eligibility constraint. undefined = no constraint;
   * true = card must be commander-eligible; false = must NOT be.
   * "Commander-eligible" = legendary creature OR oracle text contains
   * "can be your commander", AND legal/restricted in Commander
   * (see lib/commanders.ts:isCommanderEligible).
   */
  commanderEligible?: boolean;
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS (no errors; optional field is backward compatible).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat(types): add optional commanderEligible to BinderFilter"
```

---

### Task 3: Thread `commanderEligible` through the matcher

**Files:**

- Modify: `frontend/src/lib/rules.ts`
- Test: `frontend/src/lib/rules.test.ts`

- [ ] **Step 1: Write the failing tests**

In `frontend/src/lib/rules.test.ts`, the imports start at line 2 (`import { ... } from ...`) and `import type { EnrichedCard, BinderFilter, ChipExpression } from '../types';` is line 9. Ensure `cardMatchesFilter`, `compileFilter`, `cardMatchesCompiled`, and `isFilterEmpty` are among the imported names from `'./rules'` (add any missing ones to that existing import list). Append this `describe` block to the end of the file (it uses the existing `makeCard` helper, line 38):

```ts
describe('commanderEligible filter', () => {
  const legend = makeCard({
    typeLine: 'Legendary Creature — Human Wizard',
    oracleText: '',
    legalities: { commander: 'legal' },
  });
  const pwCommander = makeCard({
    typeLine: 'Legendary Planeswalker — Daretti',
    oracleText: 'daretti can be your commander.',
    legalities: { commander: 'legal' },
  });
  const bannedLegend = makeCard({
    typeLine: 'Legendary Creature — Human',
    oracleText: '',
    legalities: { commander: 'banned' },
  });
  const vanilla = makeCard({
    typeLine: 'Creature — Bear',
    oracleText: '',
    legalities: { commander: 'legal' },
  });

  it('true matches legendary creatures and planeswalker-commanders', () => {
    const f: BinderFilter = { commanderEligible: true };
    expect(cardMatchesFilter(legend, f)).toBe(true);
    expect(cardMatchesFilter(pwCommander, f)).toBe(true);
  });

  it('true rejects banned legends and vanilla creatures', () => {
    const f: BinderFilter = { commanderEligible: true };
    expect(cardMatchesFilter(bannedLegend, f)).toBe(false);
    expect(cardMatchesFilter(vanilla, f)).toBe(false);
  });

  it('false inverts the match', () => {
    const f: BinderFilter = { commanderEligible: false };
    expect(cardMatchesFilter(legend, f)).toBe(false);
    expect(cardMatchesFilter(vanilla, f)).toBe(true);
  });

  it('undefined imposes no constraint', () => {
    const f: BinderFilter = {};
    expect(cardMatchesFilter(legend, f)).toBe(true);
    expect(cardMatchesFilter(vanilla, f)).toBe(true);
  });

  it('compileFilter round-trips the flag', () => {
    expect(compileFilter({ commanderEligible: true }).commanderEligible).toBe(true);
    expect(compileFilter({ commanderEligible: false }).commanderEligible).toBe(false);
    expect(compileFilter({}).commanderEligible).toBeUndefined();
  });

  it('isFilterEmpty is false when only commanderEligible is set', () => {
    expect(isFilterEmpty({ commanderEligible: true })).toBe(false);
    expect(isFilterEmpty({ commanderEligible: false })).toBe(false);
    expect(isFilterEmpty({})).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix frontend -- src/lib/rules.test.ts`
Expected: FAIL — `compileFilter(...).commanderEligible` is `undefined` and `isFilterEmpty({ commanderEligible: true })` returns `true` (logic not wired yet).

- [ ] **Step 3: Add the import to `rules.ts`**

In `frontend/src/lib/rules.ts`, after line 2 (`import { getColorKey } from './colors';`) add:

```ts
import { isCommanderEligible } from './commanders';
```

- [ ] **Step 4: Add `commanderEligible` to `CompiledFilter`**

In the `interface CompiledFilter` block, after the line `edhrecRankMax?: number;` (line 35) add:

```ts
  commanderEligible?: boolean;
```

- [ ] **Step 5: Copy the flag through `compileFilter`**

In `compileFilter`, immediately before `return out;` (currently line 66), add:

```ts
if (filter.commanderEligible !== undefined) out.commanderEligible = filter.commanderEligible;
```

- [ ] **Step 6: Apply the constraint in `cardMatchesCompiled`**

In `cardMatchesCompiled`, immediately before the final `return true;` (currently line 128), add:

```ts
if (f.commanderEligible !== undefined) {
  if (isCommanderEligible(card) !== f.commanderEligible) return false;
}
```

- [ ] **Step 7: Make `isFilterEmpty` account for the flag**

In `isFilterEmpty`, the return expression currently ends with `filter.edhrecRankMax === undefined` followed by `);`. Change that last condition to also require the new flag to be unset:

```ts
    filter.edhrecRankMax === undefined &&
    filter.commanderEligible === undefined
  );
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test --prefix frontend -- src/lib/rules.test.ts src/lib/commanders.test.ts`
Expected: PASS — all new commanderEligible cases plus the entire existing rules suite stay green.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/rules.ts frontend/src/lib/rules.test.ts
git commit -m "feat(rules): match binder cards on commander-eligibility"
```

---

### Task 4: Surface the rule in `BinderEditor`

**Files:**

- Modify: `frontend/src/components/BinderEditor.tsx`

The rule fields are rendered as `rule-row` blocks in the filter editor (`filter` and `patch` are in scope; `patch` is `onPatch`, wired to `patchFilter` which shallow-merges into `g.filter`). The Oracle-text row ends around line 1281. The reusable pill pattern is the `role="radiogroup"` / `role="radio"` + `binder-mode-toggle` / `binder-mode-pill` group at lines 654-679.

- [ ] **Step 1: Add the Commander rule-row**

In `frontend/src/components/BinderEditor.tsx`, immediately **after** the closing `</div>` of the `{/* Oracle text */}` `rule-row` block (the block that renders `filter.oracleChips`, ends ~line 1281) and **before** the `{/* Sets */}` block, insert:

```tsx
{
  /* Commander eligibility */
}
<div className="rule-row">
  <span
    className="rule-label has-tooltip"
    title="Matches legal commanders: legendary creatures and cards that say 'can be your commander' (e.g. planeswalker-commanders), legal in the Commander format."
  >
    Commander <span className="tooltip-marker">ⓘ</span>
  </span>
  <div className="binder-mode-toggle" role="radiogroup" aria-label="Commander eligibility">
    <button
      type="button"
      role="radio"
      aria-checked={filter.commanderEligible === undefined}
      className={`binder-mode-pill${filter.commanderEligible === undefined ? ' active' : ''}`}
      onClick={() => patch({ commanderEligible: undefined })}
    >
      Any
    </button>
    <button
      type="button"
      role="radio"
      aria-checked={filter.commanderEligible === true}
      className={`binder-mode-pill${filter.commanderEligible === true ? ' active' : ''}`}
      onClick={() => patch({ commanderEligible: true })}
    >
      Is
    </button>
    <button
      type="button"
      role="radio"
      aria-checked={filter.commanderEligible === false}
      className={`binder-mode-pill${filter.commanderEligible === false ? ' active' : ''}`}
      onClick={() => patch({ commanderEligible: false })}
    >
      Is not
    </button>
  </div>
</div>;
```

- [ ] **Step 2: Verify typecheck, lint, and format**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: PASS. (If `format:check` flags the new block, run `npm run format` and re-stage.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/BinderEditor.tsx
git commit -m "feat(binder-editor): add Commander eligibility rule pill"
```

---

### Task 5: Document the new rule field in the README

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Locate the rule-fields list**

Run: `grep -n -i "oracle\|type line\|rule field\|legalit" README.md | head`
This finds the section that enumerates binder rule fields (the canonical reference per `CLAUDE.md`).

- [ ] **Step 2: Add the Commander entry**

In that list, add an entry adjacent to the existing type/oracle entries, matching the surrounding markdown style (bullet vs. table row — mirror whatever the neighboring fields use). Content:

> **Commander** — Any / Is / Is not. "Is" matches commander-eligible cards: legendary creatures, plus cards whose text says "can be your commander" (planeswalker-commanders), that are legal in the Commander format. "Is not" matches everything else.

- [ ] **Step 3: Verify formatting**

Run: `npm run format:check`
Expected: PASS. (If it flags README, run `npm run format` and re-stage.)

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document the Commander binder rule field"
```

---

### Task 6: Full verification

- [ ] **Step 1: Run the full frontend gate**

Run: `npm run typecheck && npm run lint && npm run format:check && npm test --prefix frontend`
Expected: All PASS. `src/lib/**` coverage stays ≥ 80% (new logic in `commanders.ts`/`rules.ts` is fully covered by Tasks 1 & 3).

- [ ] **Step 2: Confirm no backend impact**

Run: `grep -rn "cardMatchesFilter\|cardMatchesCompiled\|BinderFilter\|isCommanderEligible" backend/src 2>/dev/null || echo "no backend references — frontend-only as designed"`
Expected: `no backend references` (binder matching is frontend-only; nothing to mirror).

- [ ] **Step 3: Final state check**

Run: `git log --oneline origin/main..HEAD` and `git status --short`
Expected: clean working tree; commits for the spec, plan, and Tasks 1-5 present. Hand off to `superpowers:finishing-a-development-branch`.

---

## Self-Review

**1. Spec coverage:**

- Shared predicate (spec §1) → Task 1 ✓
- Data model `commanderEligible?` (spec §2) → Task 2 ✓
- Matching: CompiledFilter / compileFilter / cardMatchesCompiled / isFilterEmpty (spec §3) → Task 3 ✓
- UI tri-state pill reusing `binder-mode-pill` (spec §4) → Task 4 ✓
- Tests for commanders + rules, coverage ≥80% (spec §5) → Tasks 1, 3, 6 ✓
- README rule-fields update (spec §6) → Task 5 ✓
- Out-of-scope / no-backend (spec) → Task 6 Step 2 verifies ✓
- No gaps.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step contains complete code. README step intentionally mirrors neighboring markdown style because the file's list format isn't pinned here — content text is fully specified.

**3. Type consistency:** `isCommanderEligibleFrom(typeLine, oracleText, commanderLegality)`, `isCommanderEligible(EnrichedCard)`, `commanderEligible?: boolean` are spelled identically across Tasks 1-4 and the test code. `patch` matches the in-file alias of `patchFilter` (shallow-merge → `commanderEligible: undefined` key-present-but-undefined satisfies the `=== undefined` checks). Existing `makeCard` (rules.test.ts:38) and `card`/new `ec` helpers (commanders.test.ts) used consistently.
