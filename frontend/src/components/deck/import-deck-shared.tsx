import { useEffect, useState } from 'react';
import { getCardImageUrl } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { areValidPartners, canHavePartner } from '@/deck-builder/lib/partnerUtils';
import { isValidCommander, isPdhCommanderEligible } from '../../lib/commanders';
import type { DeckImportResponse } from '../../types';

/**
 * Parse/review pieces shared by `ImportDeckDialog` (creates a new deck from a
 * paste/upload) and `AppendDeckDialog` (pastes into a deck that already
 * exists) — both resolve the same backend `DeckImportResponse` shape and need
 * identical commander-candidate detection and unresolved/fetch-error
 * reporting. Keeping this in one file means the parser-facing UI never forks.
 */

const FORMATS = Object.keys(DECK_FORMAT_CONFIGS) as DeckFormat[];

/**
 * Live online/offline flag. `importDeckText`/`importDeckFile` are a hard
 * network round-trip to the backend's Scryfall-backed resolver — unlike
 * every other manual-add path (which works off the local collection cache),
 * paste import has no offline story, so callers gate on this rather than
 * letting a paste attempt fail into the generic fetch-error banner.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function normalizeFormat(detected: string | undefined | null): DeckFormat | null {
  if (!detected) return null;
  const slug = detected.toLowerCase();
  return FORMATS.find((f) => f === slug) ?? null;
}

function dedupeByName(cards: ScryfallCard[]): ScryfallCard[] {
  const seen = new Set<string>();
  return cards.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}

/** Format-aware commander eligibility: PDH derives it (uncommon creature —
 *  see lib/commanders.ts), every other commander format uses the legendary rule. */
export function commanderEligibleFor(format: DeckFormat): (card: ScryfallCard) => boolean {
  return format === 'paupercommander' ? isPdhCommanderEligible : isValidCommander;
}

/** Deduped commander candidates present in an imported list, for a format. */
export function commanderCandidatesFor(
  cards: ScryfallCard[] | undefined,
  format: DeckFormat
): ScryfallCard[] {
  if (!cards) return [];
  return dedupeByName(cards.filter(commanderEligibleFor(format)));
}

/**
 * Legal partners for `commander` that are present in the imported card list.
 * Empty unless the commander has a partner mechanic (Partner, "Partner with X",
 * Friends forever, Choose a Background, Doctor's companion). Used to offer —
 * never auto-apply — a second commander on import.
 */
export function partnerCandidatesFor(
  cards: ScryfallCard[] | undefined,
  commander: ScryfallCard | null
): ScryfallCard[] {
  if (!cards || !commander || !canHavePartner(commander)) return [];
  return dedupeByName(cards.filter((c) => areValidPartners(commander, c)));
}

