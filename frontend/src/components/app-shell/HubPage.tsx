import type { ReactNode } from 'react';
import { CollectionHubTabs } from '@/components/collection/CollectionHubTabs';
import { DecksHubTabs } from '@/components/decks/DecksHubTabs';
import { PlayHubTabs } from '@/components/play/PlayHubTabs';
import { SocialHubTabs } from '@/components/social/SocialHubTabs';
import { PageHeader, type PageHeaderAction } from './PageHeader';

export type Hub = 'collection' | 'decks' | 'play' | 'social';

type TabsProps = { counts?: Record<string, number> };

const HUBS: Record<Hub, { title: string; Tabs: (p: TabsProps) => ReactNode }> = {
  collection: { title: 'Collection', Tabs: CollectionHubTabs },
  decks: { title: 'Decks', Tabs: DecksHubTabs },
  play: { title: 'Play', Tabs: PlayHubTabs },
  social: { title: 'Social', Tabs: SocialHubTabs },
};

interface Props {
  hub: Hub;
  /** The current tab's name. Visible in the strip; the heading carries it for
   *  screen readers, since route changes move focus to the `<h1>`. */
  section: string;
  titleId?: string;
  actions?: PageHeaderAction[];
  menuLabel?: string;
  /** The tab's own one-liner (a count, a description). Sits under the strip,
   *  never above it, so it can't move the tabs. */
  intro?: ReactNode;
  introClassName?: string;
  /** Live counts the page already holds, keyed by tab path, for a strip that
   *  can't read them itself (Play's game-night invites come from the page's
   *  own fetch). */
  counts?: Record<string, number>;
  /** The page's own root class, for its gap and content styles. */
  className?: string;
  children?: ReactNode;
}

/**
 * The root of every hub index page (STYLE_GUIDE § Layout system → Hub pages).
 * The hub owns the title, the header row's height, the tab strip and the
 * page width, so switching tabs leaves the strip exactly where it was. Pages
 * pass only what differs per tab: actions, an intro line, and the content.
 *
 * The header and strip are direct children of this root, not wrapped: the
 * strip is `position: sticky`, and a wrapper would end its sticky range at
 * the wrapper's bottom edge.
 */
export function HubPage({
  hub,
  section,
  titleId,
  actions,
  menuLabel,
  intro,
  introClassName,
  counts,
  className,
  children,
}: Props) {
  const { title, Tabs } = HUBS[hub];
  return (
    <div className={`hub-page hub-page--${hub}${className ? ` ${className}` : ''}`}>
      <PageHeader
        // One string for the accessible name ("Decks: Cube"); split across
        // two elements it computes as "Decks : Cube".
        title={
          section === title ? (
            title
          ) : (
            <>
              <span aria-hidden="true">{title}</span>
              <span className="sr-only">{`${title}: ${section}`}</span>
            </>
          )
        }
        titleId={titleId}
        actions={actions}
        menuLabel={menuLabel}
        compactPrimary
      />
      <Tabs counts={counts} />
      {intro && (
        <p
          className={`binder-hero-meta hub-page-intro${introClassName ? ` ${introClassName}` : ''}`}
        >
          {intro}
        </p>
      )}
      {children}
    </div>
  );
}
