# Commander-eligible binder rule — design

**Date:** 2026-05-18
**Branch:** `worktree-feat+commander-eligible-rule`
**Status:** Approved (pending spec review)

## Problem

A user wants a binder that holds _all of their possible commanders_. Today the
binder rule model has separate `typeChips` and `oracleChips` fields that AND
within a group and OR across groups. Capturing every legal commander therefore
requires hand-building two OR groups:

- Group A: `typeChips` = "legendary creature"
- Group B: `oracleChips` = "can be your commander" (the text on
  planeswalker-commanders like Daretti, Teferi, etc.)

This is fiddly and non-obvious, and there is no single, clean way to say
"commander-eligible." Planeswalker-commanders in particular are easy to miss
because they are not `Legendary Creature` typed.

## Goal

Add a first-class, single-control way to filter a binder to
commander-eligible cards, reusing the app's existing commander definition so
the binder path and the deck-builder path cannot drift.

## Definition of "commander-eligible"

Mirror the existing `frontend/src/lib/commanders.ts:isValidCommander()`:

> A card is commander-eligible iff
> **(it is a legendary creature** _OR_ **its oracle text contains
> "can be your commander")** _AND_ **it is legal/restricted in the Commander
> format.**

Requiring Commander-format legality (decided during brainstorming) excludes
banned legends, so the binder reflects cards that could _actually_ be run as a
commander.

## Approach (chosen)

A **dedicated tri-state field** on the binder filter — consistent with the
editor's existing IS / IS NOT idiom — backed by a shared eligibility predicate.

Rejected alternatives:

- _Preset button_ that fills two OR groups — leaves a brittle, hand-editable
  structure; doesn't reuse the canonical definition.
- _Generic intra-group OR_ of type/oracle chips — a much larger change to the
  rule model for a narrow need (YAGNI).

## Components & changes

### 1. Shared eligibility predicate — `frontend/src/lib/commanders.ts`

`isValidCommander()` currently only handles `ScryfallCard`. Extract the rule
into a low-level core so the two card shapes share one source of truth:

```ts
// Lower-level core — pure, shape-agnostic.
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
```

- `isValidCommander(card: ScryfallCard)` is refactored to extract its
  type/oracle/legality strings and delegate to `isCommanderEligibleFrom`.
  **Behavior unchanged** — covered by existing tests.
- New `isCommanderEligible(card: EnrichedCard): boolean` for the binder path.
  `EnrichedCard.oracleText` is already lowercased (per its type doc);
  `typeLine` and `legalities?.commander` are read directly. Missing
  `typeLine`/`oracleText`/`legalities` → treated as empty/undefined → not
  eligible (safe default).

### 2. Data model — `frontend/src/types/index.ts`

Add one optional field to `BinderFilter`:

```ts
/** Commander-eligibility constraint. undefined = no constraint;
 *  true = card must be commander-eligible; false = must NOT be. */
commanderEligible?: boolean;
```

Backward compatible: absent on every persisted binder today ⇒ no constraint.
No DB schema, no migration — `BinderFilter` rides existing zustand-persist /
IndexedDB / `sync.ts` JSON unchanged (binder rules are user data, serialized
as-is).

### 3. Matching — `frontend/src/lib/rules.ts`

- `CompiledFilter` gains `commanderEligible?: boolean`.
- `compileFilter`: copy `filter.commanderEligible` through when not
  `undefined`.
- `cardMatchesCompiled`: when `f.commanderEligible !== undefined`, require
  `isCommanderEligible(card) === f.commanderEligible`; otherwise no
  constraint. Placed alongside the other single-value checks.
- `isFilterEmpty`: return `false` when `filter.commanderEligible !==
undefined`, so a binder whose only rule is "commander-eligible" does not
  degrade to match-everything.

### 4. UI — `frontend/src/components/BinderEditor.tsx`

A new `rule-row` labeled **Commander**, tri-state, matching the editor's
IS / IS NOT idiom and existing control styling:

- **Any** (clears → `commanderEligible: undefined`)
- **IS commander** (`true`)
- **IS NOT commander** (`false`)

`ⓘ` tooltip (same `has-tooltip` pattern as Type line / Treatment rows):
_"Matches legal commanders: legendary creatures and cards that say 'can be
your commander' (e.g. planeswalker-commanders), legal in the Commander
format."_

Placement: near the Type line / Oracle text rows where commander-style
filtering is most discoverable. Reuse an existing segmented/toggle control
pattern already in the editor rather than introducing a new widget.

### 5. Tests

- `frontend/src/lib/commanders.test.ts`: extend (or add) — legendary creature
  ✓; planeswalker with "can be your commander" + commander legal ✓; banned
  legend (commander not legal) ✗; non-legendary non-text card ✗; missing
  fields ✗. Assert `isValidCommander` behavior is unchanged.
- `frontend/src/lib/rules.test.ts`: `commanderEligible: true` matches a
  legendary creature and a planeswalker-commander, rejects a banned legend and
  a vanilla creature; `false` inverts; `undefined` imposes nothing;
  `isFilterEmpty` is `false` when only `commanderEligible` is set;
  `compileFilter` round-trips the flag.
- Coverage: new logic lands in `src/lib/**`, which is the measured scope;
  keep ≥ 80% (statements/branches/functions/lines).

### 6. Docs — `README.md`

Add the new **Commander** field to the README rule-fields list (README is the
canonical reference for rule fields per `CLAUDE.md`; no `CLAUDE.md` change
needed).

## Out of scope (YAGNI)

- No backend changes — binder rule matching is entirely frontend
  (`lib/rules.ts`); the backend does not materialize binders.
- No partner / background / "choose a Background" sub-distinctions — those
  cards are still legendary creatures and are already covered.
- No new generic OR capability in the rule model.

## Risks / notes

- **Drift:** the whole point of the shared `isCommanderEligibleFrom` core is
  to keep the binder and deck-builder commander definitions identical. Both
  callers must go through it; a test asserts `isValidCommander` is unchanged.
- **`EnrichedCard.oracleText` casing:** its type doc states it is stored
  lowercased; the core lowercases defensively anyway, so a future change to
  that invariant won't silently break matching.
- Multi-face cards: `EnrichedCard.typeLine`/`oracleText` already join faces
  (per type docs), so DFC/MDFC commanders are handled by substring match the
  same way the existing collection materialize path handles them.

## Verification

- `npm run typecheck`, `npm run lint`, `npm run format:check`
- `npm test --prefix frontend`
- Manual UI check is left to the user (per project memory: no preview
  verification by the assistant).
