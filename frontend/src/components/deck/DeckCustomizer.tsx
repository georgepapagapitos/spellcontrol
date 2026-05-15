import { Check, ChevronDown, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  BudgetOption,
  Customization,
  GameChangerLimit,
  MaxRarity,
  Pacing,
} from '@/deck-builder/types';
import { autocompleteCardName } from '@/deck-builder/services/scryfall/client';
import { useDeckBuilderStore } from '@/deck-builder/store';
import { useCollectionStore } from '../../store/collection';

type Update = (patch: Partial<Customization>) => void;

interface DeckCustomizerProps {
  customization: Customization;
  update: Update;
}

export function DeckCustomizer({ customization, update }: DeckCustomizerProps) {
  const suggestion = useDeckBuilderStore((s) => s.edhrecLandSuggestion);
  const setUserEditedLands = useDeckBuilderStore((s) => s.setUserEditedLands);

  const handleResetLands = () => {
    if (!suggestion) return;
    update({
      landCount: suggestion.landCount,
      nonBasicLandCount: suggestion.nonBasicLandCount,
    });
    setUserEditedLands(false);
  };

  const handleResetAll = () => {
    update({
      bracketLevel: 'all',
      collectionMode: false,
      deckBudget: null,
      maxCardPrice: null,
      ignoreOwnedBudget: false,
      budgetOption: 'any',
      maxRarity: null,
      ignoreOwnedRarity: false,
      gameChangerLimit: 'unlimited',
      comboCount: 1,
      tempoAutoDetect: true,
      saltTolerance: 2,
      scryfallQuery: '',
      mustIncludeCards: [],
      bannedCards: [],
      ...(suggestion
        ? { landCount: suggestion.landCount, nonBasicLandCount: suggestion.nonBasicLandCount }
        : {}),
    });
    setUserEditedLands(false);
  };

  return (
    <section className="deck-builder-section deck-customizer">
      <header className="deck-customizer-title-row">
        <h2 className="deck-builder-section-title">Customize</h2>
        <button
          type="button"
          className="deck-customizer-group-reset"
          onClick={handleResetAll}
          title="Reset all customization to defaults"
        >
          <RotateCcw width={12} height={12} strokeWidth={2} aria-hidden />
          Reset
        </button>
      </header>

      <div className="deck-customizer-body">
        <BracketGroup customization={customization} update={update} />
        <CollectionGroup customization={customization} update={update} />

        <div className="deck-customizer-group">
          <div className="deck-customizer-group-header">
            <h3 className="deck-customizer-group-title">Lands</h3>
            {suggestion && (
              <button
                type="button"
                className="deck-customizer-group-reset"
                onClick={handleResetLands}
                title={`Reset to EDHREC suggestion (${suggestion.landCount} / ${suggestion.nonBasicLandCount})`}
              >
                <RotateCcw width={12} height={12} strokeWidth={2} aria-hidden />
                Reset
              </button>
            )}
          </div>
          <div className="deck-customizer-group-body">
            <SizeAndLandsGroup customization={customization} update={update} />
          </div>
        </div>

        <CollapsibleGroup title="Budget" defaultOpen={false}>
          <BudgetGroup customization={customization} update={update} />
        </CollapsibleGroup>
        <CollapsibleGroup title="Card pool" defaultOpen={false}>
          <PoolGroup customization={customization} update={update} />
        </CollapsibleGroup>
        <CollapsibleGroup title="Tempo" defaultOpen={false}>
          <TempoGroup customization={customization} update={update} />
        </CollapsibleGroup>
        <CollapsibleGroup title="Salt" defaultOpen={false}>
          <SaltGroup customization={customization} update={update} />
        </CollapsibleGroup>
        <CollapsibleGroup title="Scryfall filter" defaultOpen={false}>
          <ScryfallGroup customization={customization} update={update} />
        </CollapsibleGroup>
        <CollapsibleGroup
          title="Must-include cards"
          defaultOpen={false}
          count={customization.mustIncludeCards.length}
        >
          <CardListGroup
            hint="These cards are forced into the deck before EDHREC suggestions are considered."
            values={customization.mustIncludeCards}
            onChange={(next) => update({ mustIncludeCards: next })}
          />
        </CollapsibleGroup>
        <CollapsibleGroup
          title="Excluded cards"
          defaultOpen={false}
          count={customization.bannedCards.length}
        >
          <CardListGroup
            hint="These cards will never be suggested by the generator."
            values={customization.bannedCards}
            onChange={(next) => update({ bannedCards: next })}
          />
        </CollapsibleGroup>
      </div>
    </section>
  );
}

