import { useState, useEffect, useMemo } from 'react';
import { useCollectionStore } from '../store/collection';
import { SORT_FIELDS, NEW_BINDER_DEFAULT_SORTS, MAX_SORTS } from '../lib/sorting';
import { isFilterEmpty } from '../lib/rules';
import type {
  BinderFilter,
  BinderInput,
  BorderColor,
  ColorChoice,
  Finish,
  Format,
  Layout,
  NegatableChip,
  PocketSize,
  Rarity,
  SortField,
  Treatment,
} from '../types';

const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'];
const COLORS: { key: ColorChoice; label: string }[] = [
  { key: 'W', label: 'White' },
  { key: 'U', label: 'Blue' },
  { key: 'B', label: 'Black' },
  { key: 'R', label: 'Red' },
  { key: 'G', label: 'Green' },
  { key: 'M', label: 'Multicolor' },
  { key: 'C', label: 'Colorless' },
];
const FORMATS: Format[] = [
  'standard',
  'pioneer',
  'modern',
  'legacy',
  'vintage',
  'commander',
  'pauper',
];
const FINISHES: { key: Finish; label: string }[] = [
  { key: 'nonfoil', label: 'Normal' },
  { key: 'foil', label: 'Foil' },
  { key: 'etched', label: 'Etched' },
];
const LAYOUTS: { key: Layout; label: string }[] = [
  { key: 'normal', label: 'Normal' },
  { key: 'split', label: 'Split' },
  { key: 'flip', label: 'Flip' },
  { key: 'transform', label: 'Transform' },
  { key: 'modal_dfc', label: 'Modal DFC' },
  { key: 'adventure', label: 'Adventure' },
  { key: 'meld', label: 'Meld' },
  { key: 'leveler', label: 'Leveler' },
  { key: 'saga', label: 'Saga' },
  { key: 'planar', label: 'Planar' },
  { key: 'scheme', label: 'Scheme' },
  { key: 'vanguard', label: 'Vanguard' },
  { key: 'token', label: 'Token' },
  { key: 'double_faced_token', label: 'DFC token' },
  { key: 'emblem', label: 'Emblem' },
  { key: 'augment', label: 'Augment' },
  { key: 'host', label: 'Host' },
  { key: 'class', label: 'Class' },
];
const TREATMENT_OPTIONS: { key: Treatment; label: string }[] = [
  { key: 'fullart', label: 'Full art' },
  { key: 'extendedart', label: 'Extended art' },
  { key: 'showcase', label: 'Showcase' },
  { key: 'etched', label: 'Etched' },
  { key: 'inverted', label: 'Inverted' },
];
const BORDER_OPTIONS: { key: BorderColor; label: string }[] = [
  { key: 'black', label: 'Black' },
  { key: 'white', label: 'White' },
  { key: 'borderless', label: 'Borderless' },
  { key: 'silver', label: 'Silver' },
  { key: 'gold', label: 'Gold' },
];
const PRESET_COLORS = [
  '#7a8a70',
  '#3878c0',
  '#7060a0',
  '#d05030',
  '#409040',
  '#c89820',
  '#909090',
  '#a08040',
  '#c878a8',
];

const DEFAULT_EDHREC_TOP_N = 100;

const EMPTY_FILTER: BinderFilter = {};

