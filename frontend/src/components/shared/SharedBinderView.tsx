import { useMemo, useState } from 'react';
import { LayoutGrid, List as ListIcon } from 'lucide-react';
import type { PublicBinder, PublicCard } from '../../lib/shared-types';
import { normalizeForSearch } from '../../lib/normalize-search';
import { formatMoney } from '../../lib/format-money';
import { groupCards } from '../../lib/shared-grouping';
import { SharedCardTile } from './SharedCardTile';
import { SharedCardList } from './SharedCardList';
import { SharedCardModal } from './SharedCardModal';
import { useSharedFilters } from './use-shared-filters';
import { SearchPill } from '../SearchPill';
import { ViewModeToggle } from '../ViewModeToggle';

interface Props {
  data: PublicBinder;
}

type ViewKind = 'grid' | 'list';

/**
 * Public read-only view of a shared binder. The backend already routed the
 * owner's collection through their binder rules (via the shared
 * `@spellcontrol/binder-routing` engine) and handed us pre-grouped sections —
 * this component only filters by search and renders. No store reads.
 */
export function SharedBinderView({ data }: Props) {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewKind>('grid');
  const [preview, setPreview] = useState<PublicCard | null>(null);

  // Facet options derive from every card across the binder's sections.
  const allCards = useMemo(() => data.sections.flatMap((s) => s.cards), [data.sections]);
  const { filterNode, matches } = useSharedFilters(allCards);

  const q = normalizeForSearch(search);
  const sections = useMemo(() => {
    return data.sections
      .map((s) => ({
        ...s,
        cards: s.cards.filter((c) => (!q || normalizeForSearch(c.name).includes(q)) && matches(c)),
      }))
      .filter((s) => s.cards.length > 0);
  }, [data.sections, q, matches]);

  return (
    <main className="shared-view">
      <header className="shared-view-header">
        <p className="shared-view-owner">Shared by @{data.ownerUsername}</p>
        <h1 className="shared-view-title">{data.name}</h1>
        <p className="shared-view-subtitle">
          {data.totalCards.toLocaleString()} cards
          {data.totalValue > 0 ? ` · ~${formatMoney(data.totalValue, { wholeDollars: true })}` : ''}
        </p>
      </header>

      <div className="shared-toolbar">
        <SearchPill
          value={search}
          onChange={setSearch}
          placeholder="Search cards in this binder…"
          ariaLabel="Search cards"
          className="shared-toolbar-search"
          trailing={filterNode}
        />
        <ViewModeToggle<ViewKind>
          ariaLabel="Binder view mode"
          value={view}
          onChange={setView}
          options={[
            {
              value: 'grid',
              label: 'Grid view',
              icon: <LayoutGrid width={14} height={14} strokeWidth={2} aria-hidden />,
            },
            {
              value: 'list',
              label: 'List view',
              icon: <ListIcon width={14} height={14} strokeWidth={2} aria-hidden />,
            },
          ]}
        />
      </div>

      {sections.length === 0 ? (
        <p className="shared-empty">
          {data.totalCards === 0
            ? 'This binder is empty.'
            : 'No cards match your search or filters.'}
        </p>
      ) : (
        sections.map((section) => (
          <section key={section.key} className="shared-deck-section">
            <h2 className="shared-deck-section-heading">
              {section.pip && (
                <span
                  className="shared-binder-section-pip"
                  style={{ background: section.pip.background, borderColor: section.pip.border }}
                  aria-hidden="true"
                />
              )}
              {section.label} ({section.cards.length})
            </h2>
            {view === 'grid' ? (
              <ul className="shared-card-grid shared-card-grid--small">
                {section.cards.map((card, idx) => (
                  <li key={`${card.scryfallId}-${idx}`}>
                    <SharedCardTile card={card} onClick={() => setPreview(card)} />
                  </li>
                ))}
              </ul>
            ) : (
              <SharedCardList items={groupCards(section.cards)} onPreview={setPreview} />
            )}
          </section>
        ))
      )}

      {preview && <SharedCardModal card={preview} onClose={() => setPreview(null)} />}
    </main>
  );
}
