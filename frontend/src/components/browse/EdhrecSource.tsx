import './EdhrecSource.css';
import { formatRelativeTime } from '@/lib/util/format-time';
import type { EdhrecProvenance } from '@/lib/discover/browse-lists';

/**
 * Where an EDHREC list comes from and how old our copy is. EDHREC's numbers
 * are theirs, so every list that shows them names EDHREC and links to the
 * page it came from. When EDHREC couldn't be reached the backend serves its
 * last copy, and this line says so plainly instead of passing it off as today's.
 */
export function EdhrecSource({ provenance }: { provenance: EdhrecProvenance }) {
  const when = formatRelativeTime(provenance.fetchedAt, { verbose: true });
  const link = (
    <a href={provenance.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-link">
      EDHREC
    </a>
  );
  return (
    <p className="browse-source">
      {provenance.stale ? (
        <>
          {link} couldn't be reached, so this list is from {when}.
        </>
      ) : (
        <>
          Data from {link} · updated {when}
        </>
      )}
    </p>
  );
}
