import type { PublicCollection } from '@/lib/social/shared-types';
import { formatIdentity } from '@/lib/social/display-name';
import { CollectionBrowser } from './CollectionBrowser';

interface Props {
  data: PublicCollection;
  /** Inside a page that already has its own heading and wrapper. */
  embedded?: boolean;
  /** The viewer is the person whose collection this is. Everyone else,
   *  including the owner on a bare share link, sees "Their copy". */
  viewerIsOwner?: boolean;
}

/**
 * /s/:token for a collection share: the shared `CollectionBrowser` fed a
 * payload that is already loaded. Kept as the adapter so the share page does
 * not need to know the browser's props.
 */
export function SharedCollectionView({ data, embedded = false, viewerIsOwner = false }: Props) {
  const owner = formatIdentity({
    username: data.ownerUsername,
    displayName: data.ownerDisplayName,
  });
  return (
    <CollectionBrowser
      cards={data.cards}
      ownerName={owner.primary}
      ownerHandle={owner.secondary}
      viewer={viewerIsOwner ? 'owner' : 'public'}
      embedded={embedded}
    />
  );
}
