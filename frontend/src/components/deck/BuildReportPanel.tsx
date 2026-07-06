import { useMemo, useState, type JSX } from 'react';
import './BuildReportPanel.css';
import { Check, Loader2, Plus } from 'lucide-react';
import type { BuildReport, DeckDataSource, GenerationMode } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import { ROLE_TITLES, type RoleKey } from '@/lib/role-badges';
import { comboPayoffScore } from '@/lib/combo-payoff';
import { VerdictBadge } from './VerdictBadge';
import { OwnershipBadge } from './OwnershipBadge';
import { ColorPip } from '@/components/shared/ManaSymbol';
import { InfoTip } from '../InfoTip';

const COLOR_WORDS: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
};

/** Headline for how an alternative generator built the deck. */
function humanizeGenerationMode(mode: GenerationMode, detail?: string): string {
  switch (mode) {
    case 'oracle-role':
      return detail === 'permanents only'
        ? 'Built by card function — permanents only'
        : 'Built by card function (Scryfall oracle tags)';
    case 'art-theme': {
      const motif = (detail ?? '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return motif ? `Art theme — every card depicts ${motif}` : 'Art theme';
    }
    case 'historical': {
      const year = detail?.match(/\d{4}/)?.[0];
      return year ? `Historical — cards printed through ${year}` : 'Historical';
    }
    default:
      return '';
  }
}

/**
 * Canonical label for a role-gap key. Prefers the shared ROLE_TITLES map
 * (e.g. cardDraw → "Card Advantage"); for any unknown key, humanizes the
 * raw key by splitting camelCase and capitalizing instead of leaking it.
 */
function humanizeRole(role: string): string {
  const known = ROLE_TITLES[role as RoleKey];
  if (known) return known;
  const spaced = role.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "ramp", "mana-rock" → "ramp, mana rock" for the synergy-fill rationale. */
function humanizeTags(tags: string[]): string {
  return tags.map((t) => t.replace(/-/g, ' ')).join(', ');
}

/** Synergy-fill rationale: tag match, lift connectivity, or both combined —
 *  matches the packagePicks "Lifted by X, Y" phrasing for consistency. */
function synergyFillReason(f: { matchedTags: string[]; liftedBy?: string[] }): string {
  const tagsPart =
    f.matchedTags.length > 0 ? `Fits your deck’s ${humanizeTags(f.matchedTags)}` : '';
  const liftPart = f.liftedBy && f.liftedBy.length > 0 ? `Lifted by ${f.liftedBy.join(', ')}` : '';
  return (
    [tagsPart, liftPart].filter(Boolean).join(' · ') ||
    'Slot filler — no shared synergy with the deck'
  );
}

/** Plain-English description of which EDHREC pool the generator ended up using. */
function humanizeDataSource(source: DeckDataSource): string {
  switch (source) {
    case 'theme+bracket':
      return 'used theme-specific EDHREC pool at your bracket';
    case 'theme':
      return 'used theme-specific EDHREC pool (bracket list unavailable)';
    case 'base+bracket':
      return 'used base EDHREC pool at your bracket';
    case 'base':
      return 'used base EDHREC pool (bracket list unavailable)';
    case 'scryfall':
      return 'used Scryfall search (no EDHREC data available)';
    default:
      return source;
  }
}

export function BuildReportPanel({
  report,
  onFixGaps,
  onAddCard,
  deckCardNames,
  addingCardNames,
  oneAwayCombos,
  ownedOracleIds,
}: {
  report: BuildReport;
  /** Jump to the Coach "Fix gaps" lane to add cards for the under-target roles.
   *  Omitted (e.g. in the quick-glance sheet) → the gaps stay informational. */
  onFixGaps?: () => void;
  /** Add a synergyFills/packagePicks card straight from its row. Omitted (e.g.
   *  the quick-glance sheet) → rows stay read-only prose, same as onFixGaps. */
  onAddCard?: (cardName: string) => void;
  /** Lower-cased names currently in the deck — gates "+ Add" vs "In deck" per
   *  row (a synergyFill card may have since been removed by the user; a
   *  packagePick may have since been added by hand). */
  deckCardNames?: ReadonlySet<string>;
  /** Card names with an add in flight (exact case, mirrors the Coach/NBM
   *  `busyNames` convention) — shows the row's spinner state. */
  addingCardNames?: ReadonlySet<string>;
  /** Spellbook combos one card away from the generated deck (E78-P4). Computed
   *  live by the host from the same useDeckCombos result the Coach uses —
   *  never persisted, since it's point-in-time collection data. Omitted /
   *  empty (offline first-run, still loading, no matches) → section absent. */
  oneAwayCombos?: ComboMatch[];
  /** Oracle ids the user owns — flags one-away combos whose missing piece is
   *  already in the collection (those rank first: they're free to finish). */
  ownedOracleIds?: ReadonlySet<string>;
}): JSX.Element {
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());

  const renderAddButton = (name: string) => {
    if (!onAddCard) return null;
    const lower = name.toLowerCase();
    if (addingCardNames?.has(name)) {
      return (
        <button
          type="button"
          className="build-report-add is-adding"
          disabled
          aria-label={`Adding ${name}`}
        >
          <Loader2 className="build-report-add-spinner" aria-hidden="true" />
        </button>
      );
    }
    const added = justAdded.has(lower);
    if (added || deckCardNames?.has(lower)) {
      return (
        <button
          type="button"
          className="build-report-add is-added"
          disabled
          aria-label={added ? `Added ${name}` : `${name} is already in the deck`}
        >
          <Check className="build-report-add-icon" aria-hidden="true" />
          {added ? 'Added' : 'In deck'}
        </button>
      );
    }
    return (
      <button
        type="button"
        className="build-report-add"
        onClick={() => {
          setJustAdded((prev) => new Set(prev).add(lower));
          onAddCard(name);
        }}
        aria-label={`Add ${name}`}
      >
        <Plus className="build-report-add-icon" aria-hidden="true" />
        Add
      </button>
    );
  };

  const {
    targetBracket,
    estimatedBracket,
    dataSource,
    builtFromCollection,
    collectionStrategy,
    ownedPercentActual,
    ownedPercentTarget,
    basicsPadded,
    collectionRelaxed,
    collectionSubstitutions,
    synergyFills,
    roleGaps,
    roleExcesses,
    claimedConflicts,
    generationMode,
    generationModeDetail,
    generationNote,
    landCountNote,
    brewDialNote,
    landSqueezeTrimNote,
    bracketPoolFallbackNote,
    budgetNote,
    roleCapOverflowNote,
    priceSanityNote,
    comboUpsideNotes,
    packagePicks,
    liftPicksNote,
    manabase,
    coherenceFindings,
    coherenceRepairs,
    budgetRepairs,
    surplusConversions,
    protectionCount,
    protectionZeroNote,
  } = report;

  const isPartial = collectionStrategy === 'partial';

  // One-away Spellbook combos, owned-missing-piece first (they're the payoff:
  // "add X — you already own it"), then by payoff quality (E83 — a wincon
  // beats a value combo regardless of raw popularity), then by global
  // popularity as the final tie-break. Rows whose missing card can't be named
  // are dropped rather than rendered blank.
  const oneAwayRows = useMemo(() => {
    const rows = (oneAwayCombos ?? []).flatMap((match) => {
      const missingId = match.missingOracleIds[0];
      const missingName = missingId
        ? match.combo.cards.find((c) => c.oracleId === missingId)?.cardName
        : undefined;
      if (!missingId || !missingName) return [];
      return [{ match, missingName, owned: ownedOracleIds?.has(missingId) ?? false }];
    });
    rows.sort(
      (a, b) =>
        Number(b.owned) - Number(a.owned) ||
        comboPayoffScore(b.match.combo.produces) - comboPayoffScore(a.match.combo.produces) ||
        b.match.combo.popularity - a.match.combo.popularity
    );
    return rows;
  }, [oneAwayCombos, ownedOracleIds]);
  const oneAwayOwnedCount = oneAwayRows.filter((r) => r.owned).length;

  return (
    <div className="build-report">
      {generationMode && generationMode !== 'edhrec' && (
        <p className="build-report-line build-report-method">
          <strong>{humanizeGenerationMode(generationMode, generationModeDetail)}</strong>
          {generationNote && <span className="build-report-method-note">{generationNote}</span>}
        </p>
      )}

      <p className="build-report-line build-report-bracket">
        Aimed Bracket <strong>{targetBracket}</strong> &rarr; estimated{' '}
        <strong>{estimatedBracket}</strong>
      </p>

      {(!generationMode || generationMode === 'edhrec') && (
        <p className="build-report-line build-report-source">{humanizeDataSource(dataSource)}</p>
      )}

      {bracketPoolFallbackNote && (
        <p className="build-report-line build-report-source">{bracketPoolFallbackNote}</p>
      )}

      {landCountNote && <p className="build-report-line build-report-source">{landCountNote}</p>}

      {brewDialNote && <p className="build-report-line build-report-source">{brewDialNote}</p>}

      {landSqueezeTrimNote && (
        <p className="build-report-line build-report-source">{landSqueezeTrimNote}</p>
      )}

      {budgetNote && <p className="build-report-line build-report-source">{budgetNote}</p>}

      {roleCapOverflowNote && (
        <p className="build-report-line build-report-source">{roleCapOverflowNote}</p>
      )}

      <p className="build-report-line build-report-source">
        Protection/interaction: <strong>{protectionCount ?? 0}</strong>{' '}
        {(protectionCount ?? 0) === 1 ? 'piece' : 'pieces'}
      </p>

      {protectionZeroNote && (
        <p className="build-report-line build-report-source">{protectionZeroNote}</p>
      )}

      {surplusConversions && surplusConversions.length > 0 && (
        <details className="build-report-subs">
          <summary>
            <strong>{surplusConversions.length}</strong> role-surplus card
            {surplusConversions.length === 1 ? '' : 's'} converted into a stronger payoff
          </summary>
          <ul className="build-report-subs-list">
            {surplusConversions.map((r) => (
              <li key={`${r.cut}-${r.added}`} className="build-report-sub">
                <div className="build-report-sub-head">
                  <span className="build-report-sub-map">
                    <strong>{r.cut}</strong> &rarr; <strong>{r.added}</strong>
                  </span>
                </div>
                <span className="build-report-sub-reason">{r.reason}</span>
                <span className="build-report-lift-chips">
                  <VerdictBadge tone="success" label="Auto-fixed" />
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {priceSanityNote && (
        <p className="build-report-line build-report-source">{priceSanityNote}</p>
      )}

      {comboUpsideNotes && comboUpsideNotes.length > 0 && (
        <details className="build-report-subs">
          <summary>
            <strong>{comboUpsideNotes.length}</strong> expensive combo piece
            {comboUpsideNotes.length === 1 ? '' : 's'} kept for upside — why
          </summary>
          <ul className="build-report-subs-list">
            {comboUpsideNotes.map((n) => (
              <li key={n.name} className="build-report-sub">
                <span className="build-report-sub-map">
                  <strong>{n.name}</strong> ({n.price})
                </span>
                <span className="build-report-sub-reason">
                  Kept for combo upside over {n.comparedName} ({n.comparedPrice}) — {n.ownedPieces}
                  -of-{n.totalPieces} toward {n.produces} (needs {n.missingCards.join(', ')})
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {builtFromCollection && typeof ownedPercentActual === 'number' && (
        <p className="build-report-line">
          <strong>{ownedPercentActual}%</strong> from your collection
          {isPartial && typeof ownedPercentTarget === 'number' && (
            <span className="build-report-muted"> (target {ownedPercentTarget}%)</span>
          )}
        </p>
      )}

      {typeof collectionRelaxed === 'number' && collectionRelaxed > 0 && (
        <p className="build-report-flag">
          Your collection ran short — added <strong>{collectionRelaxed}</strong> card
          {collectionRelaxed === 1 ? '' : 's'} from outside it to complete the deck.
        </p>
      )}

      {collectionSubstitutions && collectionSubstitutions.length > 0 && (
        <details className="build-report-subs">
          <summary>
            Used <strong>{collectionSubstitutions.length}</strong> owned card
            {collectionSubstitutions.length === 1 ? '' : 's'} in place of staples you don’t own —
            why these cards?
          </summary>
          <ul className="build-report-subs-list">
            {collectionSubstitutions.map((s) => (
              <li key={s.usedName} className="build-report-sub">
                <span className="build-report-sub-map">
                  Wanted <strong>{s.wantedName}</strong>
                </span>
                <span className="build-report-sub-reason">{s.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {synergyFills && synergyFills.length > 0 && (
        <details className="build-report-subs">
          <summary>
            <strong>{synergyFills.length}</strong> card
            {synergyFills.length === 1 ? '' : 's'} had no EDHREC data for this commander — why
            they’re here
          </summary>
          <ul className="build-report-subs-list">
            {synergyFills.map((f) => (
              <li key={f.name} className="build-report-sub">
                <div className="build-report-sub-head">
                  <span className="build-report-sub-map">
                    <strong>{f.name}</strong>
                  </span>
                  {renderAddButton(f.name)}
                </div>
                <span className="build-report-sub-reason">{synergyFillReason(f)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {packagePicks && packagePicks.length > 0 && (
        <details className="build-report-subs">
          <summary>
            <strong>{packagePicks.length}</strong> hidden-synergy pick
            {packagePicks.length === 1 ? '' : 's'} — not in your EDHREC pool, but strongly paired
            with cards already in the deck
          </summary>
          <ul className="build-report-subs-list">
            {packagePicks.map((p) => (
              <li key={p.name} className="build-report-sub">
                <div className="build-report-sub-head">
                  <span className="build-report-sub-map">
                    <strong>{p.name}</strong>
                  </span>
                  {renderAddButton(p.name)}
                </div>
                <span className="build-report-sub-reason">
                  {p.kind === 'bomb'
                    ? `Pairs hard with ${p.liftedBy[0]}`
                    : `Lifted by ${p.liftedBy.join(', ')}`}
                </span>
                <span className="build-report-lift-chips">
                  <VerdictBadge
                    tone={p.kind === 'bomb' ? 'info' : 'neutral'}
                    label={p.kind === 'bomb' ? 'Combo-style pairing' : 'Cluster pick'}
                  />
                  {p.lowSample && <VerdictBadge tone="warn" label="Low sample" />}
                  <OwnershipBadge owned={p.owned} showUnowned />
                </span>
              </li>
            ))}
          </ul>
          {liftPicksNote && <p className="build-report-lift-note">{liftPicksNote}</p>}
        </details>
      )}

      {oneAwayRows.length > 0 && (
        <details className="build-report-subs">
          <summary>
            <strong>{oneAwayRows.length}</strong> combo{oneAwayRows.length === 1 ? ' is' : 's are'}{' '}
            one card away
            {oneAwayOwnedCount > 0 && (
              <>
                {' '}
                — you own <strong>{oneAwayOwnedCount}</strong> missing piece
                {oneAwayOwnedCount === 1 ? '' : 's'}
              </>
            )}
          </summary>
          <ul className="build-report-subs-list">
            {oneAwayRows.map(({ match, missingName, owned }) => (
              <li key={match.combo.id} className="build-report-sub">
                <div className="build-report-sub-head">
                  <span className="build-report-sub-map">
                    <strong>{match.combo.cards.map((c) => c.cardName).join(' + ')}</strong>
                  </span>
                  {renderAddButton(missingName)}
                </div>
                <span className="build-report-sub-reason">
                  Missing: <strong>{missingName}</strong>
                  {match.combo.produces.length > 0 &&
                    ` · ${match.combo.produces.slice(0, 3).join(', ')}`}
                </span>
                <span className="build-report-lift-chips">
                  <OwnershipBadge owned={owned} showUnowned />
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {((coherenceFindings && coherenceFindings.length > 0) ||
        (coherenceRepairs && coherenceRepairs.length > 0)) && (
        <details className="build-report-subs">
          <summary>
            {coherenceFindings && coherenceFindings.length > 0 && (
              <>
                <strong>{coherenceFindings.length}</strong> coherence flag
                {coherenceFindings.length === 1 ? '' : 's'} — cards this exact build may not support
              </>
            )}
            {coherenceFindings &&
              coherenceFindings.length > 0 &&
              coherenceRepairs &&
              coherenceRepairs.length > 0 &&
              ' · '}
            {coherenceRepairs && coherenceRepairs.length > 0 && (
              <>
                <strong>{coherenceRepairs.length}</strong> coherence swap
                {coherenceRepairs.length === 1 ? '' : 's'} auto-applied during generation
              </>
            )}
          </summary>
          <ul className="build-report-subs-list">
            {(coherenceRepairs ?? []).map((r) => (
              <li key={`${r.cut}-${r.added}`} className="build-report-sub">
                <div className="build-report-sub-head">
                  <span className="build-report-sub-map">
                    <strong>{r.cut}</strong> &rarr; <strong>{r.added}</strong>
                  </span>
                </div>
                <span className="build-report-sub-reason">{r.reason}</span>
                <span className="build-report-lift-chips">
                  <VerdictBadge tone="success" label="Auto-fixed" />
                </span>
              </li>
            ))}
            {(coherenceFindings ?? []).map((f, i) => (
              <li key={f.card ?? `deck-note-${i}`} className="build-report-sub">
                {f.card && (
                  <div className="build-report-sub-head">
                    <span className="build-report-sub-map">
                      <strong>{f.card}</strong>
                    </span>
                  </div>
                )}
                <span className="build-report-sub-reason">{f.message}</span>
                <span className="build-report-lift-chips">
                  <VerdictBadge
                    tone={f.severity === 'warn' ? 'warn' : 'info'}
                    label={
                      f.kind === 'dead-payoff'
                        ? 'Dead payoff'
                        : f.kind === 'unjustified-slot'
                          ? 'No deck link'
                          : f.kind === 'land-sanity'
                            ? 'Land sanity'
                            : f.kind === 'win-condition'
                              ? 'Win path'
                              : f.kind === 'answer-coverage'
                                ? 'Answer gap'
                                : f.kind === 'nonbo'
                                  ? 'Nonbo'
                                  : 'Engine note'
                    }
                  />
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {budgetRepairs && budgetRepairs.length > 0 && (
        <details className="build-report-subs">
          <summary>
            <strong>{budgetRepairs.length}</strong> budget swap
            {budgetRepairs.length === 1 ? '' : 's'} auto-applied to fit your budget
          </summary>
          <ul className="build-report-subs-list">
            {budgetRepairs.map((r) => (
              <li key={`${r.cut}-${r.added}`} className="build-report-sub">
                <div className="build-report-sub-head">
                  <span className="build-report-sub-map">
                    <strong>{r.cut}</strong> &rarr; <strong>{r.added}</strong>
                  </span>
                </div>
                <span className="build-report-sub-reason">{r.reason}</span>
                <span className="build-report-lift-chips">
                  <VerdictBadge tone="success" label="Auto-fixed" />
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {typeof basicsPadded === 'number' && basicsPadded > 0 && (
        <p className="build-report-line">
          padded <strong>{basicsPadded}</strong> basic
          {basicsPadded === 1 ? '' : 's'}
        </p>
      )}

      {claimedConflicts != null && claimedConflicts > 0 && (
        <p className="build-report-conflict-note">
          {claimedConflicts} card{claimedConflicts === 1 ? ' you own is' : 's you own are'}{' '}
          committed to other decks — open “Review shared cards” to pull a copy in (you choose what
          the other deck does), or swap in free alternatives.
        </p>
      )}

      {manabase && manabase.lines.length > 0 && (
        <div className="build-report-mana">
          <span className="build-report-gaps-label">
            Mana sources vs target
            <InfoTip
              label="mana sources"
              text="Each count is every source of that color in the final deck — lands plus mana rocks and dorks — not lands alone."
            />
          </span>
          <ul className="build-report-gaps-list">
            {manabase.lines.map((l) => (
              <li
                key={l.color}
                className={`build-report-gap build-report-mana-line${l.short ? ' is-short' : ''}`}
                aria-label={`${COLOR_WORDS[l.color] ?? l.color}: ${l.sources} sources, target ${l.target}${l.short ? ', short' : ''}`}
              >
                <ColorPip color={l.color} />
                <span className="build-report-gap-count">
                  {l.sources}
                  <span className="build-report-gap-target"> / {l.target}</span>
                </span>
              </li>
            ))}
          </ul>
          {manabase.note && <p className="build-report-mana-note">{manabase.note}</p>}
        </div>
      )}

      {roleGaps && roleGaps.length > 0 && (
        <div className="build-report-gaps">
          <span className="build-report-gaps-label">Role gaps</span>
          <ul className="build-report-gaps-list">
            {roleGaps.map((g) => (
              <li key={g.role} className="build-report-gap">
                <span className="build-report-gap-label">{humanizeRole(g.role)}</span>
                <span className="build-report-gap-count" aria-label={`${g.have} of ${g.want}`}>
                  {g.have}
                  <span className="build-report-gap-target">
                    {' / '}
                    {g.want}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {onFixGaps && (
            <button type="button" className="btn-link build-report-gaps-cta" onClick={onFixGaps}>
              See cards to add &rarr;
            </button>
          )}
        </div>
      )}

      {roleExcesses && roleExcesses.length > 0 && (
        <div className="build-report-gaps">
          <span className="build-report-gaps-label">Overbuilt roles</span>
          <ul className="build-report-gaps-list">
            {roleExcesses.map((g) => (
              <li key={g.role} className="build-report-gap">
                <span className="build-report-gap-label">{humanizeRole(g.role)}</span>
                <span className="build-report-gap-count" aria-label={`${g.have} of ${g.want}`}>
                  {g.have}
                  <span className="build-report-gap-target">
                    {' / '}
                    {g.want}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
