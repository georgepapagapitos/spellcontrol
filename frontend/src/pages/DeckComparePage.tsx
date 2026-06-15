import './DeckComparePage.css';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDecksStore, type Deck } from '../store/decks';
import type { ScryfallCard } from '@/deck-builder/types';
import { SelectMenu, type SelectOption } from '../components/SelectMenu';
import { DeckCurvePhases } from '../components/deck/DeckCurvePhases';
import { DeckColorPanel } from '../components/deck/DeckColorPanel';
import { BracketVerdictStrip } from '../components/deck/BracketVerdictStrip';
import { MeterBar } from '../components/shared/MeterBar';
import { diffDecks, type CardDelta } from '@/lib/deck-diff';
import { buildManaData } from '@/lib/build-mana-data';
import { useTaggerReady } from '@/lib/use-tagger-ready';

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Flat card list (commanders + mainboard) — the shape buildManaData/analyzeDeck want. */
const allCardsOf = (deck: Deck): ScryfallCard[] => {
  const list: ScryfallCard[] = [];
  if (deck.commander) list.push(deck.commander);
  if (deck.partnerCommander) list.push(deck.partnerCommander);
  for (const dc of deck.cards) list.push(dc.card);
  return list;
};

// Added / removed / changed each get a text glyph + word so the signal is never
// color-only (the tone class is purely additive).
const TONE = {
  added: { cls: 'is-added', glyph: '+', word: 'Added' },
  removed: { cls: 'is-removed', glyph: '−', word: 'Removed' },
  changed: { cls: 'is-changed', glyph: '~', word: 'Changed' },
} as const;
type Tone = keyof typeof TONE;

function DiffCardRow({ delta, tone }: { delta: CardDelta; tone: Tone }) {
  const t = TONE[tone];
  const qty =
    tone === 'added'
      ? `+${delta.toQty}`
      : tone === 'removed'
        ? `−${delta.fromQty}`
        : `${delta.fromQty} → ${delta.toQty}`;
  const ariaLabel =
    tone === 'changed'
      ? `${t.word}: ${delta.card.name}, ${delta.fromQty} to ${delta.toQty} copies`
      : `${t.word}: ${delta.card.name}${delta.toQty + delta.fromQty > 1 ? `, ${Math.max(delta.toQty, delta.fromQty)} copies` : ''}`;
  return (
    <li className={`deck-compare-diff-row ${t.cls}`} aria-label={ariaLabel}>
      <span className="deck-compare-diff-bar" aria-hidden="true" />
      <span className="deck-compare-diff-glyph" aria-hidden="true">
        {t.glyph}
      </span>
      <span className="deck-compare-diff-name" title={delta.card.name}>
        {delta.card.name}
      </span>
      <span className="deck-compare-diff-qty" aria-hidden="true">
        {qty}
      </span>
    </li>
  );
}

const COLLAPSE_AT = 8;