/** Opt-in partner-commander picker shown in the import review/batch steps. */
export function PartnerImportPicker({
  commander,
  candidates,
  partner,
  onSelect,
}: {
  commander: ScryfallCard;
  candidates: ScryfallCard[];
  partner: ScryfallCard | null;
  onSelect: (card: ScryfallCard | null) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <div className="import-deck-commander-section import-deck-partner-section">
      <div className="import-deck-section-title">Partner commander (optional)</div>
      <p className="import-deck-hint">
        {commander.name} can have a partner — add a second commander to combine both color
        identities.
      </p>
      <ul className="import-deck-commander-list">
        {candidates.map((card) => {
          const selected = partner?.name === card.name;
          return (
            <li key={card.id}>
              <button
                type="button"
                className={`import-deck-commander-option${selected ? ' is-selected' : ''}`}
                aria-pressed={selected}
                onClick={() => onSelect(selected ? null : card)}
              >
                <img
                  className="import-deck-commander-art"
                  src={getCardImageUrl(card, 'small')}
                  alt=""
                  aria-hidden="true"
                />
                <div className="import-deck-commander-info">
                  <span className="import-deck-commander-name">{card.name}</span>
                  <span className="import-deck-commander-type">
                    {card.type_line ?? card.card_faces?.[0]?.type_line}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {partner && (
        <button type="button" className="btn-link" onClick={() => onSelect(null)}>
          Remove partner
        </button>
      )}
    </div>
  );
}

export interface ImportParseSummaryProps {
  result: DeckImportResponse;
  /** Format the resolved cards are about to land in — drives the detected-format mismatch banner. */
  selectedFormat: DeckFormat;
  isLoading: boolean;
  /** Re-runs the import (fetch-error retry). */
  onRetry: () => void;
  /**
   * Present only when the caller can act on a detected-format mismatch by
   * switching format (the create-deck flow). Append has no format to switch —
   * the target deck's format is fixed — so it omits this and the mismatch
   * banner's "Switch to X" action is skipped (the "Detected: X" tag above still
   * shows, informationally).
   */
  onSwitchFormat?: (format: DeckFormat) => void;
}

/**
 * Parsed-card summary + unresolved-names / fetch-error reporting for a
 * resolved {@link DeckImportResponse} — the review-step reporting shared by
 * the create-deck and append-to-deck paste flows.
 */
export function ImportParseSummary({
  result,
  selectedFormat,
  isLoading,
  onRetry,
  onSwitchFormat,
}: ImportParseSummaryProps) {
  const detectedFormat = normalizeFormat(result.detectedFormat);
  const formatMismatch = detectedFormat !== null && detectedFormat !== selectedFormat;

  return (
    <>
      <div className="import-deck-review-summary">
        <span>
          Parsed <strong>{result.cardCount}</strong> card{result.cardCount === 1 ? '' : 's'}
        </span>
        {/* Informational, not a warning (E130 convention: nothing broken,
            nothing to retry) — a plain span alongside the count, not an
            .import-deck-warning block. */}
        {(result.considering?.length ?? 0) > 0 && (
          <span>
            <strong>{result.considering!.length}</strong> routed to Considering
          </span>
        )}
        {detectedFormat && (
          <span className="import-deck-review-tag">
            Detected: {DECK_FORMAT_CONFIGS[detectedFormat].label}
          </span>
        )}
      </div>

      {formatMismatch && detectedFormat && onSwitchFormat && (
        <div className="import-deck-warning">
          The file looks like a <strong>{DECK_FORMAT_CONFIGS[detectedFormat].label}</strong> list,
          but you selected <strong>{DECK_FORMAT_CONFIGS[selectedFormat].label}</strong>.{' '}
          <button type="button" className="btn-link" onClick={() => onSwitchFormat(detectedFormat)}>
            Switch to {DECK_FORMAT_CONFIGS[detectedFormat].label}
          </button>
        </div>
      )}

      {result.unresolvedNames.length > 0 && (
        <div className="import-deck-warning">
          <div className="import-deck-warning-title">
            {result.unresolvedNames.length} card{result.unresolvedNames.length === 1 ? '' : 's'}{' '}
            couldn't be matched and will be skipped:
          </div>
          <ul className="import-deck-unresolved-list">
            {result.unresolvedNames.slice(0, 12).map((name) => (
              <li key={name}>{name}</li>
            ))}
            {result.unresolvedNames.length > 12 && (
              <li className="import-deck-unresolved-more">
                …and {result.unresolvedNames.length - 12} more
              </li>
            )}
          </ul>
        </div>
      )}

      {result.fetchErrors.length > 0 && (
        <div className="import-deck-warning">
          <div className="import-deck-warning-title">
            {result.fetchErrors.length} card{result.fetchErrors.length === 1 ? '' : 's'} couldn't be
            fetched — the card service was unreachable. They aren't in this deck yet:
          </div>
          <ul className="import-deck-unresolved-list">
            {result.fetchErrors.slice(0, 12).map((name) => (
              <li key={name}>{name}</li>
            ))}
            {result.fetchErrors.length > 12 && (
              <li className="import-deck-unresolved-more">
                …and {result.fetchErrors.length - 12} more
              </li>
            )}
          </ul>
          <button type="button" className="btn-link" onClick={onRetry} disabled={isLoading}>
            Retry import
          </button>
        </div>
      )}
    </>
  );
}
