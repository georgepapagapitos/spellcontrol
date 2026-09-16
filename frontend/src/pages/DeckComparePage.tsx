import './DeckComparePage.css';
import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BackLink } from '../components/BackLink';
import { useDecksStore, type Deck } from '../store/decks';
import type { ScryfallCard } from '@/deck-builder/types';
import { SelectMenu, type SelectOption } from '../components/SelectMenu';
import { BracketVerdictStrip } from '../components/deck/BracketVerdictStrip';
import { MeterBar, StackedBar } from '../components/shared/MeterBar';
import { InfoTip } from '../components/InfoTip';
import { DiffGroup } from '../components/deck/DiffCardRow';
import { diffDecks, type DeckDiff } from '@/lib/deck-diff';
import { formatRelativeTime } from '../lib/format-time';
import { buildManaData, type DeckManaData } from '@/lib/build-mana-data';
import { gradeCurve, type CurveGrading } from '@/deck-builder/services/deckBuilder/curveGrading';
import { useCurrency } from '@/lib/currency';
import { formatMoney } from '@/lib/format-money';
import { useTaggerReady } from '@/lib/use-tagger-ready';
import { EmptyStateMark } from '../components/shared/EmptyStateMark';

// Totals are computed by diffDecks in the active display currency, and
// formatMoney's default is that same currency — number and symbol agree.
const money = (n: number) => formatMoney(n);

/** Flat card list (commanders + mainboard) — the shape buildManaData wants. */
const allCardsOf = (deck: Deck): ScryfallCard[] => {
  const list: ScryfallCard[] = [];
  if (deck.commander) list.push(deck.commander);
  if (deck.partnerCommander) list.push(deck.partnerCommander);
  for (const dc of deck.cards) list.push(dc.card);
  return list;
};

/* ───────────────────────────────────────────────────────────────────────────
 * The compare table.
 *
 * Every number on this page belongs to one of two decks — so it never appears
 * without a column header naming which. A bare `19 → 16` (the old layout) is
 * unreadable; a `Forest | 19 | 16 | −3` row under the two deck names is not.
 * The Difference column is computed from the DISPLAYED (rounded) values, so a
 * change that rounds away reads "same" instead of the old nonsense "−0.0".
 * ─────────────────────────────────────────────────────────────────────────── */

const round = (n: number, decimals: number) => Number(n.toFixed(decimals));

function CompareTable({
  rowHeader,
  aName,
  bName,
  children,
}: {
  rowHeader: string;
  aName: string;
  bName: string;
  children: ReactNode;
}) {
  return (
    <div className="deck-compare-table-wrap">
      <table className="deck-compare-table">
        <thead>
          <tr>
            <th scope="col" className="deck-compare-col-label">
              {rowHeader}
            </th>
            <th scope="col" className="deck-compare-col-deck">
              {aName}
            </th>
            <th scope="col" className="deck-compare-col-deck">
              {bName}
            </th>
            <th scope="col" className="deck-compare-col-diff">
              Difference
            </th>
          </tr>
        </thead>
        {children}
      </table>
    </div>
  );
}

/** A labelled band inside a compare table ("Card types", "What the cards do"). */
function CompareGroup({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <tbody className="deck-compare-tbody">
      {title && (
        <tr>
          <th scope="colgroup" colSpan={4} className="deck-compare-group-title">
            {title}
          </th>
        </tr>
      )}
      {children}
    </tbody>
  );
}

