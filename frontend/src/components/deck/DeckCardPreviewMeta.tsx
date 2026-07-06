import { Fragment, type ReactNode } from 'react';
import { Crown, Handshake } from 'lucide-react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { LegalityIssue } from '../../lib/deck-validation';
import type { AllocationStatus } from '../../lib/allocations';
import { getRoleBadge, rolesForCard, multiRoleTitle } from '../../lib/role-badges';
import { classifyInclusion, OFFMETA_TOOLTIP } from '@/lib/inclusion-label';
import './DeckCardPreviewMeta.css';

interface Props {
  /** The card whose deck-context this block describes. Role decoding reads
   *  the card's role fields (falling back to the bundled tagger by name). */
  card: ScryfallCard;
  /** This card is the deck's partner commander. */
  isPartner?: boolean;
  /** This card is the deck's primary commander. */
  isCommander?: boolean;
  /** "Why this card fits your commander" reason strings (from the synergy
   *  engine). Usually ≤ 3. */
  synergies?: string[];
  /** EDHREC inclusion rate for this commander (0–100). `undefined` means the
   *  deck has no EDHREC data at all (or this is a basic land) — see
   *  `resolveInclusionPct` in DeckDisplay, the sole caller. A present number
   *  (including 0) renders via `classifyInclusion` — never a bare "0%". */
  inclusionPct?: number;
  /** Legality issue for this card's slot (color identity / not legal / copies). */
  legality?: LegalityIssue;
  /** Ownership status of the allocated copy. */
  status?: AllocationStatus;
}

/** Short, human-readable note for a non-ideal ownership status. `allocated`
 *  (the happy path) yields nothing — no need to tell the user it's fine. */
function ownershipNote(status: AllocationStatus | undefined): string | null {
  switch (status) {
    case 'unowned':
      return 'Not in your collection';
    case 'orphan':
      return 'Owned copy no longer in your collection';
    case 'claimed-elsewhere':
      return 'Every copy you own is allocated to another deck';
    default:
      return null;
  }
}

/**
 * Deck-context block for the card preview panel — injected via CardPreview's
 * `renderPanelMeta` slot only when the carousel is opened from the deck view.
 *
 * The at-a-glance bits (commander/partner, role, inclusion) collapse onto a
 * single wrapping summary line; ownership/legality and the synergy reasons
 * follow. The panel itself owns the expand/collapse affordance (CardPreview's
 * chevron grows the panel and shrinks the card), so this block just renders
 * its content and lets the panel provide the room.
 *
 * Styled light-on-dark to match the panel (a fixed dark surface, not
 * theme-driven — see the CSS). Fluid by construction so it reflows down to a
 * ~320px phone with no horizontal overflow, web and native WebView alike.
 */
export function DeckCardPreviewMeta({
  card,
  isPartner,
  isCommander,
  synergies,
  inclusionPct,
  legality,
  status,
}: Props) {
  const roleBadge = getRoleBadge(card);
  const roleText =
    roleBadge && rolesForCard(card).length > 1 ? multiRoleTitle(card) : roleBadge?.title;
  const ownership = ownershipNote(status);
  const reasons = synergies?.filter(Boolean) ?? [];

  // At-a-glance segments, joined by separators on one wrapping line.
  const segments: ReactNode[] = [];
  if (isPartner || isCommander) {
    segments.push(
      <span key="cmd" className="deck-card-preview-meta-commander">
        {isPartner ? (
          <Handshake width={13} height={13} strokeWidth={2.2} aria-hidden />
        ) : (
          <Crown width={13} height={13} strokeWidth={2.2} aria-hidden />
        )}
        {isPartner ? 'Partner' : 'Commander'}
      </span>
    );
  }
  if (roleText) {
    segments.push(<span key="role">{roleText}</span>);
  }
  if (typeof inclusionPct === 'number') {
    const info = classifyInclusion(inclusionPct);
    segments.push(
      info.kind === 'pct' ? (
        <span key="inc" title={`In ${info.pct}% of EDHREC decks with this commander`}>
          {info.pct}% of decks
        </span>
      ) : (
        <span key="inc" className="deck-card-preview-meta-offmeta" title={OFFMETA_TOOLTIP}>
          Off-meta
        </span>
      )
    );
  }

  if (segments.length === 0 && !ownership && !legality && reasons.length === 0) {
    return null;
  }

  return (
    <div className="deck-card-preview-meta">
      {segments.length > 0 && (
        <div className="deck-card-preview-meta-summary">
          {segments.map((seg, i) => (
            <Fragment key={i}>
              {i > 0 && (
                <span className="deck-card-preview-meta-sep" aria-hidden>
                  ·
                </span>
              )}
              {seg}
            </Fragment>
          ))}
        </div>
      )}

      {(ownership || legality) && (
        <div className="deck-card-preview-meta-warn">{legality?.detail ?? ownership}</div>
      )}

      {reasons.length > 0 && (
        <div className="deck-card-preview-meta-synergy">
          <span className="deck-card-preview-meta-label">Why it fits your commander</span>
          <ul>
            {reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