export function BinderEditor() {
  const editingBinder = useCollectionStore((s) => s.editingBinder);
  const binders = useCollectionStore((s) => s.binders);
  const cards = useCollectionStore((s) => s.cards);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const createBinder = useCollectionStore((s) => s.createBinder);
  const updateBinder = useCollectionStore((s) => s.updateBinder);

  const isOpen = editingBinder !== null;
  const isNew = editingBinder === 'new';
  const existing = !isNew ? binders.find((b) => b.id === editingBinder) : undefined;

  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [pocketSize, setPocketSize] = useState<PocketSize>(9);
  const [filter, setFilter] = useState<BinderFilter>(EMPTY_FILTER);
  const [sorts, setSorts] = useState<SortField[]>([...NEW_BINDER_DEFAULT_SORTS]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Set codes the user actually owns — used to populate the multi-select.
  const ownedSets = useMemo(() => {
    const map = new Map<string, string>(); // code → name
    for (const c of cards) {
      const code = c.setCode.toUpperCase();
      if (!map.has(code)) map.set(code, c.setName || code);
    }
    return Array.from(map.entries())
      .map(([code, label]) => ({ code, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [cards]);

  useEffect(() => {
    if (!isOpen) return;
    if (existing) {
      setName(existing.name);
      setColor(existing.color);
      setPocketSize(existing.pocketSize ?? 9);
      setFilter({ ...(existing.filter ?? EMPTY_FILTER) });
      setSorts([...existing.sorts]);
    } else {
      setName('');
      setColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
      setPocketSize(9);
      setFilter(EMPTY_FILTER);
      setSorts([...NEW_BINDER_DEFAULT_SORTS]);
    }
    setErrorMsg(null);
  }, [isOpen, existing]);

  // Lock body scroll while the modal is open so the page behind doesn't move.
  useEffect(() => {
    if (!isOpen) return;
    const { body } = document;
    const prevOverflow = body.style.overflow;
    const prevOverscroll = body.style.overscrollBehavior;
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'contain';
    return () => {
      body.style.overflow = prevOverflow;
      body.style.overscrollBehavior = prevOverscroll;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const patch = (p: Partial<BinderFilter>) => setFilter((prev) => ({ ...prev, ...p }));

  const handleSave = () => {
    if (!name.trim()) {
      setErrorMsg('Name is required');
      return;
    }
    const rangeError = validateRanges(filter);
    if (rangeError) {
      setErrorMsg(rangeError);
      return;
    }

    const cleaned = cleanFilter(filter);
    const input: BinderInput = {
      name: name.trim(),
      position: existing?.position ?? 0,
      filter: cleaned,
      sorts,
      pocketSize,
      color,
    };

    setSaving(true);
    setErrorMsg(null);
    try {
      if (existing) {
        updateBinder(existing.id, input);
      } else {
        createBinder(input);
      }
      setEditingBinder(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const showEmptyWarning = isFilterEmpty(filter);
  const edhrecEnabled = filter.edhrecRankMax !== undefined;

  return (
    <div className="modal-backdrop" onClick={() => setEditingBinder(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{existing ? 'Edit binder' : 'New binder'}</h2>
          <button className="modal-close" onClick={() => setEditingBinder(null)} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          {/* Basics */}
          <section className="editor-section">
            <h3>Basics</h3>
            <div className="editor-row">
              <div className="field" style={{ flex: 1 }}>
                <label>Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Standard staples, Cube reserves..."
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Pocket size</label>
                <select
                  value={pocketSize}
                  onChange={(e) => setPocketSize(parseInt(e.target.value) as PocketSize)}
                >
                  <option value={9}>9-pocket</option>
                  <option value={18}>18-pocket</option>
                  <option value={4}>4-pocket</option>
                </select>
              </div>
            </div>
            <div className="editor-row">
              <div className="field">
                <label>Tab color</label>
                <div className="color-picker">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`color-swatch ${color === c ? 'selected' : ''}`}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                      title={c}
                      aria-label={`Color ${c}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Filters */}
          <section className="editor-section">
            <h3>
              Filters{' '}
              <span className="muted">— a card joins this binder if it matches every filter</span>
            </h3>

            {/* Legalities */}
            <div className="rule-row">
              <span className="rule-label">Legalities</span>
              <EnumChipBuilder
                options={FORMATS.map((f) => ({ value: f, label: f }))}
                chips={filter.legalities || []}
                onChange={(next) => patch({ legalities: next })}
                placeholder="Add format..."
              />
            </div>

            {/* Colors */}
            <div className="rule-row">
              <span className="rule-label">Color identity</span>
              <EnumChipBuilder
                options={COLORS.map((c) => ({ value: c.key, label: c.label }))}
                chips={filter.colors || []}
                onChange={(next) => patch({ colors: next })}
                placeholder="Add color..."
              />
            </div>

            {/* Rarity */}
            <div className="rule-row">
              <span className="rule-label">Rarity</span>
              <EnumChipBuilder
                options={RARITIES.map((r) => ({ value: r, label: r }))}
                chips={filter.rarities || []}
                onChange={(next) => patch({ rarities: next })}
                placeholder="Add rarity..."
              />
            </div>

            {/* CMC */}
            <div className="rule-row">
              <span className="rule-label">CMC</span>
              <NumberRangeInput
                min={filter.cmcMin}
                max={filter.cmcMax}
                step={1}
                onMinChange={(v) => patch({ cmcMin: v })}
                onMaxChange={(v) => patch({ cmcMax: v })}
              />
            </div>

            {/* Mana cost */}
            <div className="rule-row">
              <span
                className="rule-label has-tooltip"
                title="Exact mana cost match. Use Scryfall syntax with curly braces, e.g. {2}{G}{W} or {1}{R/W}. Leave blank to ignore."
              >
                Mana cost <span className="tooltip-marker">ⓘ</span>
              </span>
              <input
                type="text"
                value={filter.manaCost || ''}
                onChange={(e) => patch({ manaCost: e.target.value })}
                placeholder="{2}{G}{W}"
                style={{ width: 240 }}
              />
            </div>

            {/* Type chips (IS / IS NOT) */}
            <div className="rule-row">
              <span
                className="rule-label has-tooltip"
                title="Substring match against the type line. Toggle each chip between IS and IS NOT. Example: IS Creature + IS NOT Legendary excludes legendary creatures."
              >
                Type line <span className="tooltip-marker">ⓘ</span>
              </span>
              <ChipBuilder
                chips={filter.typeChips || []}
                onChange={(next) => patch({ typeChips: next })}
                placeholder="e.g. creature, angel, legendary"
              />
            </div>

            {/* Oracle text chips (IS / IS NOT) */}
            <div className="rule-row">
              <span
                className="rule-label has-tooltip"
                title="Substring match against the oracle (rules) text. Toggle each chip between IS and IS NOT."
              >
                Oracle text <span className="tooltip-marker">ⓘ</span>
              </span>
              <ChipBuilder
                chips={filter.oracleChips || []}
                onChange={(next) => patch({ oracleChips: next })}
                placeholder="e.g. draw a card, flying"
              />
            </div>

            {/* Sets */}
            <div className="rule-row">
              <span className="rule-label">Sets</span>
              <SetMultiSelect
                options={ownedSets}
                selected={filter.setCodes || []}
                onChange={(next) => patch({ setCodes: next })}
              />
            </div>

            {/* Price */}
            <div className="rule-row">
              <span className="rule-label">Price ($)</span>
              <NumberRangeInput
                min={filter.priceMin}
                max={filter.priceMax}
                step={0.25}
                onMinChange={(v) => patch({ priceMin: v })}
                onMaxChange={(v) => patch({ priceMax: v })}
              />
            </div>

            {/* Finishes */}
            <div className="rule-row">
              <span className="rule-label">Finishes</span>
              <EnumChipBuilder
                options={FINISHES.map((f) => ({ value: f.key, label: f.label }))}
                chips={filter.finishes || []}
                onChange={(next) => patch({ finishes: next })}
                placeholder="Add finish..."
              />
            </div>

            {/* Layout */}
            <div className="rule-row">
              <span className="rule-label">Layout</span>
              <EnumChipBuilder
                options={LAYOUTS.map((l) => ({ value: l.key, label: l.label }))}
                chips={filter.layouts || []}
                onChange={(next) => patch({ layouts: next })}
                placeholder="Add layout..."
              />
            </div>

            {/* Name contains */}
            <div className="rule-row">
              <span className="rule-label">Name contains</span>
              <input
                type="text"
                value={filter.nameContains || ''}
                onChange={(e) => patch({ nameContains: e.target.value })}
                placeholder="e.g. dragon, sword..."
                style={{ width: 240 }}
              />
            </div>

            {/* Treatments */}
            <div className="rule-row">
              <span
                className="rule-label has-tooltip"
                title="Cosmetic treatment of the printing. Full art = full-art lands and cards. Extended art = art that extends to the card edges. Showcase = special frame variants. Etched = etched-foil printings."
              >
                Treatment <span className="tooltip-marker">ⓘ</span>
              </span>
              <EnumChipBuilder
                options={TREATMENT_OPTIONS.map((t) => ({ value: t.key, label: t.label }))}
                chips={filter.treatments || []}
                onChange={(next) => patch({ treatments: next })}
                placeholder="Add treatment..."
              />
            </div>

            {/* Border color */}
            <div className="rule-row">
              <span className="rule-label">Border</span>
              <EnumChipBuilder
                options={BORDER_OPTIONS.map((b) => ({ value: b.key, label: b.label }))}
                chips={filter.borderColors || []}
                onChange={(next) => patch({ borderColors: next })}
                placeholder="Add border..."
              />
            </div>

            {/* EDHREC */}
            <div className="rule-row">
              <span
                className="rule-label has-tooltip"
                title="EDHREC tracks how often each card appears in EDH/Commander decks. Lower rank = more popular. Top 100 = roughly the most-played 100 cards across the format."
              >
                EDHREC popularity <span className="tooltip-marker">ⓘ</span>
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <label className="field-checkbox">
                  <input
                    type="checkbox"
                    checked={edhrecEnabled}
                    onChange={(e) =>
                      patch({
                        edhrecRankMax: e.target.checked ? DEFAULT_EDHREC_TOP_N : undefined,
                      })
                    }
                  />
                  Top
                </label>
                <input
                  type="number"
                  value={filter.edhrecRankMax ?? ''}
                  min={1}
                  max={50000}
                  step={50}
                  disabled={!edhrecEnabled}
                  placeholder={String(DEFAULT_EDHREC_TOP_N)}
                  onChange={(e) =>
                    patch({
                      edhrecRankMax: e.target.value === '' ? undefined : parseInt(e.target.value),
                    })
                  }
                  style={{ width: 90 }}
                />
                <span style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>
                  most popular EDH cards
                </span>
              </div>
            </div>

            {showEmptyWarning && (
              <div className="warn-banner" style={{ marginTop: '0.75rem' }}>
                ⚠️ This binder has no filters — it will match every remaining card. Add at least
                one, or place this binder near the bottom of the priority list.
              </div>
            )}
          </section>

          {/* Sort */}
          <section className="editor-section">
            <h3>Sort within binder</h3>
            <p className="muted" style={{ marginBottom: '0.5rem' }}>
              The first sort splits the binder into section headers; later sorts order cards within
              each section.
            </p>
            <div className="sort-editor-list">
              {sorts.map((s, i) => (
                <div key={i} className="sort-editor-row">
                  <span className="sort-editor-num">{i + 1}.</span>
                  <SortSelect
                    value={s}
                    onChange={(v) => setSorts(sorts.map((x, j) => (j === i ? v : x)))}
                  />
                  <div className="tab-actions sort-editor-actions">
                    <button
                      type="button"
                      className="tab-action"
                      onClick={() => setSorts(swap(sorts, i, i - 1))}
                      disabled={i === 0}
                      title="Move up"
                      aria-label="Move sort up"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="tab-action"
                      onClick={() => setSorts(swap(sorts, i, i + 1))}
                      disabled={i === sorts.length - 1}
                      title="Move down"
                      aria-label="Move sort down"
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      className="tab-action"
                      onClick={() => setSorts(sorts.filter((_, j) => j !== i))}
                      disabled={sorts.length === 1}
                      title="Remove this sort"
                      aria-label="Remove sort"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
              {sorts.length < MAX_SORTS && (
                <button
                  type="button"
                  className="btn btn-add-group"
                  onClick={() => setSorts([...sorts, nextDefaultSort(sorts)])}
                >
                  + Add sort
                </button>
              )}
            </div>
          </section>

          {errorMsg && <div className="error-banner">{errorMsg}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={() => setEditingBinder(null)} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : existing ? 'Save changes' : 'Create binder'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── small components ─────────────────────────── */

/** ManaBox-style chip builder: type a value, hit Enter to add. Each chip toggles IS / IS NOT and has an X. */
function ChipBuilder({
  chips,
  onChange,
  placeholder,
}: {
  chips: NegatableChip[];
  onChange: (next: NegatableChip[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    if (chips.some((c) => c.value.toLowerCase() === v.toLowerCase() && !c.negate)) {
      setDraft('');
      return;
    }
    onChange([...chips, { value: v, negate: false }]);
    setDraft('');
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {chips.map((c, i) => (
        <span
          key={i}
          className={`chip-builder-chip ${c.negate ? 'is-not' : 'is'}`}
          title="Click IS / IS NOT to toggle"
        >
          <button
            type="button"
            className="chip-builder-toggle"
            onClick={() =>
              onChange(chips.map((x, j) => (j === i ? { ...x, negate: !x.negate } : x)))
            }
          >
            {c.negate ? 'IS NOT' : 'IS'}
          </button>
          <span className="chip-builder-value">{c.value}</span>
          <button
            type="button"
            className="chip-builder-remove"
            aria-label="Remove"
            onClick={() => onChange(chips.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && draft === '' && chips.length > 0) {
            onChange(chips.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        style={{ width: 220 }}
      />
    </div>
  );
}

/**
 * Dropdown-driven chip builder for controlled-vocabulary fields (e.g. rarity).
 * Picking from the dropdown adds an IS chip; click the IS / IS NOT pill to flip; X to remove.
 * Already-selected values disappear from the dropdown.
 */
function EnumChipBuilder({
  options,
  chips,
  onChange,
  placeholder,
}: {
  options: { value: string; label: string }[];
  chips: NegatableChip[];
  onChange: (next: NegatableChip[]) => void;
  placeholder?: string;
}) {
  const taken = new Set(chips.map((c) => c.value.toLowerCase()));
  const available = options.filter((o) => !taken.has(o.value.toLowerCase()));
  const labelFor = (val: string) =>
    options.find((o) => o.value.toLowerCase() === val.toLowerCase())?.label ?? val;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {chips.map((c, i) => (
        <span
          key={i}
          className={`chip-builder-chip ${c.negate ? 'is-not' : 'is'}`}
          title="Click IS / IS NOT to toggle"
        >
          <button
            type="button"
            className="chip-builder-toggle"
            onClick={() =>
              onChange(chips.map((x, j) => (j === i ? { ...x, negate: !x.negate } : x)))
            }
          >
            {c.negate ? 'IS NOT' : 'IS'}
          </button>
          <span className="chip-builder-value">{labelFor(c.value)}</span>
          <button
            type="button"
            className="chip-builder-remove"
            aria-label="Remove"
            onClick={() => onChange(chips.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </span>
      ))}
      <select
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          onChange([...chips, { value: v, negate: false }]);
        }}
        disabled={available.length === 0}
        style={{ fontSize: '0.85rem' }}
      >
        <option value="" disabled>
          {available.length === 0 ? 'all added' : (placeholder ?? 'add...')}
        </option>
        {available.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Multi-select dropdown for set codes. Selected sets render as removable chips. */
function SetMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: { code: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedSet = new Set(selected.map((s) => s.toUpperCase()));
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) => !q || o.code.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
    );
  }, [options, query]);

  const addCode = (code: string) => {
    if (!selectedSet.has(code)) onChange([...selected, code]);
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {selected.map((code) => {
        const opt = options.find((o) => o.code.toUpperCase() === code.toUpperCase());
        return (
          <span key={code} className="chip-builder-chip is" title={opt?.label || code}>
            <span className="chip-builder-value">{code.toUpperCase()}</span>
            <button
              type="button"
              className="chip-builder-remove"
              aria-label="Remove"
              onClick={() =>
                onChange(selected.filter((s) => s.toUpperCase() !== code.toUpperCase()))
              }
            >
              ×
            </button>
          </span>
        );
      })}
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          placeholder={options.length === 0 ? 'no cards loaded' : 'add set...'}
          disabled={options.length === 0}
          style={{ width: 200 }}
        />
        {open && filtered.length > 0 && (
          <div className="set-dropdown">
            {filtered.slice(0, 30).map((o) => (
              <button
                key={o.code}
                type="button"
                className={`set-dropdown-item ${selectedSet.has(o.code) ? 'selected' : ''}`}
                onClick={() => {
                  addCode(o.code);
                  setQuery('');
                }}
              >
                <span className="set-code">{o.code}</span>
                <span className="set-name">{o.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NumberRangeInput({
  min,
  max,
  step,
  onMinChange,
  onMaxChange,
}: {
  min: number | undefined;
  max: number | undefined;
  step: number;
  onMinChange: (v: number | undefined) => void;
  onMaxChange: (v: number | undefined) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        type="number"
        value={min ?? ''}
        step={step}
        min={0}
        placeholder="min"
        onChange={(e) =>
          onMinChange(e.target.value === '' ? undefined : parseFloat(e.target.value))
        }
        style={{ width: 90 }}
      />
      <span style={{ color: 'var(--text3)', fontSize: '0.8rem' }}>to</span>
      <input
        type="number"
        value={max ?? ''}
        step={step}
        min={0}
        placeholder="max"
        onChange={(e) =>
          onMaxChange(e.target.value === '' ? undefined : parseFloat(e.target.value))
        }
        style={{ width: 90 }}
      />
    </div>
  );
}

function SortSelect({ value, onChange }: { value: SortField; onChange: (v: SortField) => void }) {
  return (
    <select
      style={{ fontSize: '0.85rem' }}
      value={value}
      onChange={(e) => onChange(e.target.value as SortField)}
    >
      {SORT_FIELDS.map((f) => (
        <option key={f.value} value={f.value}>
          {f.label}
        </option>
      ))}
    </select>
  );
}

/** Swap two array elements; out-of-bounds indices return the array unchanged. */
function swap<T>(arr: T[], i: number, j: number): T[] {
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Pick a sort field for a freshly-added row — the first one not already used, or 'name' as fallback. */
function nextDefaultSort(existing: SortField[]): SortField {
  for (const opt of SORT_FIELDS) {
    if (!existing.includes(opt.value)) return opt.value;
  }
  return 'name';
}

function validateRanges(f: BinderFilter): string | null {
  if (f.priceMin !== undefined && f.priceMax !== undefined && f.priceMin > f.priceMax) {
    return 'Price minimum cannot exceed maximum';
  }
  if (f.cmcMin !== undefined && f.cmcMax !== undefined && f.cmcMin > f.cmcMax) {
    return 'CMC minimum cannot exceed maximum';
  }
  if (f.priceMin !== undefined && f.priceMin < 0) return 'Price cannot be negative';
  if (f.cmcMin !== undefined && f.cmcMin < 0) return 'CMC cannot be negative';
  if (f.edhrecRankMax !== undefined && f.edhrecRankMax < 1) {
    return 'EDHREC top N must be at least 1';
  }
  return null;
}

/** Strip empty strings/arrays/undefineds and chips with blank values. */
function cleanFilter(f: BinderFilter): BinderFilter {
  const out: BinderFilter = {};
  const cleanChips = (chips?: NegatableChip[]) => {
    const kept = (chips || [])
      .filter((c) => c.value.trim())
      .map((c) => ({ value: c.value.trim(), negate: c.negate }));
    return kept.length ? kept : undefined;
  };
  if (cleanChips(f.legalities)) out.legalities = cleanChips(f.legalities);
  if (cleanChips(f.colors)) out.colors = cleanChips(f.colors);
  if (cleanChips(f.rarities)) out.rarities = cleanChips(f.rarities);
  if (cleanChips(f.typeChips)) out.typeChips = cleanChips(f.typeChips);
  if (cleanChips(f.oracleChips)) out.oracleChips = cleanChips(f.oracleChips);
  if (cleanChips(f.finishes)) out.finishes = cleanChips(f.finishes);
  if (cleanChips(f.layouts)) out.layouts = cleanChips(f.layouts);
  if (cleanChips(f.treatments)) out.treatments = cleanChips(f.treatments);
  if (cleanChips(f.borderColors)) out.borderColors = cleanChips(f.borderColors);

  if (f.cmcMin !== undefined && !isNaN(f.cmcMin)) out.cmcMin = f.cmcMin;
  if (f.cmcMax !== undefined && !isNaN(f.cmcMax)) out.cmcMax = f.cmcMax;
  if (f.manaCost?.trim()) out.manaCost = f.manaCost.trim();
  if (f.setCodes && f.setCodes.length) out.setCodes = f.setCodes.map((s) => s.toUpperCase());
  if (f.priceMin !== undefined && !isNaN(f.priceMin)) out.priceMin = f.priceMin;
  if (f.priceMax !== undefined && !isNaN(f.priceMax)) out.priceMax = f.priceMax;
  if (f.nameContains?.trim()) out.nameContains = f.nameContains.trim();
  if (f.edhrecRankMax !== undefined && !isNaN(f.edhrecRankMax)) out.edhrecRankMax = f.edhrecRankMax;
  return out;
}
