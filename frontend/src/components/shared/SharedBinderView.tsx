import { useMemo, useState } from 'react';
import type { PublicBinder, PublicCard } from '../../lib/shared-types';
import { normalizeForSearch } from '../../lib/normalize-search';
import { formatMoney } from '../../lib/format-money';
import { SharedCardTile } from './SharedCardTile';
import { SharedCardModal } from './SharedCardModal';
import { SearchPill } from '../SearchPill';

interface Props {
  data: PublicBinder;
}

/**
 * Public read-only view of a shared binder. The backend already routed the
 * owner's collection through their binder rules (via the shared
 * `@spellcontrol/binder-routing` engine) and handed us pre-grouped sections —
 * this component only filters by search and renders. No store reads.
 */
export function SharedBinderView({ data }: Props) {
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<PublicCard | null>(null);

  const q = normalizeForSearch(search);
  const sections = useMemo(() => {
    if (!q) return data.sections;
    return data.sections
      .map((s) => ({
        ...s,
        cards: s.cards.filter((c) => normalizeForSearch(c.name).includes(q)),
      }))
      .filter((s) => s.cards.length > 0);
  }, [data.sections, q]);

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
        />
      </div>

      {sections.length === 0 ? (
        <p className="shared-empty">
          {data.totalCards === 0 ? 'This binder is empty.' : 'No cards match your search.'}
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
            <ul className="shared-card-grid shared-card-grid--small">
              {section.cards.map((card, idx) => (
                <li key={`${card.scryfallId}-${idx}`}>
                  <SharedCardTile card={card} onClick={() => setPreview(card)} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {preview && <SharedCardModal card={preview} onClose={() => setPreview(null)} />}
    </main>
  );
}
