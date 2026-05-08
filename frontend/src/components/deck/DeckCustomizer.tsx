import { useEffect, useRef, useState } from 'react';
import type {
  BudgetOption,
  Customization,
  GameChangerLimit,
  MaxRarity,
  Pacing,
} from '@/deck-builder/types';
import { autocompleteCardName } from '@/deck-builder/services/scryfall/client';

type Update = (patch: Partial<Customization>) => void;

interface DeckCustomizerProps {
  customization: Customization;
  update: Update;
}

export function DeckCustomizer({ customization, update }: DeckCustomizerProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="deck-builder-section deck-customizer">
      <button
        type="button"
        className="deck-customizer-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="deck-builder-section-title">Advanced settings</span>
        <span className="deck-customizer-summary">{summarise(customization)}</span>
        <span className="deck-customizer-caret" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="deck-customizer-body">
          <SizeAndLandsGroup customization={customization} update={update} />
          <BudgetGroup customization={customization} update={update} />
          <PoolGroup customization={customization} update={update} />
          <TempoGroup customization={customization} update={update} />
          <ScryfallGroup customization={customization} update={update} />
          <CardListGroup
            label="Must-include cards"
            hint="These cards are forced into the deck before EDHREC suggestions are considered."
            values={customization.mustIncludeCards}
            onChange={(next) => update({ mustIncludeCards: next })}
          />
          <CardListGroup
            label="Excluded cards"
            hint="These cards will never be suggested by the generator."
            values={customization.bannedCards}
            onChange={(next) => update({ bannedCards: next })}
          />
        </div>
      )}
    </section>
  );
}

function summarise(c: Customization): string {
  const parts: string[] = [];
  if (c.deckBudget !== null) parts.push(`Budget $${c.deckBudget}`);
  if (c.maxCardPrice !== null) parts.push(`Max $${c.maxCardPrice}/card`);
  if (c.maxRarity) parts.push(`≤ ${c.maxRarity}`);
  if (c.budgetOption !== 'any') parts.push(c.budgetOption);
  if (c.gameChangerLimit !== 'unlimited') parts.push(`GC: ${c.gameChangerLimit}`);
  if (c.comboCount !== 1) parts.push(comboLabel(c.comboCount));
  if (c.scryfallQuery.trim()) parts.push('Scryfall filter');
  if (c.mustIncludeCards.length > 0) parts.push(`${c.mustIncludeCards.length} must-include`);
  if (c.bannedCards.length > 0) parts.push(`${c.bannedCards.length} excluded`);
  return parts.length === 0 ? 'Defaults' : parts.join(' · ');
}

function comboLabel(n: number): string {
  switch (n) {
    case 0:
      return 'No combos';
    case 2:
      return 'A few extra combos';
    case 3:
      return 'Many combos';
    default:
      return 'Combos: normal';
  }
}

// ── Size + lands ──────────────────────────────────────────────────────────
function SizeAndLandsGroup({ customization, update }: DeckCustomizerProps) {
  const total = customization.landCount;
  const nonBasic = Math.min(customization.nonBasicLandCount, total);
  const basics = total - nonBasic;

  return (
    <fieldset className="deck-customizer-group">
      <legend>Lands</legend>
      <NumberStepper
        label="Total lands"
        min={20}
        max={45}
        value={total}
        onChange={(n) => update({ landCount: n })}
      />
      <NumberStepper
        label={`Non-basic lands (${basics} basic${basics === 1 ? '' : 's'})`}
        min={0}
        max={total}
        value={nonBasic}
        onChange={(n) => update({ nonBasicLandCount: n })}
      />
    </fieldset>
  );
}

// ── Budget ────────────────────────────────────────────────────────────────
function BudgetGroup({ customization, update }: DeckCustomizerProps) {
  return (
    <fieldset className="deck-customizer-group">
      <legend>Budget</legend>
      <NullableNumberInput
        label="Total deck budget (USD)"
        placeholder="No limit"
        value={customization.deckBudget}
        onChange={(n) => update({ deckBudget: n })}
      />
      <NullableNumberInput
        label="Max card price (USD)"
        placeholder="No limit"
        value={customization.maxCardPrice}
        onChange={(n) => update({ maxCardPrice: n })}
      />
      <label className="field-checkbox">
        <input
          type="checkbox"
          checked={customization.ignoreOwnedBudget}
          onChange={(e) => update({ ignoreOwnedBudget: e.target.checked })}
        />
        <span>Owned cards do not count toward budget</span>
      </label>
    </fieldset>
  );
}

