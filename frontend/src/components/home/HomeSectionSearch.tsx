import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Search } from 'lucide-react';
import { SearchPill } from '../SearchPill';
import { IconButton } from '@/components/shared/Button';

interface Props {
  /** Placeholder and accessible name, e.g. "Search your decks". */
  label: string;
  /** Where a submitted term goes. */
  toResults: (term: string) => string;
  /** Where an empty submit, and the phone's search button, go. */
  toPage: string;
}

/**
 * A section's own search, beside the list it searches. Home used to have one
 * search in the hero with a My decks / Discover scope toggle; the toggle only
 * existed because one box served two lists. Each list now carries its own.
 *
 * From 600px it is a SearchPill that submits to the list's page. On a phone a
 * second full-width pill in every section header costs more than it earns, so
 * it is a 44px search button that opens the page, where search is the first
 * control.
 */
export function HomeSectionSearch({ label, toResults, toPage }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const term = query.trim();
    navigate(term ? toResults(term) : toPage);
  }

  return (
    <>
      <form className="home-section-search" role="search" onSubmit={onSubmit}>
        <SearchPill
          value={query}
          onChange={setQuery}
          placeholder={label}
          ariaLabel={label}
          className="home-section-search-pill"
          trailing={
            <IconButton
              className="home-section-search-submit"
              type="submit"
              label="Search"
              icon={<ArrowRight width={16} height={16} strokeWidth={2} />}
            />
          }
        />
      </form>
      <Link to={toPage} className="home-section-search-link" aria-label={label}>
        <Search width={20} height={20} strokeWidth={1.8} aria-hidden />
      </Link>
    </>
  );
}
