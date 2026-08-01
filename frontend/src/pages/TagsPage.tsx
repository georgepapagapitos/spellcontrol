import { LayoutGrid, List, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import './TagsPage.css';
import { SearchPill } from '../components/SearchPill';
import { InlineCardSearch, type InlineCardSearchView } from '../components/InlineCardSearch';
import { ViewModeToggle } from '../components/ViewModeToggle';
import {
  cardTagLabel,
  ensureCardTags,
  listCardTagsRanked,
  useCardTagsError,
  useCardTagsReady,
} from '../lib/card-tags';
import { describeOtag } from '../lib/otag-descriptions';
import { parseTagParam, searchTags, tagsToQuery } from '../lib/tag-explorer';
import { useStoredView } from '../lib/use-stored-view';

/** Rendered tag rows. The corpus is ~4,500 tags — far past what's browsable,
 *  and past what's worth putting in the DOM. Searching narrows it. */
const TAG_LIMIT = 120;

/**
 * Tag-driven card discovery (`/tags`). EDHREC-style recommendations are
 * commander-anchored, so every commanderless context — cube, 60-card, plain
 * browsing — gets no discovery at all. This browses the bundled Scryfall
 * oracle-tag corpus by function ("mana rock", "one-sided sweeper") and hands
 * the selection to the shared {@link InlineCardSearch} as an `otag:` query, so
 * results, owned badges, the preview carousel, and add-a-copy are the same
 * ones `/search` uses.
 *
 * Selected tags intersect (adding one always narrows) and live in `?t=` so a
 * lens is shareable and survives back/forward.
 */
export function TagsPage() {
  const [params, setParams] = useSearchParams();
  const selected = useMemo(() => parseTagParam(params.get('t')), [params]);
  const [tagQuery, setTagQuery] = useState('');
  const [view, setView] = useStoredView<InlineCardSearchView>(
    'mtg-tags-view-mode',
    ['grid', 'list'],
    'grid'
  );
  const ready = useCardTagsReady();
  const loadError = useCardTagsError();

  const matches = useMemo(
    () => (ready ? searchTags(listCardTagsRanked(), tagQuery, TAG_LIMIT) : []),
    [ready, tagQuery]
  );
  const total = ready ? listCardTagsRanked().length : 0;

  const setSelected = (next: string[]) =>
    setParams(next.length ? { t: next.join(',') } : {}, { replace: true });

  const toggleTag = (slug: string) =>
    setSelected(selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug]);

  const query = tagsToQuery(selected);

  return (
    <div className={`tags-page${view === 'grid' ? ' tags-page--grid' : ''}`}>
      <header className="tags-page-head">
        <h1>Browse by tag</h1>
        <p className="tags-page-sub">
          Find cards by what they do, not what they’re called. Pick a function to see every card
          that does it — no commander required.
        </p>
      </header>

      <SearchPill
        className="tags-page-pill"
        placeholder={total ? `Search ${total.toLocaleString()} tags…` : 'Search tags…'}
        value={tagQuery}
        onChange={setTagQuery}
        ariaLabel="Search card tags"
      />

      {selected.length > 0 && (
        <div className="tags-selected">
          <ul className="tags-selected-list" role="list">
            {selected.map((slug) => (
              <li key={slug}>
                <button
                  type="button"
                  className="tags-selected-chip"
                  onClick={() => toggleTag(slug)}
                  aria-label={`Remove ${cardTagLabel(slug)} from the selection`}
                >
                  {cardTagLabel(slug)}
                  <X width={12} height={12} strokeWidth={2.5} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="tags-selected-clear" onClick={() => setSelected([])}>
            Clear all
          </button>
        </div>
      )}

      {!ready && loadError ? (
        <div className="tags-page-status" role="alert">
          <p className="empty-state-tagline">Couldn’t load the tag list.</p>
          <p className="empty-state-hint">
            The tag snapshot ships with the app, so this is usually a one-off.{' '}
            <button type="button" className="tags-retry" onClick={() => void ensureCardTags()}>
              Try again
            </button>
          </p>
        </div>
      ) : !ready ? (
        <p className="tags-page-status" role="status">
          Loading tags…
        </p>
      ) : matches.length === 0 ? (
        <div className="tags-page-status">
          <p className="empty-state-tagline">No tag matches “{tagQuery.trim()}”.</p>
          <p className="empty-state-hint">
            Tags describe function — try “sweeper”, “tutor”, “token”, or “counter”.
          </p>
        </div>
      ) : (
        <>
          <ul className="tags-list" role="list">
            {matches.map(({ slug, count }) => {
              const active = selected.includes(slug);
              return (
                <li key={slug}>
                  <button
                    type="button"
                    className={`tags-row${active ? ' is-active' : ''}`}
                    aria-pressed={active}
                    onClick={() => toggleTag(slug)}
                  >
                    <span className="tags-row-head">
                      <span className="tags-row-label">{cardTagLabel(slug)}</span>
                      <span className="tags-row-count">{count.toLocaleString()} cards</span>
                    </span>
                    <span className="tags-row-desc">{describeOtag(slug)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {total > matches.length && (
            <p className="tags-list-note">
              Showing {matches.length} of {total.toLocaleString()} tags — search to narrow.
            </p>
          )}
        </>
      )}

      {selected.length > 0 ? (
        <section className="tags-results" aria-label="Cards matching the selected tags">
          <div className="tags-results-toolbar">
            <h2 className="tags-results-title">
              {selected.length === 1
                ? cardTagLabel(selected[0])
                : `${selected.length} tags, all at once`}
            </h2>
            <ViewModeToggle<InlineCardSearchView>
              ariaLabel="Result layout"
              value={view}
              onChange={setView}
              options={[
                {
                  value: 'grid',
                  label: 'Cards view',
                  icon: <LayoutGrid width={14} height={14} strokeWidth={2} aria-hidden />,
                },
                {
                  value: 'list',
                  label: 'List view',
                  icon: <List width={14} height={14} strokeWidth={2} aria-hidden />,
                },
              ]}
            />
          </div>
          <InlineCardSearch query={query} view={view} />
        </section>
      ) : (
        ready && (
          <div className="tags-page-status tags-page-landing">
            <p className="empty-state-tagline">Pick a tag to see what it finds.</p>
            <p className="empty-state-hint">
              Choose more than one to narrow — “sweeper” plus “instant speed” is a much shorter
              list. Tap a result to read it; + adds a copy to your collection.
            </p>
          </div>
        )
      )}
    </div>
  );
}