function CompareRow({
  label,
  a,
  b,
  subA,
  subB,
  decimals = 0,
  asMoney = false,
  /** Set when a bigger B is the worse direction — price. */
  invert = false,
}: {
  label: string;
  a: number;
  b: number;
  subA?: string;
  subB?: string;
  decimals?: number;
  asMoney?: boolean;
  invert?: boolean;
}) {
  const places = asMoney ? 2 : decimals;
  const ra = round(a, places);
  const rb = round(b, places);
  const delta = round(rb - ra, places);
  const fmt = (n: number) => (asMoney ? money(n) : n.toFixed(decimals));
  const good = invert ? delta < 0 : delta > 0;
  const toneCls = delta === 0 ? '' : good ? 'is-added' : 'is-removed';
  // A zero delta reads as a word, never "+0" (STYLE_GUIDE § Money deltas).
  const diffText = delta === 0 ? 'same' : `${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))}`;
  return (
    <tr>
      <th scope="row" className="deck-compare-row-label">
        {label}
      </th>
      <td className="deck-compare-num">
        {fmt(ra)}
        {subA && <span className="deck-compare-sub">{subA}</span>}
      </td>
      <td className="deck-compare-num">
        {fmt(rb)}
        {subB && <span className="deck-compare-sub">{subB}</span>}
      </td>
      <td className="deck-compare-num">
        <span className={`deck-compare-delta-tag ${toneCls}`}>{diffText}</span>
      </td>
    </tr>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Paired mana curve — one chart with two bars per mana value, instead of two
 * separate charts the reader has to diff by eye. A vertical chart, so it stays
 * bespoke (STYLE_GUIDE § Bars & meters).
 * ─────────────────────────────────────────────────────────────────────────── */

const CMC_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

function CurveCompare({
  curveA,
  curveB,
  aName,
  bName,
}: {
  curveA: Record<number, number>;
  curveB: Record<number, number>;
  aName: string;
  bName: string;
}) {
  const slots = CMC_SLOTS.map((cmc) => ({
    cmc,
    label: cmc === 7 ? '7+' : String(cmc),
    a: curveA[cmc] ?? 0,
    b: curveB[cmc] ?? 0,
  }));
  const max = slots.reduce((m, s) => Math.max(m, s.a, s.b), 0) || 1;
  const height = (n: number) => `${(n / max) * 100}%`;

  return (
    <ul className="deck-compare-curve" aria-label="Cards by mana value">
      {slots.map((slot) => (
        <li
          key={slot.cmc}
          className="deck-compare-curve-slot"
          aria-label={`${slot.label} mana: ${aName} ${slot.a}, ${bName} ${slot.b}`}
        >
          <span className="deck-compare-curve-counts" aria-hidden="true">
            <span className="deck-compare-curve-count is-a">{slot.a}</span>
            <span className="deck-compare-curve-count is-b">{slot.b}</span>
          </span>
          <span className="deck-compare-curve-track" aria-hidden="true">
            <span className="deck-compare-curve-bar is-a" style={{ height: height(slot.a) }} />
            <span className="deck-compare-curve-bar is-b" style={{ height: height(slot.b) }} />
          </span>
          <span className="deck-compare-curve-label" aria-hidden="true">
            {slot.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Which bar color is which deck — the chart's legend. */
function DeckKey({ aName, bName }: { aName: string; bName: string }) {
  return (
    <ul className="deck-compare-key" aria-hidden="true">
      <li>
        <span className="deck-compare-key-swatch is-a" /> {aName}
      </li>
      <li>
        <span className="deck-compare-key-swatch is-b" /> {bName}
      </li>
    </ul>
  );
}

const NONE_OPTION: SelectOption<string> = { value: '', label: 'Select a deck' };

/**
 * A picker row carries the deck's size and when it was last edited, not just
 * its name. Generation names a deck after its commander, so building two
 * Krenko decks is the ordinary result of using the feature twice — the dev
 * account's ten decks are 4x "Abigale", 3x "Thassa", 2x "Krenko". By name alone
 * this list is four identical rows: you cannot tell which deck you are picking,
 * and the result header ("Abigale vs Krenko") cannot tell you afterwards either.
 *
 * The commander is deliberately NOT the discriminator — same-named decks all
 * share it, which is the very reason the duplicates exist. Size and edited-time
 * are what actually differ.
 *
 * `label` stays the bare name so the closed trigger reads "Abigale"; the meta
 * line rides on `itemLabel`, which SelectMenu renders only inside the popover.
 */
function deckOption(d: Deck): SelectOption<string> {
  return {
    value: d.id,
    label: d.name,
    itemLabel: (
      <span className="deck-compare-option">
        <span className="deck-compare-option-name">{d.name}</span>
        <span className="deck-compare-option-meta">
          {d.cards.length} cards · Edited {formatRelativeTime(d.updatedAt)}
        </span>
      </span>
    ),
  };
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

const COLOR_NAME: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
};

const ROLE_TIP = (
  <>
    <span className="info-tip-lead">What each role means</span>
    <ul className="info-tip-list">
      <li>
        <strong>Lands</strong>: your mana base.
      </li>
      <li>
        <strong>Ramp</strong>: cards that add extra mana to speed you up.
      </li>
      <li>
        <strong>Card advantage</strong>: cards that draw or make more cards.
      </li>
      <li>
        <strong>Spot removal</strong>: kills or neutralizes a single threat.
      </li>
      <li>
        <strong>Board wipes</strong>: clear many things at once.
      </li>
    </ul>
  </>
);

export function DeckComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const decks = useDecksStore((s) => s.decks);
  const hydrated = useDecksStore((s) => s.hydrated);
  const taggerReady = useTaggerReady();
  const currency = useCurrency();

  const aId = searchParams.get('a') ?? '';
  const bId = searchParams.get('b') ?? '';
  const deckA = decks.find((d) => d.id === aId) ?? null;
  const deckB = decks.find((d) => d.id === bId) ?? null;

  // Each picker excludes the deck already chosen on the other side, so you
  // can't compare a deck against itself. The leading sentinel clears a side.
  // A picker row carries the deck's size and when it was last edited, not just
  // its name. Generation names a deck after its commander, so building two
  // Krenko decks is the ordinary result of using the feature twice — the dev
  // account's ten decks are 4x "Abigale", 3x "Thassa", 2x "Krenko". By name
  // alone this list is four identical rows and you cannot know which deck you
  // are comparing, nor which two the result refers to. The commander is NOT a
  // useful discriminator here for exactly the reason the duplicates exist: the
  // same-named decks all share it.
  //
  // `label` stays the bare name so the closed trigger reads "Abigale"; the
  // meta line rides on `itemLabel`, which SelectMenu renders only inside the
  // popover.
  const optionsA = useMemo(
    () => [NONE_OPTION, ...decks.filter((d) => d.id !== bId).map(deckOption)],
    [decks, bId]
  );
  const optionsB = useMemo(
    () => [NONE_OPTION, ...decks.filter((d) => d.id !== aId).map(deckOption)],
    [decks, aId]
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
    () => (deckA && deckB ? diffDecks(deckA, deckB, taggerReady, currency) : null),
    [deckA, deckB, taggerReady, currency]
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
  const phasesA = useMemo(() => (manaA ? gradeCurve(manaA.manaCurve) : null), [manaA]);
  const phasesB = useMemo(() => (manaB ? gradeCurve(manaB.manaCurve) : null), [manaB]);

  return (
    <div className="deck-compare-page" aria-busy={!hydrated}>
      <BackLink to="/decks" label="All decks" />
      <h1 className="deck-compare-heading">
        {deckA && deckB ? (
          <>
            <Link to={`/decks/${deckA.id}`} className="btn-link">
              {deckA.name}
            </Link>{' '}
            vs{' '}
            <Link to={`/decks/${deckB.id}`} className="btn-link">
              {deckB.name}
            </Link>
          </>
        ) : (
          'Compare decks'
        )}
      </h1>

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
              options={optionsA}
              onChange={setSide('a')}
              ariaLabel="Deck A"
              placeholder="Deck A"
            />
            <span className="deck-compare-vs" aria-hidden="true">
              vs
            </span>
            <SelectMenu
              value={bId}
              options={optionsB}
              onChange={setSide('b')}
              ariaLabel="Deck B"
              placeholder="Deck B"
            />
          </div>

          {!diff || !deckA || !deckB || !manaA || !manaB || !phasesA || !phasesB ? (
            <div className="empty-state">
              <EmptyStateMark />
              <p className="empty-state-tagline">Pick two decks to compare.</p>
              <p className="empty-state-hint">
                Select decks above, or open any deck and tap Compare from its menu.
              </p>
            </div>
          ) : (
            <CompareBody
              deckA={deckA}
              deckB={deckB}
              diff={diff}
              manaA={manaA}
              manaB={manaB}
              phasesA={phasesA}
              phasesB={phasesB}
              pairKey={`${aId}-${bId}`}
            />
          )}
        </>
      )}
    </div>
  );
}

/** The comparison itself — only ever rendered once both decks resolve. */
function CompareBody({
  deckA,
  deckB,
  diff,
  manaA,
  manaB,
  phasesA,
  phasesB,
  pairKey,
}: {
  deckA: Deck;
  deckB: Deck;
  diff: DeckDiff;
  manaA: DeckManaData;
  manaB: DeckManaData;
  phasesA: CurveGrading;
  phasesB: CurveGrading;
  pairKey: string;
}) {
  // Two decks can share a name (a deck and its copy usually do), and this whole
  // page rests on every value naming its side — so disambiguate before the
  // names are used as column headers.
  const [nameA, nameB] =
    deckA.name === deckB.name
      ? [`${deckA.name} (A)`, `${deckB.name} (B)`]
      : [deckA.name, deckB.name];

  const onlyA = diff.cards.removed.length;
  const onlyB = diff.cards.added.length;
  // A card whose copy count changed is still in both lists.
  const inBoth = diff.cards.unchangedCount + diff.cards.changed.length;
  const distinct = inBoth + onlyA + onlyB;
  const identical = onlyA === 0 && onlyB === 0 && diff.cards.changed.length === 0;

  const typeRows = Object.entries(diff.stats.types).filter(([, s]) => s.a > 0 || s.b > 0);
  const roleRows = diff.stats.roles.filter((r) => r.delta.a > 0 || r.delta.b > 0);
  // Only colors the spells actually ask for — a Golgari deck has no business
  // showing a "White: 0 needed, 5 sources" row, which is what the old two-up
  // mana panels did.
  const colorKeys = ['W', 'U', 'B', 'R', 'G'].filter(
    (c) => (manaA.colorDist.counts[c] ?? 0) > 0 || (manaB.colorDist.counts[c] ?? 0) > 0
  );
  const colorlessSources =
    (manaA.manaProduction.counts.C ?? 0) > 0 || (manaB.manaProduction.counts.C ?? 0) > 0;

  return (
    <>
      {/* ── How much the two lists overlap ───────────────────────────── */}
      <section className="deck-compare-overlap" aria-labelledby="dcp-overlap-heading">
        <h2 id="dcp-overlap-heading" className="deck-compare-overlap-headline">
          {identical
            ? 'These two decks run exactly the same cards.'
            : `${inBoth} of ${distinct} cards are in both decks.`}
        </h2>
        <StackedBar
          size="md"
          segments={[
            { key: 'a', value: onlyA, color: 'var(--err-text)' },
            { key: 'both', value: inBoth, color: 'var(--accent)' },
            { key: 'b', value: onlyB, color: 'var(--success)' },
          ]}
        />
        <ul className="deck-compare-overlap-legend">
          <li>
            <span className="deck-compare-overlap-swatch is-only-a" aria-hidden="true" />
            <strong>{onlyA}</strong> only in {nameA}
          </li>
          <li>
            <span className="deck-compare-overlap-swatch is-both" aria-hidden="true" />
            <strong>{inBoth}</strong> in both
          </li>
          <li>
            <span className="deck-compare-overlap-swatch is-only-b" aria-hidden="true" />
            <strong>{onlyB}</strong> only in {nameB}
          </li>
        </ul>
      </section>

      {/* ── 1 — Which cards differ ───────────────────────────────────── */}
      <section className="deck-compare-section" aria-labelledby="dcp-cards-heading">
        <h2 id="dcp-cards-heading" className="deck-compare-section-title">
          Which cards differ
        </h2>
        {identical ? (
          <p className="deck-compare-empty-hint">Every card matches, copy for copy.</p>
        ) : (
          <>
            <DiffGroup
              key={`${pairKey}-added`}
              tone="added"
              title={`Only in ${nameB}`}
              deltas={diff.cards.added}
            />
            <DiffGroup
              key={`${pairKey}-removed`}
              tone="removed"
              title={`Only in ${nameA}`}
              deltas={diff.cards.removed}
            />
            <DiffGroup
              key={`${pairKey}-changed`}
              tone="changed"
              title="Different number of copies"
              caption={`${nameA} → ${nameB}`}
              deltas={diff.cards.changed}
            />
          </>
        )}
      </section>

      {/* ── 2 — The numbers, side by side ────────────────────────────── */}
      <section className="deck-compare-section" aria-labelledby="dcp-stats-heading">
        <h2 id="dcp-stats-heading" className="deck-compare-section-title">
          By the numbers
        </h2>
        <CompareTable rowHeader="Totals" aName={nameA} bName={nameB}>
          <CompareGroup>
            <CompareRow
              label="Cards (not counting commanders)"
              a={diff.stats.size.a}
              b={diff.stats.size.b}
            />
            {/* From buildManaData, not the diff engine, so this agrees with the
                curve chart below. */}
            <CompareRow
              label="Average mana value"
              a={manaA.averageCmc}
              b={manaB.averageCmc}
              decimals={1}
            />
            <CompareRow label="Price" a={diff.price.aTotal} b={diff.price.bTotal} asMoney invert />
          </CompareGroup>

          {typeRows.length > 0 && (
            <CompareGroup title="Card types">
              {typeRows.map(([key, s]) => (
                <CompareRow key={key} label={TYPE_LABEL[key] ?? key} a={s.a} b={s.b} />
              ))}
            </CompareGroup>
          )}

          {diff.stats.taggerReady && roleRows.length > 0 && (
            <CompareGroup
              title={
                <>
                  What the cards do <InfoTip label="card roles" wide text={ROLE_TIP} />
                </>
              }
            >
              {roleRows.map((role) => (
                <CompareRow key={role.key} label={role.label} a={role.delta.a} b={role.delta.b} />
              ))}
            </CompareGroup>
          )}
        </CompareTable>
        {!diff.stats.taggerReady && (
          <p className="deck-compare-tagger-notice" aria-live="polite">
            Working out what each card does…
          </p>
        )}
      </section>

      {/* ── 3 — Mana curve ───────────────────────────────────────────── */}
      <section className="deck-compare-section" aria-labelledby="dcp-curve-heading">
        <h2 id="dcp-curve-heading" className="deck-compare-section-title">
          Mana curve{' '}
          <InfoTip
            label="mana curve"
            wide
            text={
              <>
                <span className="info-tip-lead">How to read this</span>
                <ul className="info-tip-list">
                  <li>
                    Each column is a mana cost; bar height is how many cards cost that much. Lands
                    aren&apos;t counted.
                  </li>
                  <li>
                    Below, those cards roll up into <strong>Early</strong> (0–2),{' '}
                    <strong>Mid</strong> (3–4) and <strong>Late</strong> (5+).
                  </li>
                  <li>
                    The small word is how close that phase sits to a healthy Commander curve. A
                    guideline, not a verdict.
                  </li>
                </ul>
              </>
            }
          />
        </h2>
        <DeckKey aName={nameA} bName={nameB} />
        <CurveCompare
          curveA={manaA.manaCurve}
          curveB={manaB.manaCurve}
          aName={nameA}
          bName={nameB}
        />
        <CompareTable rowHeader="Cards by phase" aName={nameA} bName={nameB}>
          <CompareGroup>
            {phasesA.phases.map((phase, i) => (
              <CompareRow
                key={phase.key}
                label={`${phase.label} (${phase.cmcs[0]}${
                  phase.key === 'late' ? '+' : `–${phase.cmcs[phase.cmcs.length - 1]}`
                } mana)`}
                a={phase.count}
                b={phasesB.phases[i]?.count ?? 0}
                subA={phase.grade}
                subB={phasesB.phases[i]?.grade}
              />
            ))}
          </CompareGroup>
        </CompareTable>
      </section>

      {/* ── 4 — Mana base ────────────────────────────────────────────── */}
      <section className="deck-compare-section" aria-labelledby="dcp-color-heading">
        <h2 id="dcp-color-heading" className="deck-compare-section-title">
          Mana base{' '}
          <InfoTip
            label="mana base"
            wide
            text={
              <>
                <span className="info-tip-lead">Two numbers per color</span>
                <ul className="info-tip-list">
                  <li>
                    <strong>Cards that need it</strong>: how many spells have that color in their
                    cost.
                  </li>
                  <li>
                    <strong>Sources that make it</strong>: lands, rocks and mana creatures that can
                    produce it.
                  </li>
                  <li>
                    Sources well under the cards needing them is the usual sign of shaky mana.
                  </li>
                </ul>
              </>
            }
          />
        </h2>
        {colorKeys.length === 0 ? (
          <p className="deck-compare-empty-hint">Neither deck casts colored spells.</p>
        ) : (
          <CompareTable rowHeader="By color" aName={nameA} bName={nameB}>
            <CompareGroup title="Cards that need it">
              {colorKeys.map((c) => (
                <CompareRow
                  key={c}
                  label={COLOR_NAME[c] ?? c}
                  a={manaA.colorDist.counts[c] ?? 0}
                  b={manaB.colorDist.counts[c] ?? 0}
                />
              ))}
            </CompareGroup>
            <CompareGroup title="Sources that make it">
              {colorKeys.map((c) => (
                <CompareRow
                  key={c}
                  label={COLOR_NAME[c] ?? c}
                  a={manaA.manaProduction.counts[c] ?? 0}
                  b={manaB.manaProduction.counts[c] ?? 0}
                />
              ))}
              {colorlessSources && (
                <CompareRow
                  label="Colorless"
                  a={manaA.manaProduction.counts.C ?? 0}
                  b={manaB.manaProduction.counts.C ?? 0}
                />
              )}
            </CompareGroup>
          </CompareTable>
        )}
      </section>

      {/* ── 5 — Power level & price ──────────────────────────────────── */}
      <section className="deck-compare-section" aria-labelledby="dcp-power-heading">
        <h2 id="dcp-power-heading" className="deck-compare-section-title">
          Power level &amp; price{' '}
          <InfoTip
            label="power bracket"
            wide
            text={
              <>
                <span className="info-tip-lead">Power brackets</span>
                <ul className="info-tip-list">
                  <li>
                    Commander decks rate <strong>1–5</strong> by power. Bracket 1 is casual, Bracket
                    5 is cutthroat (cEDH).
                  </li>
                  <li>
                    <strong>Detected</strong> is the deck&apos;s auto-estimated level.
                  </li>
                  <li>
                    <strong>Target</strong> is the bracket you&apos;re aiming for;{' '}
                    <strong>Auto</strong> means none is set.
                  </li>
                </ul>
              </>
            }
          />
        </h2>
        <div className="deck-compare-2up">
          {[
            { deck: deckA, name: nameA, read: diff.bracket.a },
            { deck: deckB, name: nameB, read: diff.bracket.b },
          ].map(({ deck, name, read }) => (
            <div key={deck.id} className="deck-compare-col">
              <h3 className="deck-compare-deck-label">{name}</h3>
              {read.bracket != null ? (
                <>
                  <p className="deck-compare-bracket-num">Bracket {read.bracket}</p>
                  <BracketVerdictStrip
                    target={deck.bracketOverride ?? undefined}
                    detected={read.bracket}
                  />
                </>
              ) : (
                <p className="deck-compare-empty-hint">
                  Not estimated yet —{' '}
                  <Link to={`/decks/${deck.id}`} className="btn-link">
                    open the deck
                  </Link>{' '}
                  to analyze it.
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="deck-compare-price-panel">
          {[
            { deck: deckA, name: nameA, total: diff.price.aTotal },
            { deck: deckB, name: nameB, total: diff.price.bTotal },
          ].map(({ deck, name, total }) => (
            <div key={deck.id} className="deck-compare-price-col">
              <span className="deck-compare-price-name">{name}</span>
              <span className="deck-compare-price-amount">{money(total)}</span>
              <MeterBar value={total} max={Math.max(diff.price.aTotal, diff.price.bTotal, 1)} />
            </div>
          ))}
        </div>
        <p
          className={`deck-compare-price-delta ${diff.price.delta > 0 ? 'is-removed' : diff.price.delta < 0 ? 'is-added' : ''}`}
        >
          {diff.price.delta === 0
            ? 'Both decks cost the same.'
            : `${nameB} costs ${money(Math.abs(diff.price.delta))} ${diff.price.delta > 0 ? 'more' : 'less'} than ${nameA}.`}
        </p>
      </section>
    </>
  );
}
