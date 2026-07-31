import { type JSX, type ReactNode, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Footprints,
  Infinity as InfinityIcon,
  ListChecks,
  Plus,
  Zap,
} from 'lucide-react';
import { isNativePlatform, openExternal } from '../../lib/platform';
import { useCardThumb } from '../../lib/card-thumbs';
import { ColorPip } from '../shared/ManaSymbol';
import type { EdhrecComboStat } from '../../lib/edhrec-combo-overlay';
import type { ComboMatch } from '../../types/combos';
import { MagicText } from './MagicText';
import { OwnershipBadge } from './OwnershipBadge';

export interface CardImageIndex {
  byOracle: Map<string, string>;
  byName: Map<string, string>;
}

/** A locally-cached combo-card image (collection/deck), if we already have one.
 *  Anything not cached resolves its CDN art by name in {@link ComboCardArt} —
 *  never a bare img against the rate-limited API host. */
function resolveComboCardImage(
  oracleId: string,
  cardName: string,
  index: CardImageIndex
): string | undefined {
  return index.byOracle.get(oracleId) ?? index.byName.get(cardName.toLowerCase());
}

/** Combo-card art: a local cache hit, else the CDN image resolved by name
 *  (cached + batched), else a placeholder while it loads / on a miss. */
function ComboCardArt({
  localUrl,
  cardName,
}: {
  localUrl: string | undefined;
  cardName: string;
}): JSX.Element {
  const resolved = useCardThumb(localUrl ? undefined : cardName);
  const url = localUrl ?? resolved;
  return url ? (
    <img src={url} alt={cardName} loading="lazy" decoding="async" />
  ) : (
    <span className="deck-combos-card-art-fallback" aria-hidden />
  );
}

export interface ComboRowProps {
  match: ComboMatch;
  /** True when this row is a near-miss (one piece short) rather than complete.
   *  Drives the status icon, the missing-piece footer and the add CTA. */
  isOneAway: boolean;
  /** EDHREC per-commander stats for this combo, or null when EDHREC has no
   *  entry / the deck has no commander (E63). */
  edhrec: EdhrecComboStat | null;
  cardImageIndex: CardImageIndex;
  /** Oracle IDs of cards the user owns in their collection. */
  ownedOracleIds: Set<string>;
  onAddMissing: () => void;
  /** Called when a card thumbnail is tapped. Index is position within the combo's cards array. */
  onCardTap: (cardIndex: number) => void;
}

