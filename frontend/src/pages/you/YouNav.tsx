import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  Archive,
  ChevronRight,
  Coins,
  HardDrive,
  KeyRound,
  LifeBuoy,
  Palette,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react';
import { useAuth } from '@/store/auth';
import { useThemeStore } from '@/store/theme';
import { useTypeSetStore } from '@/store/typeset';
import { useCurrencyStore } from '@/lib/collection/currency';
import { useSignInPath } from '@/lib/account/sign-in-path';
import { THEMES } from '@/lib/account/themes';
import { TYPESETS } from '@/lib/account/typesets';
import type { AiStatus } from '@/lib/ai/ai-review';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/shared/Button';
import { SectionHeader } from '@/components/shared/SectionHeader';
import { Surface } from '@/components/shared/Surface';
import { SECTION_TITLES, type YouSectionId } from './sections';

interface Row {
  /** A section id, or an absolute path for a row that leaves the page. */
  to: YouSectionId | `/${string}`;
  label: string;
  icon: ComponentType<{ width?: number; height?: number; strokeWidth?: number }>;
  summary?: string;
}

interface Props {
  /** The section open beside the list (desktop), or null on the phone hub. */
  current: YouSectionId | null;
  /** Null while loading or where the backend has no AI: the row hides. */
  ai: AiStatus | null;
  friendCount: number | null;
  pendingFriendRequests: number;
}

function friendsSummary(count: number | null, pending: number): string | undefined {
  if (count === null) return undefined;
  const friends = `${count} ${count === 1 ? 'friend' : 'friends'}`;
  return pending > 0 ? `${friends} · ${pending} pending` : friends;
}

/**
 * The You hub: who you are, then one row per section with its current value
 * where it has one. It is the whole page on a phone's `/you`, and the list
 * beside the open section on a desktop.
 */
export function YouNav({ current, ai, friendCount, pendingFriendRequests }: Props) {
  const username = useAuth((s) => s.user?.username ?? null);
  const profile = useAuth((s) => s.profile);
  const signInHref = useSignInPath();
  const theme = useThemeStore((s) => s.theme);
  const typeset = useTypeSetStore((s) => s.typeset);
  const currency = useCurrencyStore((s) => s.currency);

  const themeName = THEMES.find((t) => t.id === theme)?.name;
  const typesetName = TYPESETS.find((t) => t.id === typeset)?.name;

  const groups: { id: string; title: string; rows: Row[] }[] = [
    ...(username
      ? [
          {
            id: 'you-nav-account',
            title: 'Account',
            rows: [
              { to: 'profile', label: SECTION_TITLES.profile, icon: UserRound },
              {
                to: 'account',
                label: SECTION_TITLES.account,
                icon: KeyRound,
                summary: `@${username}`,
              },
              {
                to: '/friends',
                label: 'Friends',
                icon: Users,
                summary: friendsSummary(friendCount, pendingFriendRequests),
              },
            ] satisfies Row[],
          },
        ]
      : []),
    {
      id: 'you-nav-preferences',
      title: 'Preferences',
      rows: [
        {
          to: 'appearance',
          label: SECTION_TITLES.appearance,
          icon: Palette,
          summary: [themeName, typesetName].filter(Boolean).join(' · '),
        },
        { to: 'prices', label: SECTION_TITLES.prices, icon: Coins, summary: currency },
        ...(ai
          ? [
              {
                to: 'ai',
                label: SECTION_TITLES.ai,
                icon: Sparkles,
                summary: ai.optIn ? 'On' : 'Off',
              } satisfies Row,
            ]
          : []),
      ],
    },
    {
      id: 'you-nav-data',
      title: 'Your data',
      rows: [
        { to: 'data', label: SECTION_TITLES.data, icon: Archive },
        { to: 'storage', label: SECTION_TITLES.storage, icon: HardDrive },
      ],
    },
    {
      id: 'you-nav-help',
      title: 'Help',
      rows: [{ to: 'help', label: SECTION_TITLES.help, icon: LifeBuoy }],
    },
  ];

  return (
    <nav className="you-nav" aria-label="You">
      <Surface variant="framed" className="you-identity">
        {username ? (
          <Link
            viewTransition
            to="/you/profile"
            className="you-identity-body you-identity-body--link"
          >
            <UserAvatar
              imageUrl={profile?.avatarImageUrl}
              name={profile?.displayName ?? username}
              size={44}
            />
            <span className="you-identity-text">
              <span className="you-identity-name">{profile?.displayName || username}</span>
              <span className="you-identity-handle">@{username}</span>
            </span>
            <ChevronRight className="you-nav-row-chevron" width={16} height={16} aria-hidden />
          </Link>
        ) : (
          <div className="you-identity-body">
            <span className="you-identity-text">
              <span className="you-identity-name">Not signed in</span>
              <span className="you-identity-handle">Saved on this device.</span>
            </span>
            <Button variant="primary" placement="row" to={signInHref}>
              Sign in to sync
            </Button>
          </div>
        )}
      </Surface>

      {groups.map((group) => (
        <section key={group.id} className="you-nav-group" aria-labelledby={group.id}>
          <SectionHeader
            title={group.title}
            id={group.id}
            titleClassName="settings-section-header"
            variant="overline"
          />
          <ul className="you-nav-list">
            {group.rows.map((row) => {
              const href = row.to.startsWith('/') ? row.to : `/you/${row.to}`;
              const Icon = row.icon;
              return (
                <li key={row.to}>
                  <Link
                    viewTransition
                    to={href}
                    className="you-nav-row"
                    aria-current={row.to === current ? 'page' : undefined}
                  >
                    <Icon width={14} height={14} strokeWidth={1.8} aria-hidden />
                    <span className="you-nav-row-label">{row.label}</span>
                    {row.summary && <span className="you-nav-row-value">{row.summary}</span>}
                    <ChevronRight
                      className="you-nav-row-chevron"
                      width={16}
                      height={16}
                      aria-hidden
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
