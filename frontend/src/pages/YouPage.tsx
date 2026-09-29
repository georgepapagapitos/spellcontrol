import { useEffect, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { BackLink } from '@/components/BackLink';
// Admin + scanner sheet: shared with AdminPage and CardScanner, off the boot payload (E265).
import '@/styles/admin-scanner.css';
// Settings/admin page body: shared with AdminPage, off the boot payload.
import '@/styles/settings-page.css';
import { useAuth } from '@/store/auth';
import { useMediaQuery } from '@/lib/use-media-query';
import { useDocumentTitle } from '@/lib/use-document-title';
import { fetchAiStatus, type AiStatus } from '@/lib/ai-review';
import { listFriends } from '@/lib/friends-client';
import { useFriendRequests } from '@/lib/use-friend-requests';
import { AiFeaturesSettings } from '@/components/settings/AiFeaturesSettings';
import {
  LEGACY_SECTION_ROUTES,
  SECTION_TITLES,
  isYouSection,
  type YouSectionId,
} from './you/sections';
import { YouNav } from './you/YouNav';
import { ProfileSection } from './you/ProfileSection';
import { AccountSection } from './you/AccountSection';
import { AppearanceSection } from './you/AppearanceSection';
import { PricesSection } from './you/PricesSection';
import { DataSection } from './you/DataSection';
import { StorageSection } from './you/StorageSection';
import { HelpSection } from './you/HelpSection';

/** The desktop tier (STYLE_GUIDE § Layout system): the list sits beside the section. */
const DESKTOP = '(min-width: 1024px)';

/**
 * `/you` and `/you/:section`. A phone's `/you` is the hub, a list of the
 * sections with their current values; each section is its own page with a
 * way back. A desktop shows the list beside the open section, and `/you`
 * opens the first one (Profile, or Appearance for a guest, who has no
 * profile).
 */
export function YouPage() {
  const { section: param } = useParams();
  const [searchParams] = useSearchParams();
  const username = useAuth((s) => s.user?.username ?? null);
  const isDesktop = useMediaQuery(DESKTOP);

  // Undefined while loading; null where the backend has no AI or the user
  // is signed out. The hub row shows On/Off and hides on null.
  const [fetchedAi, setAi] = useState<AiStatus | null | undefined>(undefined);
  const ai = username ? fetchedAi : null;
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    fetchAiStatus()
      .then((s) => {
        if (!cancelled) setAi(s);
      })
      .catch(() => {
        if (!cancelled) setAi(null);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  // The Friends row's summary. Best-effort, like the AI status.
  const { count: pendingFriendRequests } = useFriendRequests();
  const [friendCount, setFriendCount] = useState<number | null>(null);
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    listFriends()
      .then((r) => {
        if (!cancelled) setFriendCount(r.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [username]);

  const fallback: YouSectionId = username ? 'profile' : 'appearance';
  const current: YouSectionId | null = isYouSection(param) ? param : isDesktop ? fallback : null;
  useDocumentTitle(current && param ? SECTION_TITLES[current] : null);

  // An old `?section=` link, or the Google link callback, which carries its
  // result in `linked` / `linkError` for the Account section to announce.
  const legacy = searchParams.get('section');
  const linkResult = searchParams.has('linked') || searchParams.has('linkError');
  const legacyTarget =
    (legacy ? LEGACY_SECTION_ROUTES[legacy] : undefined) ?? (linkResult ? 'account' : undefined);
  if (legacyTarget && param !== legacyTarget) {
    const keep = new URLSearchParams();
    for (const key of ['linked', 'linkError']) {
      const v = searchParams.get(key);
      if (v) keep.set(key, v);
    }
    return <Navigate to={{ pathname: `/you/${legacyTarget}`, search: `${keep}` }} replace />;
  }
  if (legacy) return <Navigate to={param ? `/you/${param}` : '/you'} replace />;
  if (param && !isYouSection(param)) return <Navigate to="/you" replace />;
  // A guest has no profile; the sign-in card is the nearest thing.
  if (param === 'profile' && !username) return <Navigate to="/you/account" replace />;

  const nav = (
    <YouNav
      current={current}
      ai={ai ?? null}
      friendCount={friendCount}
      pendingFriendRequests={pendingFriendRequests}
    />
  );

  if (!current) {
    return (
      <div className="settings-page you-hub">
        <PageHeader title="You" />
        {nav}
      </div>
    );
  }

  const body = (
    <div className="you-section">
      <SectionBody section={current} username={username} ai={ai} onAiChange={setAi} />
    </div>
  );

  if (isDesktop) {
    return (
      <div className="settings-page you-layout">
        {nav}
        <div className="you-pane">
          <PageHeader title={SECTION_TITLES[current]} />
          {body}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <BackLink to="/you" label="You" />
      <PageHeader title={SECTION_TITLES[current]} />
      {body}
    </div>
  );
}

function SectionBody({
  section,
  username,
  ai,
  onAiChange,
}: {
  section: YouSectionId;
  username: string | null;
  ai: AiStatus | null | undefined;
  onAiChange: (next: AiStatus) => void;
}) {
  switch (section) {
    case 'profile':
      return username ? <ProfileSection username={username} /> : <AccountSection />;
    case 'account':
      return <AccountSection />;
    case 'appearance':
      return <AppearanceSection />;
    case 'prices':
      return <PricesSection />;
    case 'ai':
      if (ai) return <AiFeaturesSettings status={ai} onStatusChange={onAiChange} />;
      if (ai === undefined) return null;
      return (
        <p className="settings-card-hint">
          {username ? "AI deck analysis isn't available." : 'Sign in to use AI deck analysis.'}
        </p>
      );
    case 'data':
      return <DataSection />;
    case 'storage':
      return <StorageSection />;
    case 'help':
      return <HelpSection />;
  }
}
