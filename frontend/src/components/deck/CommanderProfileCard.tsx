import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CommanderProfile } from '@/deck-builder/services/deckBuilder/commanderProfile';

interface CommanderProfileCardProps {
  profile: CommanderProfile;
  /**
   * Where the theme picker lives relative to this card. 'below' = same
   * page (one-shot builder); 'next-step' = the guided wizard's next step.
   */
  themesLocation?: 'below' | 'next-step';
}

const COLLAPSED_STORAGE_KEY = 'spellcontrol-game-plan-collapsed';

function readCollapsedPref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsedPref(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * "What does your commander want?" — surfaces the parsed ability keywords
 * and game plan so the player understands the synergies before building,
 * the same line-by-line breakdown the guided process teaches.
 */
export function CommanderProfileCard({
  profile,
  themesLocation = 'below',
}: CommanderProfileCardProps) {
  const { abilities, summary, primaryArchetype } = profile;
  const themesNote =
    themesLocation === 'next-step'
      ? 'Suggested themes are preselected on the next step'
      : 'Suggested themes are preselected below';

  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsedPref());
  useEffect(() => writeCollapsedPref(collapsed), [collapsed]);

  return (
    <section className="deck-builder-section cmdr-profile">
      <h2 className="deck-builder-section-title cmdr-profile-heading">
        <button
          type="button"
          className="cmdr-profile-toggle"
          aria-expanded={!collapsed}
          aria-controls="cmdr-profile-body"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand commander breakdown' : 'Collapse commander breakdown'}
        >
          <span>What your commander wants</span>
          <span className="cmdr-profile-chevron" aria-hidden>
            {collapsed ? (
              <ChevronDown width={18} height={18} />
            ) : (
              <ChevronUp width={18} height={18} />
            )}
          </span>
        </button>
      </h2>

      <div id="cmdr-profile-body" hidden={collapsed} aria-hidden={collapsed}>
        <p className="cmdr-profile-summary">{summary}</p>

        {abilities.length > 0 && (
          <ul className="cmdr-profile-abilities">
            {abilities.map((a) => (
              <li key={a.keyword} className="cmdr-profile-ability">
                <div className="cmdr-profile-ability-head">
                  <span className="cmdr-profile-ability-label">{a.label}</span>
                  <span className="cmdr-profile-ability-evidence">“{a.evidence}”</span>
                </div>
                <ul className="cmdr-profile-wants">
                  {a.wants.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <p className="cmdr-profile-footer">
          Detected archetype: <strong>{primaryArchetype}</strong>
          {profile.suggestedThemes.length > 0 && <> · {themesNote}</>}
        </p>
      </div>
    </section>
  );
}