function DiffGroup({ tone, deltas }: { tone: Tone; deltas: CardDelta[] }) {
  const [expanded, setExpanded] = useState(false);
  if (deltas.length === 0) return null;
  const t = TONE[tone];
  const collapsible = deltas.length > COLLAPSE_AT;
  const visible = expanded || !collapsible ? deltas : deltas.slice(0, COLLAPSE_AT);
  const hidden = deltas.length - COLLAPSE_AT;
  const listId = `dcp-${tone}-list`;
  return (
    <div className="deck-compare-diff-group">
      <h4 className="deck-compare-diff-group-title">
        {t.word} ({deltas.length})
      </h4>
      <ul className="deck-compare-diff-list" id={listId} role="list">
        {visible.map((d) => (
          <DiffCardRow key={d.card.oracle_id || d.card.name} delta={d} tone={tone} />
        ))}
      </ul>
      {collapsible && (
        <button
          type="button"
          className="deck-compare-show-more"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </div>
  );
}

/** A → B with a signed, color-AND-text delta and a screen-reader sentence. */
function DiffStatChip({
  label,
  a,
  b,
  decimals = 0,
  format,
}: {
  label: string;
  a: number;
  b: number;
  decimals?: number;
  format?: 'usd';
}) {
  const fmt = (n: number) => (format === 'usd' ? usd(n) : n.toFixed(decimals));
  const delta = b - a;
  const dir = delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'unchanged';
  const toneCls = delta > 0 ? 'is-added' : delta < 0 ? 'is-removed' : '';
  const signed = `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${fmt(Math.abs(delta))}`;
  return (
    <div className="deck-compare-stat-chip">
      <span className="deck-compare-stat-chip-label">{label}</span>
      <span className="deck-compare-stat-chip-value">
        <span aria-hidden="true">
          {fmt(a)} → {fmt(b)}
        </span>{' '}
        <span
          className={`deck-compare-delta-tag ${toneCls}`}
          aria-label={`${label} ${dir} to ${fmt(b)}`}
        >
          {signed}
        </span>
      </span>
    </div>
  );
}

/** Label + A→B + signed delta row, for the roles/types composition grid. */
function DeltaRow({ label, a, b }: { label: string; a: number; b: number }) {
  const delta = b - a;
  const dir = delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'unchanged';
  const toneCls = delta > 0 ? 'is-added' : delta < 0 ? 'is-removed' : '';
  return (
    <div
      className="deck-compare-delta-row"
      aria-label={`${label}: Deck A ${a}, Deck B ${b}, ${dir}`}
    >
      <span className="deck-compare-delta-label">{label}</span>
      <span className="deck-compare-delta-counts" aria-hidden="true">
        {a} → {b}
        {delta !== 0 && (
          <span className={`deck-compare-delta-tag ${toneCls}`}>
            {' '}
            {delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}
          </span>
        )}
      </span>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  creatures: 'Creatures',
  instants: 'Instants',
  sorceries: 'Sorceries',
  artifacts: 'Artifacts',
  enchantments: 'Enchantments',
  planeswalkers: 'Planeswalkers',
  battles: 'Battles',
  lands: 'Lands',
  other: 'Other',
};

export function DeckComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const decks = useDecksStore((s) => s.decks);
  const hydrated = useDecksStore((s) => s.hydrated);
  const taggerReady = useTaggerReady();

  const aId = searchParams.get('a') ?? '';
  const bId = searchParams.get('b') ?? '';
  const deckA = decks.find((d) => d.id === aId) ?? null;
  const deckB = decks.find((d) => d.id === bId) ?? null;

  const options: SelectOption<string>[] = useMemo(
    () => [
      { value: '', label: 'Select a deck' },
      ...decks.map((d) => ({ value: d.id, label: d.name })),
    ],
    [decks]
  );

  const setSide = (side: 'a' | 'b') => (id: string) =>
    setSearchParams(
      (p) => {
        if (id) p.set(side, id);
        else p.delete(side);
        return p;
      },
      { replace: true }
    );

  const diff = useMemo(
    () => (deckA && deckB ? diffDecks(deckA, deckB, taggerReady) : null),
    [deckA, deckB, taggerReady]
  );
  const manaA = useMemo(
    () =>
      deckA ? buildManaData(allCardsOf(deckA), deckA.commander, deckA.partnerCommander) : null,
    [deckA]
  );
  const manaB = useMemo(
    () =>
      deckB ? buildManaData(allCardsOf(deckB), deckB.commander, deckB.partnerCommander) : null,
    [deckB]
  );

  const heading = deckA && deckB ? `${deckA.name} vs ${deckB.name}` : 'Compare decks';

  return (
    <div className="deck-compare-page">
      <h1 className="deck-compare-heading">{heading}</h1>

      {!hydrated ? (
        <div className="deck-compare-skeleton" aria-hidden="true">
          <span className="deck-compare-skeleton-bar is-headline" />
          <span className="deck-compare-skeleton-bar is-body" />
        </div>
      ) : (
        <>
          <div className="deck-compare-picker-row">
            <SelectMenu
              value={aId}
              options={options}
              onChange={setSide('a')}
              ariaLabel="Deck A"
              placeholder="Deck A"
            />
            <span className="deck-compare-vs" aria-hidden="true">
              vs
            </span>
            <SelectMenu
              value={bId}
              options={options}
              onChange={setSide('b')}
              ariaLabel="Deck B"
              placeholder="Deck B"
            />
          </div>

          {!diff || !deckA || !deckB || !manaA || !manaB ? (
            <div className="deck-compare-empty">
              <p className="deck-compare-empty-title">Pick two decks to compare</p>
              <p className="deck-compare-empty-hint">
                Select decks above, or open any deck and tap Compare from its menu.
              </p>
            </div>
          ) : (
            <>
              {/* Summary */}
              <p className="deck-compare-summary">
                {diff.cards.added.length} added · {diff.cards.removed.length} removed ·{' '}
                {diff.cards.changed.length} changed · {diff.cards.unchangedCount} unchanged
              </p>

              {/* 1 — Card delta */}
              <section className="deck-compare-section" aria-labelledby="dcp-cards-heading">
                <h2 id="dcp-cards-heading" className="deck-compare-section-title">
                  What changed
                </h2>
                <DiffGroup tone="added" deltas={diff.cards.added} />
                <DiffGroup tone="removed" deltas={diff.cards.removed} />
                <DiffGroup tone="changed" deltas={diff.cards.changed} />
                {diff.cards.added.length === 0 &&
                  diff.cards.removed.length === 0 &&
                  diff.cards.changed.length === 0 && (
                    <p className="deck-compare-empty-hint">Card lists are identical.</p>
                  )}
              </section>

              {/* 2 — Stat chips */}
              <section className="deck-compare-section" aria-labelledby="dcp-stats-heading">
                <h2 id="dcp-stats-heading" className="deck-compare-section-title">
                  Stats
                </h2>
                <div className="deck-compare-stat-chips">
                  <DiffStatChip label="Size" a={diff.stats.size.a} b={diff.stats.size.b} />
                  <DiffStatChip
                    label="Avg CMC"
                    a={diff.stats.curve.averageCmc.a}
                    b={diff.stats.curve.averageCmc.b}
                    decimals={1}
                  />
                  <DiffStatChip
                    label="Price"
                    a={diff.price.aTotal}
                    b={diff.price.bTotal}
                    format="usd"
                  />
                </div>
              </section>

              {/* 3 — Mana curve 2-up */}
              <section className="deck-compare-section" aria-labelledby="dcp-curve-heading">
                <h2 id="dcp-curve-heading" className="deck-compare-section-title">
                  Mana curve
                </h2>
                <div className="deck-compare-2up">
                  <div className="deck-compare-col">
                    <p className="deck-compare-deck-label">{deckA.name}</p>
                    <DeckCurvePhases manaCurve={manaA.manaCurve} averageCmc={manaA.averageCmc} />
                  </div>
                  <div className="deck-compare-col">
                    <p className="deck-compare-deck-label">{deckB.name}</p>
                    <DeckCurvePhases manaCurve={manaB.manaCurve} averageCmc={manaB.averageCmc} />
                  </div>
                </div>
              </section>

              {/* 4 — Composition (types + roles) */}
              <section className="deck-compare-section" aria-labelledby="dcp-comp-heading">
                <h2 id="dcp-comp-heading" className="deck-compare-section-title">
                  Composition
                </h2>
                <div className="deck-compare-comp-grid">
                  <div className="deck-compare-comp-col">
                    <h3 className="deck-compare-comp-label">Types</h3>
                    {Object.entries(diff.stats.types).map(([key, s]) => (
                      <DeltaRow key={key} label={TYPE_LABEL[key] ?? key} a={s.a} b={s.b} />
                    ))}
                  </div>
                  <div className="deck-compare-comp-col">
                    <h3 className="deck-compare-comp-label">Roles</h3>
                    {diff.stats.taggerReady ? (
                      diff.stats.roles.map((role) => (
                        <DeltaRow
                          key={role.key}
                          label={role.label}
                          a={role.delta.a}
                          b={role.delta.b}
                        />
                      ))
                    ) : (
                      <p className="deck-compare-tagger-notice" aria-live="polite">
                        Role data loading…
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {/* 5 — Color / mana base 2-up */}
              <section className="deck-compare-section" aria-labelledby="dcp-color-heading">
                <h2 id="dcp-color-heading" className="deck-compare-section-title">
                  Mana base
                </h2>
                <div className="deck-compare-2up">
                  <div className="deck-compare-col">
                    <p className="deck-compare-deck-label">{deckA.name}</p>
                    <DeckColorPanel
                      colorDist={manaA.colorDist}
                      manaProduction={manaA.manaProduction}
                      manaCurve={manaA.manaCurve}
                    />
                  </div>
                  <div className="deck-compare-col">
                    <p className="deck-compare-deck-label">{deckB.name}</p>
                    <DeckColorPanel
                      colorDist={manaB.colorDist}
                      manaProduction={manaB.manaProduction}
                      manaCurve={manaB.manaCurve}
                    />
                  </div>
                </div>
              </section>

              {/* 6 — Bracket & price */}
              <section className="deck-compare-section" aria-labelledby="dcp-power-heading">
                <h2 id="dcp-power-heading" className="deck-compare-section-title">
                  Bracket &amp; price
                </h2>
                <div className="deck-compare-2up">
                  <div className="deck-compare-col">
                    <p className="deck-compare-deck-label">{deckA.name}</p>
                    <p className="deck-compare-bracket-num">
                      {diff.bracket.a.bracket != null ? `B${diff.bracket.a.bracket}` : '—'}
                      {diff.bracket.a.gradeLetter && (
                        <span className="deck-compare-grade"> · {diff.bracket.a.gradeLetter}</span>
                      )}
                    </p>
                    <BracketVerdictStrip
                      target={deckA.bracketOverride ?? undefined}
                      detected={diff.bracket.a.bracket}
                    />
                  </div>
                  <div className="deck-compare-col">
                    <p className="deck-compare-deck-label">{deckB.name}</p>
                    <p className="deck-compare-bracket-num">
                      {diff.bracket.b.bracket != null ? `B${diff.bracket.b.bracket}` : '—'}
                      {diff.bracket.b.gradeLetter && (
                        <span className="deck-compare-grade"> · {diff.bracket.b.gradeLetter}</span>
                      )}
                    </p>
                    <BracketVerdictStrip
                      target={deckB.bracketOverride ?? undefined}
                      detected={diff.bracket.b.bracket}
                    />
                  </div>
                </div>

                <div className="deck-compare-price-panel">
                  <div className="deck-compare-price-col">
                    <span className="deck-compare-price-name">{deckA.name}</span>
                    <span className="deck-compare-price-amount">{usd(diff.price.aTotal)}</span>
                    <MeterBar
                      value={diff.price.aTotal}
                      max={Math.max(diff.price.aTotal, diff.price.bTotal, 1)}
                    />
                  </div>
                  <div className="deck-compare-price-col">
                    <span className="deck-compare-price-name">{deckB.name}</span>
                    <span className="deck-compare-price-amount">{usd(diff.price.bTotal)}</span>
                    <MeterBar
                      value={diff.price.bTotal}
                      max={Math.max(diff.price.aTotal, diff.price.bTotal, 1)}
                    />
                  </div>
                </div>
                <p
                  className={`deck-compare-price-delta ${diff.price.delta > 0 ? 'is-removed' : diff.price.delta < 0 ? 'is-added' : ''}`}
                >
                  {diff.price.delta === 0
                    ? 'Same total price'
                    : `${deckB.name} costs ${usd(Math.abs(diff.price.delta))} ${diff.price.delta > 0 ? 'more' : 'less'} than ${deckA.name}`}
                </p>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
