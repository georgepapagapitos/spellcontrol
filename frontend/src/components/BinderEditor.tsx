import { useState, useEffect } from 'react';
import { useCollectionStore } from '../store/collection';
import { SORT_FIELDS, NEW_BINDER_DEFAULT_SORTS } from '../lib/sorting';
import { hasEmptyRule } from '../lib/rules';
import type {
  BinderInput,
  BinderRule,
  ColorChoice,
  FoilChoice,
  PocketSize,
  Rarity,
  SortField,
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
const TYPE_OPTIONS = [
  'creature',
  'planeswalker',
  'instant',
  'sorcery',
  'enchantment',
  'artifact',
  'land',
  'battle',
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

export function BinderEditor() {
  const { editingBinder, binders, setEditingBinder, createBinder, updateBinder } =
    useCollectionStore();

  const isOpen = editingBinder !== null;
  const isNew = editingBinder === 'new';
  const existing = !isNew ? binders.find((b) => b.id === editingBinder) : undefined;

  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [pocketSize, setPocketSize] = useState<PocketSize | null>(null);
  const [rules, setRules] = useState<BinderRule[]>([{}]);
  const [sorts, setSorts] = useState<SortField[]>([...NEW_BINDER_DEFAULT_SORTS]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (existing) {
      setName(existing.name);
      setColor(existing.color);
      setPocketSize(existing.pocketSize);
      setRules(existing.rules.length > 0 ? existing.rules.map((r) => ({ ...r })) : [{}]);
      setSorts([...existing.sorts]);
    } else {
      setName('');
      setColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
      setPocketSize(null);
      setRules([{}]);
      setSorts([...NEW_BINDER_DEFAULT_SORTS]);
    }
    setErrorMsg(null);
  }, [isOpen, existing]);

  if (!isOpen) return null;

  const updateRule = (idx: number, patch: Partial<BinderRule>) => {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRuleGroup = () => {
    setRules((prev) => [...prev, {}]);
  };

  const removeRuleGroup = (idx: number) => {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    if (!name.trim()) {
      setErrorMsg('Name is required');
      return;
    }

    const rangeError = validateRanges(rules);
    if (rangeError) {
      setErrorMsg(rangeError);
      return;
    }

    const cleaned = rules.map(cleanRule).filter((r) => Object.keys(r).length > 0 || rules.length === 1);
    const finalRules = cleaned.length > 0 ? cleaned : [{}];

    const input: BinderInput = {
      name: name.trim(),
      position: existing?.position ?? 0,
      rules: finalRules,
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

  const showEmptyWarning = hasEmptyRule(rules);

  return (
    <div className="modal-backdrop" onClick={() => setEditingBinder(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{existing ? 'Edit binder' : 'New binder'}</h2>
          <button
            className="modal-close"
            onClick={() => setEditingBinder(null)}
            aria-label="Close"
          >
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
                  value={pocketSize === null ? 'default' : pocketSize}
                  onChange={(e) =>
                    setPocketSize(
                      e.target.value === 'default'
                        ? null
                        : (parseInt(e.target.value) as PocketSize)
                    )
                  }
                >
                  <option value="default">Use default</option>
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

          {/* Rules */}
          <section className="editor-section">
            <h3>
              Rules{' '}
              <span className="muted">
                — a card joins this binder if it matches ANY group below
              </span>
            </h3>

            {rules.map((rule, idx) => (
              <RuleGroupEditor
                key={idx}
                index={idx}
                rule={rule}
                canRemove={rules.length > 1}
                showOrLabel={idx > 0}
                onChange={(patch) => updateRule(idx, patch)}
                onRemove={() => removeRuleGroup(idx)}
              />
            ))}

            <button className="btn btn-add-group" onClick={addRuleGroup}>
              + Add another rule group (OR)
            </button>

            {showEmptyWarning && (
              <div className="warn-banner" style={{ marginTop: '0.75rem' }}>
                ⚠️ One of your rule groups has no constraints — it will match every remaining card.
                Add at least one filter, or place this binder near the bottom of the priority list.
              </div>
            )}
          </section>

          {/* Sort */}
          <section className="editor-section">
            <h3>Sort within binder</h3>
            <p className="muted" style={{ marginBottom: '0.5rem' }}>
              If the first sort is <em>Color</em>, cards stay grouped by color and remaining sorts
              apply within each group.
            </p>
            <div className="editor-row sort-editor">
              <SortSelect value={sorts[0]} onChange={(v) => setSorts([v, sorts[1], sorts[2]])} />
              <span className="sort-arrow">→</span>
              <SortSelect value={sorts[1]} onChange={(v) => setSorts([sorts[0], v, sorts[2]])} />
              <span className="sort-arrow">→</span>
              <SortSelect value={sorts[2]} onChange={(v) => setSorts([sorts[0], sorts[1], v])} />
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

interface RuleGroupEditorProps {
  index: number;
  rule: BinderRule;
  canRemove: boolean;
  showOrLabel: boolean;
  onChange: (patch: Partial<BinderRule>) => void;
  onRemove: () => void;
}

function RuleGroupEditor({
  index,
  rule,
  canRemove,
  showOrLabel,
  onChange,
  onRemove,
}: RuleGroupEditorProps) {
  const [edhrecEnabled, setEdhrecEnabled] = useState(rule.edhrecRankMax !== undefined);

  // Keep local toggle in sync if the rule changes externally (e.g. when editing an existing binder)
  useEffect(() => {
    setEdhrecEnabled(rule.edhrecRankMax !== undefined);
  }, [rule.edhrecRankMax]);

  return (
    <div className="rule-group">
      {showOrLabel && <div className="rule-group-or">OR</div>}
      <div className="rule-group-header">
        <span className="rule-group-title">Group {index + 1}</span>
        {canRemove && (
          <button className="btn-link-danger" onClick={onRemove} title="Remove this group">
            Remove
          </button>
        )}
      </div>

      {/* Rarity */}
      <div className="rule-row">
        <span className="rule-label">Rarity</span>
        <div className="chip-group">
          {RARITIES.map((r) => (
            <Chip
              key={r}
              label={r}
              active={(rule.rarities || []).includes(r)}
              onClick={() => onChange({ rarities: toggle(rule.rarities || [], r) })}
            />
          ))}
        </div>
      </div>

      {/* Colors */}
      <div className="rule-row">
        <span className="rule-label">Color identity</span>
        <div className="chip-group">
          {COLORS.map((c) => (
            <Chip
              key={c.key}
              label={c.label}
              active={(rule.colors || []).includes(c.key)}
              onClick={() => onChange({ colors: toggle(rule.colors || [], c.key) })}
            />
          ))}
        </div>
      </div>

      {/* Types */}
      <div className="rule-row">
        <span className="rule-label">Type</span>
        <div className="chip-group">
          {TYPE_OPTIONS.map((t) => (
            <Chip
              key={t}
              label={t}
              active={(rule.types || []).includes(t)}
              onClick={() => onChange({ types: toggle(rule.types || [], t) })}
            />
          ))}
        </div>
      </div>

      {/* Price */}
      <div className="rule-row">
        <span className="rule-label">Price ($)</span>
        <NumberRangeInput
          min={rule.priceMin}
          max={rule.priceMax}
          step={0.25}
          onMinChange={(v) => onChange({ priceMin: v })}
          onMaxChange={(v) => onChange({ priceMax: v })}
        />
      </div>

      {/* CMC */}
      <div className="rule-row">
        <span className="rule-label">CMC</span>
        <NumberRangeInput
          min={rule.cmcMin}
          max={rule.cmcMax}
          step={1}
          onMinChange={(v) => onChange({ cmcMin: v })}
          onMaxChange={(v) => onChange({ cmcMax: v })}
        />
      </div>

      {/* Foil */}
      <div className="rule-row">
        <span className="rule-label">Foil</span>
        <select
          value={rule.foil || 'any'}
          onChange={(e) => onChange({ foil: e.target.value as FoilChoice })}
        >
          <option value="any">Any</option>
          <option value="foil">Foil only</option>
          <option value="nonfoil">Non-foil only</option>
        </select>
      </div>

      {/* Name contains */}
      <div className="rule-row">
        <span className="rule-label">Name contains</span>
        <input
          type="text"
          value={rule.nameContains || ''}
          onChange={(e) => onChange({ nameContains: e.target.value })}
          placeholder="e.g. dragon, sword..."
          style={{ width: 240 }}
        />
      </div>

      {/* Set codes */}
      <div className="rule-row">
        <span className="rule-label">Set codes</span>
        <input
          type="text"
          value={(rule.setCodes || []).join(', ')}
          onChange={(e) =>
            onChange({
              setCodes: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="comma-separated, e.g. FIC, FIN"
          style={{ width: 240 }}
        />
      </div>

      {/* Source category (ManaBox binder name, Moxfield tag, etc) */}
      <div className="rule-row">
        <span
          className="rule-label has-tooltip"
          title="Some collection tools (ManaBox, Moxfield, Deckbox) let you tag or categorize cards. If your import included a category label, you can filter on it here. Substring match, case-insensitive."
        >
          Source category contains <span className="tooltip-marker">ⓘ</span>
        </span>
        <input
          type="text"
          value={rule.sourceCategoryContains || ''}
          onChange={(e) => onChange({ sourceCategoryContains: e.target.value })}
          placeholder="e.g. trade binder, edh staples"
          style={{ width: 240 }}
        />
      </div>

      {/* EDHREC rank */}
      <div className="rule-row">
        <span
          className="rule-label has-tooltip"
          title="EDHREC tracks how often each card appears in EDH/Commander decks. The 'rank' is its popularity ranking — lower = more popular. Top 100 = roughly the most-played 100 cards across the entire format. Data comes from Scryfall, which sources it from EDHREC."
        >
          EDHREC popularity <span className="tooltip-marker">ⓘ</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={edhrecEnabled}
              onChange={(e) => {
                setEdhrecEnabled(e.target.checked);
                onChange({
                  edhrecRankMax: e.target.checked ? DEFAULT_EDHREC_TOP_N : undefined,
                });
              }}
            />
            Top
          </label>
          <input
            type="number"
            value={rule.edhrecRankMax ?? ''}
            min={1}
            max={50000}
            step={50}
            disabled={!edhrecEnabled}
            placeholder={String(DEFAULT_EDHREC_TOP_N)}
            onChange={(e) =>
              onChange({
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
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`chip ${active ? 'active' : ''}`} onClick={onClick}>
      {label}
    </button>
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

function SortSelect({
  value,
  onChange,
}: {
  value: SortField;
  onChange: (v: SortField) => void;
}) {
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

function toggle<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

function validateRanges(rules: BinderRule[]): string | null {
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    const group = rules.length > 1 ? ` (Group ${i + 1})` : '';
    if (r.priceMin !== undefined && r.priceMax !== undefined && r.priceMin > r.priceMax) {
      return `Price minimum cannot exceed maximum${group}`;
    }
    if (r.cmcMin !== undefined && r.cmcMax !== undefined && r.cmcMin > r.cmcMax) {
      return `CMC minimum cannot exceed maximum${group}`;
    }
    if (r.priceMin !== undefined && r.priceMin < 0) {
      return `Price cannot be negative${group}`;
    }
    if (r.cmcMin !== undefined && r.cmcMin < 0) {
      return `CMC cannot be negative${group}`;
    }
    if (r.edhrecRankMax !== undefined && r.edhrecRankMax < 1) {
      return `EDHREC top N must be at least 1${group}`;
    }
  }
  return null;
}

/** Strip empty strings/arrays/undefineds from a single rule. */
function cleanRule(rule: BinderRule): BinderRule {
  const cleaned: BinderRule = {};
  if (rule.rarities && rule.rarities.length) cleaned.rarities = rule.rarities;
  if (rule.priceMin !== undefined && !isNaN(rule.priceMin)) cleaned.priceMin = rule.priceMin;
  if (rule.priceMax !== undefined && !isNaN(rule.priceMax)) cleaned.priceMax = rule.priceMax;
  if (rule.colors && rule.colors.length) cleaned.colors = rule.colors;
  if (rule.types && rule.types.length) cleaned.types = rule.types;
  if (rule.cmcMin !== undefined && !isNaN(rule.cmcMin)) cleaned.cmcMin = rule.cmcMin;
  if (rule.cmcMax !== undefined && !isNaN(rule.cmcMax)) cleaned.cmcMax = rule.cmcMax;
  if (rule.nameContains?.trim()) cleaned.nameContains = rule.nameContains.trim();
  if (rule.setCodes && rule.setCodes.length) cleaned.setCodes = rule.setCodes;
  if (rule.foil && rule.foil !== 'any') cleaned.foil = rule.foil;
  if (rule.sourceCategoryContains?.trim())
    cleaned.sourceCategoryContains = rule.sourceCategoryContains.trim();
  if (rule.edhrecRankMax !== undefined && !isNaN(rule.edhrecRankMax))
    cleaned.edhrecRankMax = rule.edhrecRankMax;
  return cleaned;
}