export function ComboRow({
  match,
  isOneAway,
  edhrec,
  cardImageIndex,
  ownedOracleIds,
  onAddMissing,
  onCardTap,
}: ComboRowProps) {
  const { combo } = match;
  const missingOracleId = match.missingOracleIds[0] ?? null;
  const missingCardName = missingOracleId
    ? combo.cards.find((c) => c.oracleId === missingOracleId)?.cardName
    : null;
  const missingIsOwned = missingOracleId ? ownedOracleIds.has(missingOracleId) : false;

  const steps = useMemo(() => splitSteps(combo.description), [combo.description]);
  // One unified collapsible covering Prerequisites + Steps so the user toggles
  // them together. Results (produces) are always visible above the card grid.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasDetails =
    !!combo.prerequisites?.easy ||
    !!combo.prerequisites?.notable ||
    !!combo.manaNeeded ||
    steps.length > 0 ||
    combo.popularity > 0 ||
    !!edhrec;

  // Combo title — full card names joined. Truncated via CSS so long combos
  // don't overflow the card; the full string is exposed via title for hover.
  const comboTitle = combo.cards.map((c) => c.cardName).join(' + ');

  const presentCount = match.presentOracleIds.length;
  const totalCount = combo.cards.length;

  return (
    <li className="deck-combos-row expanded">
      {/* ── Result headline — the "what does this do?" answer, always visible ── */}
      {combo.produces.length > 0 && (
        <div className="deck-combos-produces" aria-label="Result">
          <Zap className="deck-combos-produces-icon" width={11} height={11} aria-hidden />
          {combo.produces.slice(0, 3).map((p, i) => {
            const isInfinite = p.toLowerCase().startsWith('infinite ');
            const label = isInfinite ? p.slice(9) : p;
            return (
              <span key={i} className="deck-combos-produce-chip" title={p}>
                {isInfinite && <span aria-hidden>∞ </span>}
                {label}
              </span>
            );
          })}
          {combo.produces.length > 3 && (
            <span className="deck-combos-produce-chip deck-combos-produce-chip--more">
              +{combo.produces.length - 3}
            </span>
          )}
        </div>
      )}

      {/* ── EDHREC prevalence chip — how common this combo is for THIS
            commander (E63). Only on commander decks where EDHREC lists it. ── */}
      {edhrec && (edhrec.percent != null || edhrec.deckCount > 0) && (
        <p
          className="deck-combos-edhrec"
          title="How often this commander's decks run this combo, per EDHREC"
        >
          <span className="deck-combos-edhrec-tag">EDHREC</span>
          <span>
            {edhrec.percent != null
              ? `${formatPercent(edhrec.percent)} of decks`
              : `${edhrec.deckCount.toLocaleString()} decks`}
          </span>
        </p>
      )}

      {/* ── Row header — status icon + color identity + combo name ── */}
      <header className="deck-combos-row-header">
        <span
          className={`deck-combos-row-status ${isOneAway ? 'is-near-miss' : 'is-complete'}`}
          aria-label={isOneAway ? 'One card away' : 'Complete'}
        >
          {isOneAway ? (
            <AlertTriangle width={14} height={14} aria-hidden />
          ) : (
            <CheckCircle2 width={14} height={14} aria-hidden />
          )}
        </span>
        <ColorIdentityPips identity={combo.identity} />
        <span className="deck-combos-row-title card-name-chip-text" title={comboTitle}>
          {comboTitle}
        </span>
      </header>

      {/* ── Piece count — scans at a glance ("3 of 4 in deck · {mana}") ── */}
      <p
        className="deck-combos-piece-count"
        aria-label={`${presentCount} of ${totalCount} pieces in deck${isOneAway && missingIsOwned ? ' · own the missing piece' : ''}`}
      >
        <span className="deck-combos-piece-count-have">{presentCount}</span>
        <span className="deck-combos-piece-count-sep"> of {totalCount} pieces in deck</span>
        {isOneAway && missingIsOwned && (
          <span className="deck-combos-piece-count-sep">
            {' · '}
            <span className="deck-combos-piece-count-owned">own the missing piece</span>
          </span>
        )}
        {combo.manaNeeded && (
          <>
            <span className="deck-combos-piece-count-sep"> · </span>
            <MagicText text={combo.manaNeeded} />
          </>
        )}
      </p>

      {/* ── Card art grid — present cards full colour; missing dimmed ── */}
      <ul className="deck-combos-card-grid" role="list">
        {combo.cards.map((c, i) => {
          const isMissing = c.oracleId === missingOracleId;
          // On the "one-away" tab: owned = in collection but not in deck.
          // On the "in-deck" tab: check if the piece is actually owned in
          // the collection — D2: show not-owned icon for unowned pieces.
          const isOwned = isMissing
            ? ownedOracleIds.has(c.oracleId)
            : !isOneAway && ownedOracleIds.has(c.oracleId);
          const isNotOwnedInDeck = !isOneAway && !isMissing && !ownedOracleIds.has(c.oracleId);
          const tileClass = isMissing ? (isOwned ? ' missing owned' : ' missing') : '';
          const localUrl = resolveComboCardImage(c.oracleId, c.cardName, cardImageIndex);
          // Determine aria label based on context
          const ariaContext = isMissing
            ? isOwned
              ? ' (owned, not in deck)'
              : ' (not owned)'
            : isNotOwnedInDeck
              ? ' (not owned — need to acquire)'
              : ' (in deck)';
          return (
            <li key={c.oracleId} className={`deck-combos-card-tile${tileClass}`}>
              {/* Plus separator between cards. Visual rather than semantic
                  (the list itself communicates the "and" to assistive tech). */}
              {i > 0 && (
                <span className="deck-combos-plus" aria-hidden>
                  +
                </span>
              )}
              <button
                type="button"
                className="deck-combos-card-art"
                onClick={() => onCardTap(i)}
                aria-label={`Preview ${c.cardName}${ariaContext}`}
              >
                <ComboCardArt localUrl={localUrl} cardName={c.cardName} />
                {/* One-away: show owned/not-owned status on the missing piece. */}
                {isMissing && (
                  <span className={`deck-combos-card-status${isOwned ? ' is-owned' : ''}`}>
                    {isOwned ? (
                      <CheckCircle2 width={18} height={18} strokeWidth={2.5} aria-hidden />
                    ) : (
                      <Circle width={18} height={18} strokeWidth={2.5} aria-hidden />
                    )}
                    <span className="sr-only">
                      {isOwned ? 'In collection' : 'Not in collection'}
                    </span>
                  </span>
                )}
                {/* In-deck: D2 — show not-owned icon on pieces not in collection. */}
                {isNotOwnedInDeck && (
                  <span className="deck-combos-card-status">
                    <Circle width={18} height={18} strokeWidth={2.5} aria-hidden />
                    <span className="sr-only">Not in collection</span>
                  </span>
                )}
                {c.quantity > 1 && (
                  <span className="deck-combos-card-qty-badge" aria-label={`${c.quantity} copies`}>
                    ×{c.quantity}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* ── Missing piece footer (one-away only) — name + ownership in text ── */}
      {isOneAway && missingCardName && (
        <div className="deck-combos-missing-footer">
          <span className="deck-combos-missing-label">Missing:</span>
          <span className="deck-combos-missing-name card-name-chip-text" title={missingCardName}>
            {missingCardName}
          </span>
          <OwnershipBadge
            owned={missingIsOwned}
            showUnowned
            title={
              missingIsOwned ? 'Owned — add it to complete this combo' : 'Not in your collection'
            }
          />
        </div>
      )}

      {/* Bracket meta is now inside the detail section (see below). */}

      {/* ── Details toggle — prerequisites + steps (results are already visible) ── */}
      {hasDetails && (
        <>
          <button
            type="button"
            className="deck-combos-details-toggle"
            aria-expanded={detailsOpen}
            aria-controls={`combo-details-${combo.id}`}
            onClick={() => setDetailsOpen((v) => !v)}
          >
            {detailsOpen ? (
              <ChevronDown width={13} height={13} aria-hidden />
            ) : (
              <ChevronRight width={13} height={13} aria-hidden />
            )}
            {detailsOpen ? 'Hide steps' : 'Show steps'}
          </button>
          {detailsOpen && (
            <div id={`combo-details-${combo.id}`} className="deck-combos-detail">
              {(combo.prerequisites?.easy || combo.prerequisites?.notable || combo.manaNeeded) && (
                <DetailSection
                  icon={<ListChecks width={13} height={13} aria-hidden />}
                  title="Prerequisites"
                >
                  {combo.manaNeeded && (
                    <p className="deck-combos-mana-needed">
                      <span className="deck-combos-detail-label">Mana needed</span>
                      <MagicText text={combo.manaNeeded} />
                    </p>
                  )}
                  {combo.prerequisites?.easy && <BulletList text={combo.prerequisites.easy} />}
                  {combo.prerequisites?.notable && (
                    <BulletList text={combo.prerequisites.notable} muted />
                  )}
                </DetailSection>
              )}

              {steps.length > 0 && (
                <DetailSection
                  icon={<Footprints width={13} height={13} aria-hidden />}
                  title="Steps"
                >
                  <ol className="deck-combos-steps">
                    {steps.map((step, i) => (
                      <li key={i}>
                        <MagicText text={step} />
                      </li>
                    ))}
                  </ol>
                </DetailSection>
              )}

              {combo.produces.length > 0 && (
                <DetailSection
                  icon={<InfinityIcon width={13} height={13} aria-hidden />}
                  title="Full results"
                >
                  <ul className="deck-combos-results">
                    {combo.produces.map((p, i) => (
                      <li key={i}>
                        <span className="deck-combos-infinity" aria-hidden>
                          ∞
                        </span>
                        <MagicText text={p} />
                      </li>
                    ))}
                  </ul>
                </DetailSection>
              )}

              {combo.popularity > 0 && (
                <p className="deck-combos-row-meta">{formatDeckCount(combo.popularity)}</p>
              )}
              {edhrec && (
                <p className="deck-combos-row-meta">
                  EDHREC rank #{edhrec.rank}
                  {edhrec.href && (
                    <>
                      {' · '}
                      <a
                        className="deck-combos-edhrec-link"
                        href={`https://edhrec.com${edhrec.href}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => {
                          if (!isNativePlatform()) return;
                          e.preventDefault();
                          openExternal(`https://edhrec.com${edhrec.href}`);
                        }}
                      >
                        View on EDHREC
                      </a>
                    </>
                  )}
                </p>
              )}
              {combo.bracket != null && (
                <p
                  className="deck-combos-row-meta"
                  title="The bracket this combo is associated with in Commander Spellbook"
                >
                  Bracket {combo.bracket}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Add button — primary CTA for one-away combos ── */}
      {isOneAway && missingCardName && (
        <button
          type="button"
          className="deck-combos-add"
          onClick={onAddMissing}
          aria-label={`Add ${missingCardName} to complete this combo`}
        >
          <Plus width={11} height={11} aria-hidden />
          <span className="card-name-chip-text" title={missingCardName}>
            Add {missingCardName}
          </span>
        </button>
      )}
    </li>
  );
}

function DetailSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  // The collapse lives one level up — the whole detail panel (Prereqs +
  // Steps + Results) toggles together via a single "Show details" button.
  // Each individual section is just a heading + body.
  return (
    <section className="deck-combos-detail-section">
      <h4 className="deck-combos-detail-title">
        {icon} {title}
      </h4>
      {children}
    </section>
  );
}

function BulletList({ text, muted }: { text: string; muted?: boolean }) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[•\-*]\s*/, '').trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  return (
    <ul className={`deck-combos-bullets${muted ? ' muted' : ''}`}>
      {lines.map((line, i) => (
        <li key={i}>
          <MagicText text={line} />
        </li>
      ))}
    </ul>
  );
}

const COLOR_ORDER = ['w', 'u', 'b', 'r', 'g'] as const;

function ColorIdentityPips({ identity }: { identity: string }) {
  const colors = identity ? COLOR_ORDER.filter((c) => identity.includes(c)) : [];
  if (colors.length === 0) {
    return <ColorPip color="C" pip={false} className="deck-combos-pip" label="Colorless" />;
  }
  return (
    <span
      className="deck-combos-pips"
      aria-label={`Color identity: ${colors.join('').toUpperCase()}`}
    >
      {colors.map((c) => (
        <ColorPip key={c} color={c} pip={false} className="deck-combos-pip" />
      ))}
    </span>
  );
}

function splitSteps(description: string | null): string[] {
  if (!description) return [];
  return description
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter((line) => line.length > 0);
}

function formatDeckCount(n: number): string {
  if (n <= 0) return 'Popularity unknown';
  return `${n.toLocaleString()} ${n === 1 ? 'deck' : 'decks'}`;
}

function formatPercent(pct: number): string {
  if (pct >= 1) return `${Math.round(pct)}%`;
  if (pct > 0) return '<1%';
  return '0%';
}