// ── EDHREC pool / rarity / game changers / combos ────────────────────────
function PoolGroup({ customization, update }: DeckCustomizerProps) {
  return (
    <fieldset className="deck-customizer-group">
      <legend>Card pool</legend>
      <label className="deck-builder-field">
        <span>EDHREC card pool</span>
        <select
          value={customization.budgetOption}
          onChange={(e) => update({ budgetOption: e.target.value as BudgetOption })}
        >
          <option value="any">Any</option>
          <option value="budget">Budget</option>
          <option value="expensive">Expensive</option>
        </select>
      </label>
      <label className="deck-builder-field">
        <span>Max card rarity</span>
        <select
          value={customization.maxRarity ?? ''}
          onChange={(e) => update({ maxRarity: (e.target.value as MaxRarity) || null })}
        >
          <option value="">No limit</option>
          <option value="common">Common</option>
          <option value="uncommon">Uncommon</option>
          <option value="rare">Rare</option>
          <option value="mythic">Mythic</option>
        </select>
        <small>Owned cards skipped from this rule when "ignore owned" is on.</small>
      </label>
      <label className="field-checkbox">
        <input
          type="checkbox"
          checked={customization.ignoreOwnedRarity}
          onChange={(e) => update({ ignoreOwnedRarity: e.target.checked })}
        />
        <span>Owned cards skip rarity limit</span>
      </label>
      <label className="deck-builder-field">
        <span>Game changers</span>
        <select
          value={String(customization.gameChangerLimit)}
          onChange={(e) => {
            const v = e.target.value;
            const next: GameChangerLimit =
              v === 'unlimited' ? 'unlimited' : v === 'none' ? 'none' : Number(v);
            update({ gameChangerLimit: next });
          }}
        >
          <option value="none">None</option>
          <option value="0">0</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="unlimited">Unlimited</option>
        </select>
        <small>EDHREC-flagged high-impact cards.</small>
      </label>
      <label className="deck-builder-field">
        <span>Combos</span>
        <select
          value={String(customization.comboCount)}
          onChange={(e) => update({ comboCount: Number(e.target.value) })}
        >
          <option value="0">None</option>
          <option value="1">Normal</option>
          <option value="2">A few extra</option>
          <option value="3">Many</option>
        </select>
      </label>
    </fieldset>
  );
}

// ── Tempo ─────────────────────────────────────────────────────────────────
function TempoGroup({ customization, update }: DeckCustomizerProps) {
  const pacings: { value: Pacing; label: string }[] = [
    { value: 'aggressive-early', label: 'Aggressive (early)' },
    { value: 'fast-tempo', label: 'Fast tempo' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'midrange', label: 'Midrange' },
    { value: 'late-game', label: 'Late game' },
  ];
  return (
    <fieldset className="deck-customizer-group">
      <legend>Tempo</legend>
      <label className="field-checkbox">
        <input
          type="checkbox"
          checked={customization.tempoAutoDetect}
          onChange={(e) => update({ tempoAutoDetect: e.target.checked })}
        />
        <span>Auto-detect from EDHREC stats</span>
      </label>
      <label className="deck-builder-field">
        <span>Pacing</span>
        <select
          value={customization.tempoPacing}
          disabled={customization.tempoAutoDetect}
          onChange={(e) => update({ tempoPacing: e.target.value as Pacing })}
        >
          {pacings.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

// ── Scryfall query ────────────────────────────────────────────────────────
function ScryfallGroup({ customization, update }: DeckCustomizerProps) {
  return (
    <fieldset className="deck-customizer-group">
      <legend>Scryfall filter</legend>
      <label className="deck-builder-field deck-builder-field-wide">
        <span>Additional Scryfall query</span>
        <input
          type="text"
          value={customization.scryfallQuery}
          placeholder="e.g. -is:reprint or set:mkm"
          onChange={(e) => update({ scryfallQuery: e.target.value })}
        />
        <small>Appended to every card-pool query.</small>
      </label>
    </fieldset>
  );
}

// ── Card name pickers (must-include / excluded) ──────────────────────────
function CardListGroup({
  label,
  hint,
  values,
  onChange,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="deck-customizer-group">
      <legend>{label}</legend>
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
    </fieldset>
  );
}

function CardNameAutocomplete({ onPick }: { onPick: (name: string) => void }) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    const q = input.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    setLoading(true);
    debounceRef.current = window.setTimeout(() => {
      autocompleteCardName(q)
        .then((list) => setSuggestions(list.slice(0, 8)))
        .catch(() => setSuggestions([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => {
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
function NumberStepper({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <label className="deck-builder-field">
      <span>{label}</span>
      <span className="number-stepper">
        <button
          type="button"
          className="number-stepper-btn"
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value) || min))}
        />
        <button
          type="button"
          className="number-stepper-btn"
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </span>
    </label>
  );
}

function NullableNumberInput({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: number | null;
  onChange: (n: number | null) => void;
}) {
  return (
    <label className="deck-builder-field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        step="0.01"
        value={value === null ? '' : value}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value.trim();
          if (v === '') {
            onChange(null);
            return;
          }
          const n = Number(v);
          onChange(Number.isFinite(n) && n >= 0 ? n : null);
        }}
      />
    </label>
  );
}