function BracketGroup({ customization, update }: DeckCustomizerProps) {
  const options = [
    { v: 'all' as const, label: 'Any', sub: 'No filter' },
    { v: 1 as const, label: '1', sub: 'Exhibition' },
    { v: 2 as const, label: '2', sub: 'Core' },
    { v: 3 as const, label: '3', sub: 'Upgraded' },
    { v: 4 as const, label: '4', sub: 'Optimized' },
    { v: 5 as const, label: '5', sub: 'cEDH' },
  ];
  return (
    <div className="deck-customizer-group">
      <div className="deck-customizer-group-header">
        <h3 className="deck-customizer-group-title">Bracket</h3>
      </div>
      <div className="deck-customizer-group-body">
        <div className="bracket-pill-row" role="radiogroup" aria-label="Bracket level">
          {options.map((b) => {
            const active = String(customization.bracketLevel) === String(b.v);
            return (
              <button
                key={String(b.v)}
                type="button"
                role="radio"
                aria-checked={active}
                className={`bracket-pill${active ? ' active' : ''}`}
                onClick={() => update({ bracketLevel: b.v })}
              >
                <span className="bracket-pill-label">{b.label}</span>
                <span className="bracket-pill-sub">{b.sub}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SaltGroup({ customization, update }: DeckCustomizerProps) {
  const value = (customization.saltTolerance ?? 2) as number;
  const SALT_LABELS = ['Unsalted', 'Low', 'Any', 'Extra'];
  const SALT_DESCRIPTIONS: Record<number, string> = {
    0: 'Strict filter — exclude EDHREC salt > 0.75 (pillow-fort friendly)',
    1: 'Moderate filter — exclude EDHREC salt > 2.0 (no Armageddon, no Cyclonic Rift)',
    2: 'No salt filtering (default)',
    3: 'No filter — boost high-salt staples in the priority order',
  };
  return (
    <div className="deck-customizer-slider">
      <p
        className="deck-customizer-slider-hint"
        style={{
          margin: '0 0 0.75rem',
          fontSize: '0.85em',
          lineHeight: 1.4,
          opacity: 0.75,
        }}
      >
        <a
          href="https://edhrec.com/top/salt"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit', textDecoration: 'underline' }}
        >
          EDHREC&apos;s salt scores
        </a>{' '}
        tally votes for the most-hated cards in the format — think Stax, Armageddon, Cyclonic Rift.
        Slide left to leave them out, right to lean into them.
      </p>
      <input
        type="range"
        className="deck-customizer-range"
        min={0}
        max={3}
        step={1}
        value={value}
        aria-label="Salt level"
        title={SALT_DESCRIPTIONS[value]}
        onChange={(e) => update({ saltTolerance: Number(e.target.value) as 0 | 1 | 2 | 3 })}
        style={{
          ['--range-progress' as string]: `${(value / 3) * 100}%`,
        }}
      />
      <div className="deck-customizer-slider-anchors">
        {SALT_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            className="deck-customizer-slider-anchor"
            data-align={i === 0 ? 'start' : i === SALT_LABELS.length - 1 ? 'end' : 'center'}
            aria-label={`Set salt level to ${label}`}
            aria-pressed={value === i}
            title={SALT_DESCRIPTIONS[i]}
            onClick={() => update({ saltTolerance: i as 0 | 1 | 2 | 3 })}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <span className="deck-customizer-slider-anchor-label">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CollectionGroup({ customization, update }: DeckCustomizerProps) {
  const collectionCards = useCollectionStore((s) => s.cards);
  const uniqueCount = new Set(collectionCards.map((c) => c.name)).size;
  const active = customization.collectionMode;
  const empty = uniqueCount === 0;
  return (
    <div className={`deck-customizer-group collection-group${active ? ' active' : ''}`}>
      <label className="collection-group-row">
        <input
          type="checkbox"
          className="collection-group-checkbox"
          checked={active}
          disabled={empty}
          onChange={(e) => update({ collectionMode: e.target.checked })}
        />
        <span className="collection-group-text">
          <span className="collection-group-title-row">
            <span className="collection-group-title">Build from my collection</span>
            <span className="collection-group-badge" aria-hidden>
              {uniqueCount.toLocaleString()} unique
            </span>
          </span>
          <span className="collection-group-sub">
            {empty
              ? 'Import cards on the Collection page to enable this.'
              : active
                ? `Generator will only suggest cards you own.`
                : `Constrain the build to your owned cards.`}
          </span>
        </span>
      </label>
    </div>
  );
}

function CollapsibleGroup({
  title,
  defaultOpen,
  count,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div
      className={`deck-customizer-group deck-customizer-group-collapsible${open ? ' open' : ''}`}
    >
      <button
        type="button"
        className="deck-customizer-group-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="deck-customizer-group-toggle-title">
          <span className="deck-customizer-group-title">{title}</span>
          {typeof count === 'number' && count > 0 && (
            <span className="deck-customizer-group-count" aria-label={`${count} selected`}>
              {count}
            </span>
          )}
        </span>
        <ChevronDown width={14} height={14} strokeWidth={2} aria-hidden />
      </button>
      {open && <div className="deck-customizer-group-body">{children}</div>}
    </div>
  );
}

// ── Size + lands ──────────────────────────────────────────────────────────
function SizeAndLandsGroup({ customization, update }: DeckCustomizerProps) {
  const total = customization.landCount;
  const nonBasic = Math.min(customization.nonBasicLandCount, total);
  const basics = total - nonBasic;
  const balancedNonBasic = Math.round(total / 2);
  const suggestion = useDeckBuilderStore((s) => s.edhrecLandSuggestion);
  const setUserEditedLands = useDeckBuilderStore((s) => s.setUserEditedLands);

  const handleTotal = (n: number) => {
    update({ landCount: n });
    setUserEditedLands(true);
  };
  const handleNonBasic = (n: number) => {
    update({ nonBasicLandCount: n });
    setUserEditedLands(true);
  };

  return (
    <>
      <RangeSlider
        label="Total lands"
        ariaLabel="Total lands"
        value={total}
        min={32}
        max={42}
        onChange={handleTotal}
        anchors={[
          { value: 32, label: 'Aggro' },
          { value: 37, label: 'Standard' },
          { value: 42, label: 'Control' },
        ]}
        suggested={suggestion ? total === suggestion.landCount : false}
      />
      <RangeSlider
        label="Non-basic lands"
        ariaLabel="Non-basic lands"
        value={nonBasic}
        min={0}
        max={total}
        valueSuffix={`(${basics} basic${basics === 1 ? '' : 's'})`}
        onChange={handleNonBasic}
        anchors={[
          { value: 0, label: 'Basic' },
          { value: balancedNonBasic, label: 'Balanced' },
          { value: total, label: 'Varied' },
        ]}
        suggested={suggestion ? nonBasic === suggestion.nonBasicLandCount : false}
      />
    </>
  );
}

// ── Budget ────────────────────────────────────────────────────────────────
//
// Reference-repo pattern: a row of preset buttons (None / $25 / $50 / $100 /
// $200 / Custom) where Custom swaps to an inline numeric input. Beats a
// stand-alone number field for both speed (one click for common values) and
// affordance (presets advertise the format and approximate scale).
function BudgetGroup({ customization, update }: DeckCustomizerProps) {
  return (
    <>
      <Field label="Total deck budget (USD)">
        <PresetEditableNumber
          value={customization.deckBudget}
          presets={[null, 25, 50, 100, 200]}
          formatPreset={(v) => (v === null ? 'None' : `$${v}`)}
          formatCustom={(v) => `$${v}`}
          onChange={(n) => update({ deckBudget: n })}
          ariaLabel="Custom total deck budget"
        />
      </Field>
      <Field label="Max card price (USD)">
        <PresetEditableNumber
          value={customization.maxCardPrice}
          presets={[null, 1, 5, 10, 25]}
          formatPreset={(v) => (v === null ? 'None' : `$${v}`)}
          formatCustom={(v) => `$${v}`}
          onChange={(n) => update({ maxCardPrice: n })}
          ariaLabel="Custom max card price"
        />
      </Field>
      <Toggle
        label="Owned cards do not count toward budget"
        checked={customization.ignoreOwnedBudget}
        onChange={(v) => update({ ignoreOwnedBudget: v })}
      />
    </>
  );
}

// ── EDHREC pool / rarity / game changers / combos ────────────────────────
function PoolGroup({ customization, update }: DeckCustomizerProps) {
  return (
    <>
      <Field label="EDHREC card pool">
        <OptionGrid<BudgetOption>
          value={customization.budgetOption}
          options={[
            { value: 'any', label: 'Any', sublabel: 'All cards' },
            { value: 'budget', label: 'Budget', sublabel: 'Cheaper picks' },
            { value: 'expensive', label: 'Expensive', sublabel: 'Premium picks' },
          ]}
          onChange={(v) => update({ budgetOption: v })}
        />
      </Field>

      <Field
        label="Max card rarity"
        hint="Cards in your collection bypass this cap when the toggle below is on."
      >
        <OptionGrid<MaxRarity | 'all'>
          value={customization.maxRarity ?? 'all'}
          options={[
            { value: 'all', label: 'All' },
            { value: 'common', label: 'Common' },
            { value: 'uncommon', label: 'Uncommon' },
            { value: 'rare', label: 'Rare' },
            { value: 'mythic', label: 'Mythic' },
          ]}
          onChange={(v) => update({ maxRarity: v === 'all' ? null : v })}
        />
      </Field>
      <Toggle
        label="Owned cards skip rarity limit"
        checked={customization.ignoreOwnedRarity}
        onChange={(v) => update({ ignoreOwnedRarity: v })}
      />

      <Field label="Game changers" hint="EDHREC-flagged high-impact cards.">
        <GameChangerOptions
          value={customization.gameChangerLimit}
          onChange={(v) => update({ gameChangerLimit: v })}
        />
      </Field>

      <Field label="Combos">
        <OptionGrid<number>
          value={customization.comboCount}
          options={[
            { value: 0, label: 'None' },
            { value: 1, label: 'Normal' },
            { value: 2, label: 'A few extra' },
            { value: 3, label: 'Many' },
          ]}
          onChange={(v) => update({ comboCount: v })}
        />
      </Field>
    </>
  );
}

// ── Game changers — None / Custom (click to edit) / Unlimited ────────────
function GameChangerOptions({
  value,
  onChange,
}: {
  value: GameChangerLimit;
  onChange: (v: GameChangerLimit) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const isCustom = typeof value === 'number';
  const commit = () => {
    setEditing(false);
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n) && n >= 0) onChange(n);
  };

  return (
    <div className="option-grid option-grid-3">
      <button
        type="button"
        className={`option-card${value === 'none' ? ' active' : ''}`}
        onClick={() => onChange('none')}
      >
        <span className="option-card-label">None</span>
        <span className="option-card-sublabel">No game changers</span>
      </button>
      {editing ? (
        <div className="option-card option-card-editing">
          <input
            ref={inputRef}
            className="option-card-input"
            type="number"
            min={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <span className="option-card-sublabel">max count</span>
        </div>
      ) : (
        <button
          type="button"
          className={`option-card${isCustom ? ' active' : ''}`}
          onClick={() => {
            setDraft(isCustom ? String(value) : '3');
            setEditing(true);
          }}
        >
          <span className="option-card-label">{isCustom ? `Up to ${value}` : 'Custom'}</span>
          <span className="option-card-sublabel">Set a limit</span>
        </button>
      )}
      <button
        type="button"
        className={`option-card${value === 'unlimited' ? ' active' : ''}`}
        onClick={() => onChange('unlimited')}
      >
        <span className="option-card-label">Unlimited</span>
        <span className="option-card-sublabel">No restriction</span>
      </button>
    </div>
  );
}

// ── Tempo ─────────────────────────────────────────────────────────────────
function TempoGroup({ customization, update }: DeckCustomizerProps) {
  const pacings: { value: Pacing; label: string }[] = [
    { value: 'aggressive-early', label: 'Aggressive' },
    { value: 'fast-tempo', label: 'Fast' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'midrange', label: 'Midrange' },
    { value: 'late-game', label: 'Late game' },
  ];
  return (
    <>
      <p
        style={{
          margin: '0 0 0.75rem',
          fontSize: '0.85em',
          lineHeight: 1.4,
          opacity: 0.75,
        }}
      >
        Tempo shapes the mana curve and play pattern — aggressive decks load up on cheap threats,
        late-game decks lean on big payoffs. Auto-detect picks a profile from{' '}
        <a
          href="https://edhrec.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit', textDecoration: 'underline' }}
        >
          EDHREC
        </a>
        &apos;s stats for your commander.
      </p>
      <Toggle
        label="Auto-detect from EDHREC stats"
        checked={customization.tempoAutoDetect}
        onChange={(v) => update({ tempoAutoDetect: v })}
      />
      <Field label="Pacing">
        <OptionGrid<Pacing>
          value={customization.tempoPacing}
          disabled={customization.tempoAutoDetect}
          options={pacings}
          onChange={(v) => update({ tempoPacing: v })}
        />
      </Field>
    </>
  );
}

// ── Scryfall query ────────────────────────────────────────────────────────
function ScryfallGroup({ customization, update }: DeckCustomizerProps) {
  return (
    <Field
      label="Additional Scryfall query"
      hint="Appended to every card-pool query."
      align="stretch"
    >
      <input
        type="text"
        className="deck-customizer-text-input"
        value={customization.scryfallQuery}
        placeholder="e.g. -is:reprint or set:mkm"
        onChange={(e) => update({ scryfallQuery: e.target.value })}
      />
    </Field>
  );
}

// ── Card name pickers (must-include / excluded) ──────────────────────────
function CardListGroup({
  hint,
  values,
  onChange,
}: {
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <>
      <p className="deck-customizer-hint">{hint}</p>
      <CardNameAutocomplete
        onPick={(name) => {
          if (values.includes(name)) return;
          onChange([...values, name]);
        }}
      />
      {values.length > 0 && (
        <ul className="deck-customizer-pills">
          {values.map((name) => (
            <li key={name} className="deck-customizer-pill">
              <span>{name}</span>
              <button
                type="button"
                className="deck-customizer-pill-remove"
                aria-label={`Remove ${name}`}
                onClick={() => onChange(values.filter((v) => v !== name))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CardNameAutocomplete({ onPick }: { onPick: (name: string) => void }) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const q = input.trim();
    if (q.length < 2) {
      Promise.resolve().then(() => {
        if (!cancelled) {
          setSuggestions([]);
          setLoading(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    Promise.resolve().then(() => {
      if (!cancelled) setLoading(true);
    });
    debounceRef.current = window.setTimeout(() => {
      autocompleteCardName(q)
        .then((list) => {
          if (!cancelled) setSuggestions(list.slice(0, 8));
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [input]);

  const handlePick = (name: string) => {
    onPick(name);
    setInput('');
    setSuggestions([]);
  };

  return (
    <div className="deck-customizer-autocomplete">
      <input
        type="text"
        className="deck-customizer-autocomplete-input"
        value={input}
        placeholder="Search cards…"
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && suggestions[0]) {
            e.preventDefault();
            handlePick(suggestions[0]);
          }
        }}
      />
      {input.trim().length >= 2 && (
        <ul className="deck-customizer-autocomplete-list">
          {loading && <li className="deck-customizer-autocomplete-empty">Searching…</li>}
          {!loading && suggestions.length === 0 && (
            <li className="deck-customizer-autocomplete-empty">No matches</li>
          )}
          {suggestions.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="deck-customizer-autocomplete-item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handlePick(name);
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────

/** Wrap a control with a centered label above it (and an optional hint below). */
function Field({
  label,
  hint,
  align = 'center',
  children,
}: {
  label: string;
  hint?: string;
  align?: 'center' | 'stretch';
  children: React.ReactNode;
}) {
  return (
    <div className={`deck-customizer-field deck-customizer-field-${align}`}>
      <span className="deck-customizer-field-label">{label}</span>
      <div className="deck-customizer-field-control">{children}</div>
      {hint && <small className="deck-customizer-field-hint">{hint}</small>}
    </div>
  );
}

interface OptionGridItem<T> {
  value: T;
  label: string;
  sublabel?: string;
}

/** Pill-card grid of mutually-exclusive options. Replaces small-N <select>s. */
function OptionGrid<T extends string | number | null>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: OptionGridItem<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`option-grid option-grid-${Math.min(5, options.length)}`}
      role="radiogroup"
      aria-disabled={disabled}
    >
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={`option-card${value === opt.value ? ' active' : ''}`}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
        >
          <span className="option-card-label">{opt.label}</span>
          {opt.sublabel && <span className="option-card-sublabel">{opt.sublabel}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Preset row + Custom click-to-edit numeric input. `null` is treated as "no
 * limit" / unset; selecting it commits null upstream.
 */
function PresetEditableNumber({
  value,
  presets,
  formatPreset,
  formatCustom,
  onChange,
  ariaLabel,
}: {
  value: number | null;
  presets: (number | null)[];
  formatPreset: (v: number | null) => string;
  formatCustom: (v: number) => string;
  onChange: (n: number | null) => void;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const isPreset = presets.some((p) => p === value);
  const showCustomActive = value !== null && !isPreset;

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v === '') return;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) onChange(n);
  };

  return (
    <div className="preset-row">
      {presets.map((p) => {
        const active = value === p;
        return (
          <button
            key={p === null ? 'none' : String(p)}
            type="button"
            aria-pressed={active}
            className={`preset-pill${active ? ' active' : ''}${p === null && active ? ' preset-pill-none' : ''}`}
            onClick={() => {
              setEditing(false);
              onChange(p);
            }}
          >
            {formatPreset(p)}
          </button>
        );
      })}
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          min={0}
          step="0.01"
          className="preset-pill preset-pill-input"
          aria-label={ariaLabel}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button
          type="button"
          aria-pressed={showCustomActive}
          className={`preset-pill${showCustomActive ? ' active' : ''}`}
          onClick={() => {
            setDraft(value !== null && !isPreset ? String(value) : '');
            setEditing(true);
          }}
        >
          {showCustomActive ? formatCustom(value!) : 'Custom'}
        </button>
      )}
    </div>
  );
}

/** Themed checkbox row used by the customizer. */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="field-checkbox deck-customizer-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Range slider with archetype anchors and a current-value chip. */
function RangeSlider({
  label,
  ariaLabel,
  value,
  min,
  max,
  onChange,
  anchors,
  valueSuffix,
  suggested,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  anchors: { value: number; label: string }[];
  valueSuffix?: string;
  suggested?: boolean;
}) {
  return (
    <div className="deck-customizer-slider">
      <div className="deck-customizer-slider-header">
        <span className="deck-customizer-slider-label">
          {label}
          {suggested && (
            <span
              className="deck-customizer-slider-suggested"
              aria-label="Matches EDHREC suggestion"
            >
              <Check width={12} height={12} strokeWidth={3} aria-hidden />
              suggested
            </span>
          )}
        </span>
        <span className="deck-customizer-slider-value">
          {value}
          {valueSuffix && (
            <span className="deck-customizer-slider-value-suffix"> {valueSuffix}</span>
          )}
        </span>
      </div>
      <input
        type="range"
        className="deck-customizer-range"
        min={min}
        max={max}
        value={Math.max(min, Math.min(max, value))}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          ['--range-progress' as string]: `${
            max === min ? 0 : ((Math.max(min, Math.min(max, value)) - min) / (max - min)) * 100
          }%`,
        }}
      />
      <div className="deck-customizer-slider-anchors">
        {anchors.map((a, i) => (
          <span
            key={`${a.value}-${i}`}
            className="deck-customizer-slider-anchor"
            data-align={i === 0 ? 'start' : i === anchors.length - 1 ? 'end' : 'center'}
          >
            <span className="deck-customizer-slider-anchor-value">{a.value}</span>{' '}
            <span className="deck-customizer-slider-anchor-label">({a.label})</span>
          </span>
        ))}
      </div>
    </div>
  );
}
