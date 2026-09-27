import './YourCardsCard.css';
import { useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useCubeStore } from '../../store/cube';
import { useAllocations } from '../../lib/allocations';
import { useCurrency } from '../../lib/currency';
import { formatMoney } from '../../lib/format-money';
import {
  computeCloseToDone,
  computeSharedCopies,
  computeSparesSummary,
} from '../../lib/collection-insights';
import { isRecentPartialImport, latestImport } from '../../lib/home-signals';
import { HomeCard } from './HomeCard';

/** Rows the card shows at most; the rest live in the Breakdown drawer. */
const ROW_LIMIT = 3;

interface Row {
  key: string;
  to: string;
  name: string;
  meta: string;
  label: string;
}

const money = (n: number) => formatMoney(n, { wholeDollars: true });

/**
 * What you can do with the cards you have: the deck a few cards from done,
 * the spare copies you could trade, the card more decks want than you own.
 * The same insights the collection's Breakdown drawer lists in full, cut to
 * the three that matter most, each row a door to where you act on it.
 *
 * It takes the band's second slot when Recently added has nothing new to say
 * (no import this month, or an import that was the whole collection), so the
 * band never carries three cards (T164). No insight: nothing at all.
 */
export function YourCardsCard() {
  const cards = useCollectionStore((s) => s.cards);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const importHistory = useCollectionStore((s) => s.importHistory);
  const decks = useDecksStore((s) => s.decks);
  const decksHydrated = useDecksStore((s) => s.hydrated);
  const cubes = useCubeStore((s) => s.saved);
  const allocations = useAllocations();
  const currency = useCurrency();
  const [now] = useState(() => Date.now());

  const recentImport = isRecentPartialImport(latestImport(importHistory), cards.length, now);

  const rows = useMemo<Row[]>(() => {
    if (recentImport) return [];
    const out: Row[] = [];
    const ownedNames = new Set(cards.map((c) => c.name));
    for (const deck of computeCloseToDone(decks, ownedNames, currency).slice(0, 2)) {
      const n = deck.missingNames.length;
      const toFinish = `${n} card${n === 1 ? '' : 's'} to finish`;
      const cost = deck.costToFinish > 0 ? ` · ${money(deck.costToFinish)}` : '';
      out.push({
        key: `deck:${deck.deckId}`,
        to: `/decks/${deck.deckId}`,
        name: deck.deckName,
        meta: `${toFinish}${cost}`,
        label: `Open deck: ${deck.deckName}, ${toFinish}${cost.replace(' · ', ', ')}`,
      });
    }
    const spares = computeSparesSummary(cards, allocations);
    if (spares) {
      const copies = `${spares.count.toLocaleString()} ${spares.count === 1 ? 'copy' : 'copies'}`;
      out.push({
        key: 'spares',
        to: '/collection?spares',
        name: 'Spare copies',
        meta: spares.value > 0 ? `${copies} · ${money(spares.value)}` : copies,
        label: `Show your spare copies: ${copies}${spares.value > 0 ? `, ${money(spares.value)}` : ''}`,
      });
    }
    const shared = computeSharedCopies(cards, decks, cubes)[0];
    if (shared) {
      const meta = `in ${shared.demand} decks, you own ${shared.owned}`;
      out.push({
        key: `shared:${shared.cardName}`,
        to: '/collection?stats',
        name: shared.cardName,
        meta,
        label: `${shared.cardName}: ${meta}. Open the breakdown`,
      });
    }
    return out.slice(0, ROW_LIMIT);
  }, [recentImport, cards, decks, cubes, allocations, currency]);

  return (
    <HomeCard
      title="Your cards"
      icon={Layers}
      loading={hydrating || !decksHydrated}
      empty={rows.length === 0}
      viewAllHref="/collection?stats"
      viewAllLabel="Breakdown"
      className="home-your-cards"
    >
      <ul className="home-your-cards-list">
        {rows.map((row) => (
          <li key={row.key}>
            <Link to={row.to} className="home-your-cards-row" aria-label={row.label}>
              <span className="home-your-cards-name">{row.name}</span>
              <span className="home-your-cards-meta">{row.meta}</span>
            </Link>
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}
