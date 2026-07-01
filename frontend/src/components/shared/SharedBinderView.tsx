import { useMemo, useState } from 'react';
import { LayoutGrid, List as ListIcon } from 'lucide-react';
import type { PublicBinder } from '../../lib/shared-types';
import { normalizeForSearch } from '../../lib/normalize-search';
import { formatMoney } from '../../lib/format-money';
import { groupCards } from '../../lib/shared-grouping';
import { SharedCardTile } from './SharedCardTile';
import { SharedCardList } from './SharedCardList';
import { CardPreview } from '../CardPreview';
import { publicCardToEnriched } from '../../lib/shared-filter';
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
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // Facet options derive from every card across the binder's sections.
  const allCards = useMemo(() => data.sections.flatMap((s) => s.cards), [data.sections]);
  const { filterNode, matches } = useSharedFilters(allCards);

  const q = normalizeForSearch(search);
  // Filter each section, group duplicate copies (so grid + list agree, matching
  // the collection view), and stamp each section's start offset into the flat
  // carousel list so a tile's local index maps to a global carousel index.
  const sections = useMemo(() => {
    const withGroups = data.sections
      .map((s) => ({
        ...s,
        cards: s.cards.filter((c) => (!q || normalizeForSearch(c.name).includes(q)) && matches(c)),
      }))
      .filter((s) => s.cards.length > 0)
      .map((s) => ({ ...s, groups: groupCards(s.cards) }));
    // Prefix-sum each section's start offset without a render-scope reassignment
    // (React Compiler immutability rule).
    const lengths = withGroups.map((s) => s.groups.length);
    return withGroups.map((s, i) => ({
      ...s,
      start: lengths.slice(0, i).reduce((a, b) => a + b, 0),
    }));
  }, [data.sections, q, matches]);

  // Flat card list across all sections (in render order) for the carousel.
  const previewCards = useMemo(
    () => sections.flatMap((s) => s.groups.map((g) => publicCardToEnriched(g.card))),
    [sections]
  );
  const previewLabels = useMemo(
    () => sections.flatMap((s) => s.groups.map(() => s.label)),
    [sections]
  );
  const previewQty = useMemo(
    () => sections.flatMap((s) => s.groups.map((g) => g.quantity)),
    [sections]
  );
  const previewPages = useMemo(() => previewCards.map(() => 0), [previewCards]);

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
                {section.groups.map((g, j) => (
                  <li key={g.key}>
                    <SharedCardTile
                      card={g.card}
                      quantity={g.quantity}
                      onClick={() => setPreviewIndex(section.start + j)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <SharedCardList
                items={section.groups}
                onPreview={(j) => setPreviewIndex(section.start + j)}
              />
            )}
          </section>
        ))
      )}

      {previewIndex !== null && previewCards[previewIndex] && (
        <CardPreview
          source="binder"
          cards={previewCards}
          index={previewIndex}
          binderName={data.name}
          sectionLabels={previewLabels}
          pageNumbers={previewPages}
          totalPages={0}
          getStackQty={(i) => previewQty[i] ?? 1}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </main>
  );
}
