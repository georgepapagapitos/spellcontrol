import { useCallback, useMemo, useRef, useState } from 'react';
import type { ChipExpression, NegatableChip } from '../types';
import { SelectMenu } from './SelectMenu';

const MAX_SUGGESTIONS = 8;

// Enum dropdowns longer than this get a searchable filter input (oracle tags
// = 23, layouts = 18); shorter closed lists stay a plain pick list.
const SEARCHABLE_OPTION_THRESHOLD = 10;

type Joiner = 'AND' | 'OR';

interface CommonProps {
  /** The full chip expression — chips + joiners. Controlled. */
  value: ChipExpression;
  onChange: (next: ChipExpression) => void;
  /**
   * Joiner used when a new chip is appended. Different filter rows
   * prefer different defaults (e.g. "Types" defaults to AND because
   * users want intersection like Creature AND Land; "Subtype" defaults
   * to OR because Angel OR Demon is the natural reading). Always
   * overridable per-pill by the user once placed.
   */
  defaultJoiner?: Joiner;
  placeholder?: string;
  /**
   * Display-only mode — render chips + joiners but no input/dropdown.
   * Used when a composite parent (e.g. TypeLineExpressionBuilder) owns
   * a single shared input that routes adds into one of several sub-rows.
   */
  hideInput?: boolean;
  /**
   * When set to `'OR'`, the joiner toggle is disabled (shown read-only).
   * Use for single-valued fields (rarity, layout, border, finish,
   * condition, binder) where AND between two values is always unsatisfiable
   * because a card can only have one value for that field.
   */
  lockJoiner?: 'OR';
}

interface FreetextProps extends CommonProps {
  /**
   * Optional autocomplete pool. When provided, the input shows
   * matching suggestions below; user can still type freely and commit
   * with Enter. Use for fields with open vocabulary like type subtypes
   * or oracle keywords.
   */
  suggestions: string[];
  options?: undefined;
}

interface EnumProps extends CommonProps {
  /**
   * Closed-vocabulary options. When provided, the input becomes a
   * dropdown — picking from it adds the chip. Use for fields with
   * fixed vocabularies like rarity or primary card type.
   */
  options: { value: string; label: string }[];
  suggestions?: undefined;
}

type Props = FreetextProps | EnumProps;

/**
 * Unified chip-expression authoring component. One UI for two modes:
 *
 *   - **Freetext + autocomplete** (`suggestions`): type to add, Enter
 *     commits, arrow keys navigate suggestions.
 *   - **Enum dropdown** (`options`): pick from a closed list; chosen
 *     values disappear from the list.
 *
 * Either mode supports the full `ChipExpression` model:
 *   - IS / IS NOT pill on each chip (click to flip).
 *   - AND / OR joiner pill between adjacent chips (click to flip).
 *   - × to remove a chip (and its trailing joiner).
 *
 * Shared by the collection filter dialog (type-line split, future
 * fields) and — when migration lands — the binder rule editor.
 */
