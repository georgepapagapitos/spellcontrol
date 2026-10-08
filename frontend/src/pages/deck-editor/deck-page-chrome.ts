import type { LucideIcon } from 'lucide-react';
import { ClipboardPaste, Coins, FileText, Library, RefreshCw } from 'lucide-react';
import type { DeckView } from '../../components/deck/DeckDisplay';
import type { ListAction } from '../../components/deck/DeckToolbar';
import type { TabBadge } from '@/components/overlays/Tabs';
import { bracketLabel } from '@/deck-builder/services/deckBuilder/bracketEstimator';

export interface DeckViewTab {
  id: DeckView;
  label: string;
  badge?: TabBadge | null;
}

/**
 * The page-top tabs: Deck, then Power and Coach on a Commander-format deck.
 * Power + Coach are Commander-only: their analysis (bracket fit, EDHREC-driven
 * Improve, command-zone-aware stats) doesn't apply to 60-card formats, where
 * it read as misleading (E2/T19). A commander format still shows them before
 * cards are added, for its early power signals.
 *
 * Coach carries no count badge: a bare number there read as a mystery (it was
 * the in-deck combo count). Power's badge is its already-computed verdict
 * (E223); the checks verdict leads the Deck tab's stat strip instead.
 */
export function deckViewTabs(
  showAnalysisExtras: boolean,
  bracketValue: number | undefined,
  bracketText: string | undefined
): DeckViewTab[] {
  const powerBadge: TabBadge | null =
    bracketValue !== undefined && bracketText !== undefined
      ? {
          text: bracketText,
          description: `bracket ${bracketText} of 5, ${bracketLabel(bracketValue)}`,
          tone: 'neutral',
        }
      : null;
  return [
    { id: 'deck', label: 'Deck' },
    ...(showAnalysisExtras
      ? [
          { id: 'power' as DeckView, label: 'Power', badge: powerBadge },
          { id: 'tune' as DeckView, label: 'Coach' },
        ]
      : []),
  ];
}

const action = (label: string, icon: LucideIcon, onClick: (() => void) | undefined) =>
  onClick ? [{ label, icon, onClick }] : [];

/**
 * The toolbar's Edit menu: changes to the card list (STYLE_GUIDE § Deck page
 * menus). The two printing fixes appear only when they would change
 * something: a bound copy of another printing, or a card with no owned copy.
 */
export function deckEditActions(handlers: {
  paste: () => void;
  bulkEdit: () => void;
  resync: () => void;
  matchCopies?: () => void;
  cheapestPrintings?: () => void;
}): ListAction[] {
  return [
    ...action('Paste cards', ClipboardPaste, handlers.paste),
    ...action('Bulk edit', FileText, handlers.bulkEdit),
    ...action('Resync from a list', RefreshCw, handlers.resync),
    ...action('Match my copies', Library, handlers.matchCopies),
    ...action('Cheapest printings for missing', Coins, handlers.cheapestPrintings),
  ];
}
