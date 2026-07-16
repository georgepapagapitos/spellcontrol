import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BinderFilter, BinderFilterGroup, ListDef } from '../types';
import { useCollectionStore } from '../store/collection';
import { cleanFilter } from '../lib/clean-filter';
import { areAllGroupsEmpty } from '../lib/rules';
import { dynamicListCount } from '../lib/dynamic-list';
import { useCardsWithTags, groupsUseTags } from '../lib/card-tags';
import { fetchTypeSuggestions, fetchOracleSuggestions } from '../lib/scryfall-catalog';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useSheetExit } from '../lib/use-sheet-exit';
import { FilterGroupList } from './BinderEditor';
import './ListRuleEditor.css';

interface Props {
  list: ListDef;
  onClose: () => void;
}

const newGroup = (): BinderFilterGroup => ({ filter: {} });

/**
 * Rule editor for a dynamic list — the binder editor's `FilterGroupList`
 * (OR-of-groups, live match counts) in a bottom-sheet shell, minus every
 * binder-only concern (capacity, routing order, pockets). Saving cleans each
 * group via `cleanFilter` (same persistence hygiene as binders) and writes the
 * rule to the store; membership everywhere else recomputes live.
 */
export function ListRuleEditor({ list, onClose }: Props) {
  useLockBodyScroll();
  const cards = useCollectionStore((s) => s.cards);
  const setListRule = useCollectionStore((s) => s.setListRule);
  const [groups, setGroups] = useState<BinderFilterGroup[]>(() =>
    list.rule && list.rule.length > 0
      ? list.rule.map((g) => ({ ...g, filter: { ...g.filter } }))
      : [newGroup()]
  );
  const [autofocusIdx, setAutofocusIdx] = useState<number | null>(null);

  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  const dismiss = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) onClose();
    else beginClose();
  }, [beginClose, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismiss]);

  // Same inputs the binder editor feeds FilterGroupList: owned sets for the
  // set picker, catalog+collection suggestions for type/oracle chips, and
  // tag-decorated cards so a draft oracle-tag rule counts correctly.
  const ownedSets = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of cards) {
      const code = c.setCode.toUpperCase();
      if (!map.has(code)) map.set(code, c.setName || code);
    }
    return Array.from(map.entries())
      .map(([code, label]) => ({ code, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [cards]);

  const [typeSuggestions, setTypeSuggestions] = useState<string[]>([]);
  const [oracleSuggestions, setOracleSuggestions] = useState<string[]>([]);
  useEffect(() => {
    const collectionTokens = new Set<string>();
    for (const c of cards) {
      if (!c.typeLine) continue;
      for (const tok of c.typeLine.split(/[\s——]+/)) {
        const t = tok.trim();
        if (t) collectionTokens.add(t);
      }
    }
    let cancelled = false;
    fetchTypeSuggestions().then((catalog) => {
      if (cancelled) return;
      setTypeSuggestions(
        [...new Set([...catalog, ...collectionTokens])].sort((a, b) => a.localeCompare(b))
      );
    });
    fetchOracleSuggestions().then((catalog) => {
      if (!cancelled) setOracleSuggestions(catalog);
    });
    return () => {
      cancelled = true;
    };
    // Suggestions seed once per open — not on every collection mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const taggedCards = useCardsWithTags(cards, groupsUseTags(groups));
  const matchCount = useMemo(() => dynamicListCount(taggedCards, groups), [taggedCards, groups]);
  const canSave = !areAllGroupsEmpty(groups);

  const updateGroup = (idx: number, patch: (g: BinderFilterGroup) => BinderFilterGroup) =>
    setGroups((prev) => prev.map((g, i) => (i === idx ? patch(g) : g)));

  const save = () => {
    if (!canSave) return;
    const cleaned = groups
      .map((g) => ({ ...(g.name ? { name: g.name } : {}), filter: cleanFilter(g.filter) }))
      .filter((g) => Object.keys(g.filter).length > 0);
    setListRule(list.id, cleaned);
    onClose();
  };

  return (
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        dismiss();
      }}
      role="presentation"
    >
      <div
        className={`card-picker-sheet add-card-sheet list-rule-editor-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit rule for ${list.name}`}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">Rule for {list.name}</h2>
          <p className="add-card-sheet-hint">
            Cards from your collection that match this rule appear in the list automatically — new
            imports included.
          </p>
        </div>

        <div className="add-card-sheet-body">
          <FilterGroupList
            groups={groups}
            cards={taggedCards}
            keepPrintingsTogether={false}
            ownedSets={ownedSets}
            typeSuggestions={typeSuggestions}
            oracleSuggestions={oracleSuggestions}
            autofocusIdx={autofocusIdx}
            clearAutofocus={() => setAutofocusIdx(null)}
            onPatchFilter={(idx, p: Partial<BinderFilter>) =>
              updateGroup(idx, (g) => ({ ...g, filter: { ...g.filter, ...p } }))
            }
            onSetName={(idx, name) => updateGroup(idx, (g) => ({ ...g, name }))}
            onAdd={() =>
              setGroups((prev) => {
                setAutofocusIdx(prev.length);
                return [...prev, newGroup()];
              })
            }
            onDuplicate={(idx) =>
              setGroups((prev) => {
                const src = prev[idx];
                const copy: BinderFilterGroup = {
                  name: src.name ? `${src.name} (copy)` : undefined,
                  filter: { ...src.filter },
                };
                setAutofocusIdx(idx + 1);
                return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
              })
            }
            onRemove={(idx) =>
              setGroups((prev) =>
                prev.length === 1 ? [newGroup()] : prev.filter((_, i) => i !== idx)
              )
            }
            isNewBinder={false}
          />
        </div>

        <div className="card-picker-footer list-rule-editor-footer">
          <span className="filter-group-total list-rule-editor-count" aria-live="polite">
            Matches <strong>{matchCount.toLocaleString()}</strong>{' '}
            {matchCount === 1 ? 'card' : 'cards'} in your collection
          </span>
          <button type="button" className="btn" onClick={() => dismiss()}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!canSave} onClick={save}>
            Save rule
          </button>
        </div>
      </div>
    </div>
  );
}