export function ChipExpressionBuilder(props: Props) {
  const { value, onChange, defaultJoiner = 'OR', placeholder, hideInput, lockJoiner } = props;
  const isEnum = 'options' in props && props.options !== undefined;
  const chips = value.chips;
  const joiners = value.joiners;

  const setChips = useCallback(
    (nextChips: NegatableChip[], nextJoiners: Joiner[]) => {
      onChange({ chips: nextChips, joiners: nextJoiners });
    },
    [onChange]
  );

  const appendChip = useCallback(
    (chipValue: string) => {
      const v = chipValue.trim();
      if (!v) return;
      if (chips.some((c) => c.value.toLowerCase() === v.toLowerCase())) return;
      const nextChips = [...chips, { value: v, negate: false }];
      const nextJoiners = chips.length === 0 ? [...joiners] : [...joiners, defaultJoiner];
      setChips(nextChips, nextJoiners);
    },
    [chips, joiners, defaultJoiner, setChips]
  );

  const toggleChipNegate = (i: number) => {
    setChips(
      chips.map((c, j) => (j === i ? { ...c, negate: !c.negate } : c)),
      joiners
    );
  };

  const removeChip = (i: number) => {
    const nextChips = chips.filter((_, j) => j !== i);
    // joiners[k] connects chips[k]→chips[k+1]. Removing chip i drops the
    // joiner that *follows* it (joiners[i]), or — when removing the last
    // chip — drops the joiner that *precedes* it (joiners[i-1]).
    const dropAt = i < joiners.length ? i : joiners.length - 1;
    const nextJoiners = dropAt >= 0 ? joiners.filter((_, j) => j !== dropAt) : joiners;
    setChips(nextChips, nextJoiners);
  };

  const toggleJoiner = (i: number) => {
    setChips(
      chips,
      joiners.map((j, k) => (k === i ? (j === 'AND' ? 'OR' : 'AND') : j))
    );
  };

  return (
    <div className="chip-builder-wrap">
      <div className="chip-builder-inner">
        {chips.map((c, i) => (
          <span key={i} className="chip-builder-row">
            {i > 0 && (
              <button
                type="button"
                className={`chip-joiner ${joiners[i - 1] === 'AND' ? 'and' : 'or'}${lockJoiner === 'OR' ? ' is-locked' : ''}`}
                onClick={lockJoiner === 'OR' ? undefined : () => toggleJoiner(i - 1)}
                disabled={lockJoiner === 'OR'}
                title={
                  lockJoiner === 'OR'
                    ? 'OR only (single-valued field)'
                    : `${joiners[i - 1]} — click to flip`
                }
                aria-label={
                  lockJoiner === 'OR'
                    ? 'Joiner OR (locked)'
                    : `Joiner ${joiners[i - 1]}; click to toggle`
                }
              >
                {joiners[i - 1] ?? 'OR'}
              </button>
            )}
            <span
              className={`chip-builder-chip ${c.negate ? 'is-not' : 'is'}`}
              title="Click IS / IS NOT to toggle"
            >
              <button
                type="button"
                className="chip-builder-toggle"
                onClick={() => toggleChipNegate(i)}
              >
                {c.negate ? 'IS NOT' : 'IS'}
              </button>
              <span className="chip-builder-value">{labelFor(c.value, props)}</span>
              <button
                type="button"
                className="chip-builder-remove"
                aria-label="Remove"
                onClick={() => removeChip(i)}
              >
                ×
              </button>
            </span>
          </span>
        ))}
        {hideInput ? null : isEnum ? (
          <EnumAdd
            options={(props as EnumProps).options}
            takenValues={new Set(chips.map((c) => c.value.toLowerCase()))}
            onAdd={appendChip}
            placeholder={placeholder}
          />
        ) : (
          <FreetextAdd
            suggestions={(props as FreetextProps).suggestions}
            takenValues={new Set(chips.map((c) => c.value.toLowerCase()))}
            onAdd={appendChip}
            onBackspaceEmpty={() => {
              // Mirror the legacy ChipBuilder: empty + Backspace pops
              // the last chip + its trailing joiner.
              if (chips.length === 0) return;
              removeChip(chips.length - 1);
            }}
            placeholder={placeholder}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Look up the user-facing label for a chip whose `value` is a
 * controlled-vocab key. Freetext mode just returns the value verbatim.
 */
function labelFor(value: string, props: Props): string {
  if ('options' in props && props.options) {
    const found = props.options.find((o) => o.value.toLowerCase() === value.toLowerCase());
    if (found) return found.label;
  }
  return value;
}

function FreetextAdd({
  suggestions,
  takenValues,
  onAdd,
  onBackspaceEmpty,
  placeholder,
}: {
  suggestions: string[];
  takenValues: Set<string>;
  onAdd: (v: string) => void;
  onBackspaceEmpty: () => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return [];
    return suggestions
      .filter((s) => s.toLowerCase().includes(q) && !takenValues.has(s.toLowerCase()))
      .slice(0, MAX_SUGGESTIONS);
  }, [draft, suggestions, takenValues]);

  const open = filtered.length > 0;

  const commit = (value?: string) => {
    const v = (value ?? draft).trim();
    if (!v) return;
    onAdd(v);
    setDraft('');
    setActiveIdx(-1);
  };

  return (
    <div className="chip-builder-input-wrap">
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
          } else if (e.key === 'Backspace' && draft === '') {
            onBackspaceEmpty();
          }
        }}
        onBlur={() => {
          // Delay so click on suggestion fires first
          setTimeout(() => commit(), 120);
        }}
        placeholder={placeholder}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-activedescendant={activeIdx >= 0 ? `chip-suggest-${activeIdx}` : undefined}
      />
      {open && (
        <ul className="chip-suggest-list" role="listbox">
          {filtered.map((s, i) => (
            <li
              key={s}
              id={`chip-suggest-${i}`}
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
  );
}

function EnumAdd({
  options,
  takenValues,
  onAdd,
  placeholder,
}: {
  options: { value: string; label: string }[];
  takenValues: Set<string>;
  onAdd: (v: string) => void;
  placeholder?: string;
}) {
  const available = options.filter((o) => !takenValues.has(o.value.toLowerCase()));
  return (
    <SelectMenu
      value=""
      options={available}
      onChange={(v) => onAdd(v)}
      placeholder={available.length === 0 ? 'all added' : (placeholder ?? 'add…')}
      ariaLabel={placeholder ?? 'add'}
      disabled={available.length === 0}
      // Long closed vocabularies (oracle tags, layouts) get a searchable
      // dropdown; short lists (rarity, format, border…) stay a plain pick list.
      searchable={options.length > SEARCHABLE_OPTION_THRESHOLD}
      searchPlaceholder={placeholder ? `Search ${placeholder.replace(/[…\s]+$/, '')}…` : 'Search…'}
    />
  );
}
