import { useEffect, useRef, useState } from 'react';
import { THEMES } from '../lib/themes';
import { useThemeStore } from '../store/theme';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';

/**
 * Unified settings popover. Surfaces account info, theme selection, and
 * maintenance actions (refresh prices, sign out) from a single trigger so
 * the rest of the nav stays focused on routes.
 *
 * Two display modes that match the existing nav patterns:
 *   - default: gear button in the desktop site-header; menu drops down.
 *   - tab:    full-width tab in the mobile bottom bar; menu opens upward.
 */
export function SettingsMenu({ variant = 'default' }: { variant?: 'default' | 'tab' } = {}) {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const username = useAuth((s) => s.user?.username ?? null);
  const logout = useAuth((s) => s.logout);
  const cardCount = useCollectionStore((s) => s.cards.length);
  const isRefreshingPrices = useCollectionStore((s) => s.isRefreshingPrices);
  const refreshPrices = useCollectionStore((s) => s.refreshPrices);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isTab = variant === 'tab';

  async function handleRefreshPrices() {
    if (isRefreshingPrices || cardCount === 0) return;
    setOpen(false);
    try {
      await refreshPrices();
      toast.show({ message: 'Prices refreshed.', tone: 'success' });
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Could not refresh prices.',
        tone: 'error',
      });
    }
  }

  async function handleLogout() {
    setOpen(false);
    await logout();
  }

  return (
    <div className={`settings-menu${isTab ? ' settings-menu--tab' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={
          isTab ? 'mobile-tab-bar-link settings-menu-tab-trigger' : 'settings-menu-trigger'
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Settings"
        onClick={() => setOpen((v) => !v)}
      >
        {isTab ? (
          <>
            <span className="mobile-tab-bar-glyph">
              <GearIcon />
            </span>
            <span className="mobile-tab-bar-label">Settings</span>
          </>
        ) : (
          <>
            <GearIcon />
            <span className="settings-menu-trigger-label">Settings</span>
          </>
        )}
      </button>
      {open && (
        <div className="settings-menu-panel" role="menu" aria-label="Settings">
          <div className="settings-menu-section settings-menu-account">
            {username ? (
              <>
                <span className="settings-menu-account-label">Signed in as</span>
                <span className="settings-menu-account-name" title={username}>
                  {username}
                </span>
              </>
            ) : (
              <span className="settings-menu-account-label">Not signed in</span>
            )}
          </div>

          <div className="settings-menu-section">
            <div className="settings-menu-heading">Theme</div>
            <ul className="settings-menu-themes" role="listbox" aria-label="Choose theme">
              {THEMES.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={t.id === theme}
                    className={`settings-menu-theme${t.id === theme ? ' is-active' : ''}`}
                    onClick={() => setTheme(t.id)}
                  >
                    <Swatch colors={t.swatch} />
                    <span className="settings-menu-theme-name">{t.name}</span>
                    <span className="settings-menu-theme-guild">{t.guild}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="settings-menu-section">
            <button
              type="button"
              role="menuitem"
              className="settings-menu-action"
              onClick={() => void handleRefreshPrices()}
              disabled={cardCount === 0 || isRefreshingPrices}
            >
              {isRefreshingPrices ? 'Refreshing prices…' : 'Refresh all card prices'}
            </button>
            {username ? (
              <button
                type="button"
                role="menuitem"
                className="settings-menu-action settings-menu-action--danger"
                onClick={() => void handleLogout()}
              >
                Sign out
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Swatch({ colors }: { colors: [string, string] }) {
  return (
    <span
      className="theme-swatch"
      aria-hidden="true"
      style={{ background: `linear-gradient(135deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)` }}
    />
  );
}

function GearIcon() {
  return (
    <svg
      className="mobile-tab-bar-icon"
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}
