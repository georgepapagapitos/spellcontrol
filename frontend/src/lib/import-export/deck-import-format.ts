// Format and commander detection for an imported deck list: which format a
// detected slug names, and which cards in the list can lead the deck. Shared by
// the import and append dialogs (components/deck/import-deck-shared.tsx) and by
// the non-UI import, bulk-edit and format-conversion paths in lib/.

import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { areValidPartners, canHavePartner } from '@/deck-builder/lib/partnerUtils';
import { isValidCommander, isPdhCommanderEligible } from '@/lib/deck/commanders';

const FORMATS = Object.keys(DECK_FORMAT_CONFIGS) as DeckFormat[];

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
 *  see lib/deck/commanders.ts), every other commander format uses the legendary rule. */
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
