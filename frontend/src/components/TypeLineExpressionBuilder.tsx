import { useMemo, useRef, useState } from 'react';
import type { ChipExpression } from '../types';
import { SUPERTYPES, TYPES } from '../lib/card-types';
import { ChipExpressionBuilder } from './ChipExpressionBuilder';

const MAX_SUGGESTIONS = 8;

interface Props {
  supertypeExpr: ChipExpression;
  setSupertypeExpr: (next: ChipExpression) => void;
  typesExpr: ChipExpression;
  setTypesExpr: (next: ChipExpression) => void;
  subtypeExpr: ChipExpression;
  setSubtypeExpr: (next: ChipExpression) => void;
  /** Open-vocabulary suggestion pool for subtype matches (typically pulled from
   *  the Scryfall type catalog minus known supertypes/types). */
  subtypeSuggestions: string[];
}

const SUPERTYPE_SET = new Set<string>(SUPERTYPES);
const TYPE_SET = new Set<string>(TYPES);

const SUPERTYPE_OPTS = SUPERTYPES.map((t) => ({
  value: t,
  label: t.charAt(0).toUpperCase() + t.slice(1),
}));
const TYPE_OPTS = TYPES.map((t) => ({
  value: t,
  label: t.charAt(0).toUpperCase() + t.slice(1),
}));

/**
 * Manabox-style type-line filter: a single shared input that classifies
 * each committed token into Supertypes / Type / Subtype based on the
 * closed MTG vocabulary, and routes the chip into the matching row.
 *
 * Each underlying row is its own `ChipExpression` (so the evaluator can
 * AND/OR independently per category — e.g. Types "Creature AND Land"
 * vs. Supertypes "Basic OR Legendary"). Rows display in `hideInput`
 * mode — the sub-builders are display-only because the parent owns the
 * single shared input.
 *
 * Rows with no chips are hidden so the widget collapses to just the
 * input until the user starts adding. Defaults reflect what's natural
 * per category: Supertypes OR, Types AND, Subtype OR.
 */
export function TypeLineExpressionBuilder({
  supertypeExpr,
  setSupertypeExpr,
  typesExpr,
  setTypesExpr,
  subtypeExpr,
  setSubtypeExpr,
  subtypeSuggestions,
}: Props) {
  const [draft, setDraft] = useState('');
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Everything already-added, lowercased, so the autocomplete doesn't offer
  // duplicates regardless of which category they landed in.
  const taken = useMemo(() => {
    const s = new Set<string>();
    for (const c of supertypeExpr.chips) s.add(c.value.toLowerCase());
    for (const c of typesExpr.chips) s.add(c.value.toLowerCase());
    for (const c of subtypeExpr.chips) s.add(c.value.toLowerCase());
    return s;
  }, [supertypeExpr, typesExpr, subtypeExpr]);

  // Suggestion pool covers all three categories so the single input can
  // surface anything — we capitalize the closed vocab for nicer display.
  const allSuggestions = useMemo(() => {
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const closed = [...SUPERTYPES.map(cap), ...TYPES.map(cap)];
    // Dedup: subtypeSuggestions is already supertype/type-free upstream.
    return [...closed, ...subtypeSuggestions];
  }, [subtypeSuggestions]);

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return [];
    return allSuggestions
      .filter((s) => s.toLowerCase().includes(q) && !taken.has(s.toLowerCase()))
      .slice(0, MAX_SUGGESTIONS);
  }, [draft, allSuggestions, taken]);

  const open = filtered.length > 0;

  /**
   * Append a chip to the appropriate expression based on the value's
   * classification. Supertypes/Types stored lowercase (keys), Subtype
   * preserves whatever casing the user typed since it's open vocab.
   */
  const commit = (raw?: string) => {
    const v = (raw ?? draft).trim();
    if (!v) return;
    const lower = v.toLowerCase();
    if (taken.has(lower)) {
      setDraft('');
      setActiveIdx(-1);
      return;
    }
    // Canonicalize free-text input to a known suggestion's casing if one
    // exists case-insensitively — so typing "angel" still produces an
    // "Angel" chip when the catalog knows that spelling.
    const canonical = allSuggestions.find((s) => s.toLowerCase() === lower) ?? v;
    const appendChip = (
      expr: ChipExpression,
      setter: (next: ChipExpression) => void,
      storedValue: string,
      defaultJoiner: 'AND' | 'OR'
    ) => {
      const nextChips = [...expr.chips, { value: storedValue, negate: false }];
      const nextJoiners = expr.chips.length === 0 ? [] : [...expr.joiners, defaultJoiner];
      setter({ chips: nextChips, joiners: nextJoiners });
    };
    if (SUPERTYPE_SET.has(lower)) {
      appendChip(supertypeExpr, setSupertypeExpr, lower, 'OR');
    } else if (TYPE_SET.has(lower)) {
      appendChip(typesExpr, setTypesExpr, lower, 'AND');
    } else {
      appendChip(subtypeExpr, setSubtypeExpr, canonical, 'OR');
    }
    setDraft('');
    setActiveIdx(-1);
  };

  return (
    <div className="type-line-builder">
      {supertypeExpr.chips.length > 0 && (
        <div className="type-line-row">
          <span className="type-line-row-label">Supertypes</span>
          <ChipExpressionBuilder
            value={supertypeExpr}
            onChange={setSupertypeExpr}
            options={SUPERTYPE_OPTS}
            defaultJoiner="OR"
            hideInput
          />
        </div>
      )}
      {typesExpr.chips.length > 0 && (
        <div className="type-line-row">
          <span className="type-line-row-label">Type</span>
          <ChipExpressionBuilder
            value={typesExpr}
            onChange={setTypesExpr}
            options={TYPE_OPTS}
            defaultJoiner="AND"
            hideInput
          />
        </div>
      )}
      {subtypeExpr.chips.length > 0 && (
        <div className="type-line-row">
          <span className="type-line-row-label">Subtype</span>
          <ChipExpressionBuilder
            value={subtypeExpr}
            onChange={setSubtypeExpr}
            suggestions={subtypeSuggestions}
            defaultJoiner="OR"
            hideInput
          />
        </div>
      )}

      <div className="type-line-input-wrap">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setActiveIdx(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIdx((i) => Math.max(i - 1, -1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              commit(activeIdx >= 0 ? filtered[activeIdx] : undefined);
            } else if (e.key === 'Escape') {
              setDraft('');
              setActiveIdx(-1);
            }
          }}
          onBlur={() => {
            setTimeout(() => commit(), 120);
          }}
          placeholder="Legendary, Creature, Angel"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-activedescendant={activeIdx >= 0 ? `type-line-suggest-${activeIdx}` : undefined}
        />
        {open && (
          <ul className="chip-suggest-list" role="listbox">
            {filtered.map((s, i) => (
              <li
                key={s}
                id={`type-line-suggest-${i}`}
                role="option"
                aria-selected={i === activeIdx}
                className={`chip-suggest-item${i === activeIdx ? ' active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(s);
                  inputRef.current?.focus();
                }}
              >
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
