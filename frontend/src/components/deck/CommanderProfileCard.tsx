import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { CommanderProfile } from '@/deck-builder/services/deckBuilder/commanderProfile';
import { ARCHETYPE_LABEL } from '@/deck-builder/services/deckBuilder/strategyVocabulary';
import { useCollapsedPref } from '@/lib/util/use-collapsed-pref';

interface CommanderProfileCardProps {
  profile: CommanderProfile;
  /**
   * A disclosure inside generator step 1 (E1113): no section chrome, a `title` of its own
   * ("What Giada wants"), and closed every time rather than remembering the last choice.
   */
  title?: string;
}

/**
 * "What does your commander want?" — surfaces the parsed ability keywords
 * and game plan so the player understands the synergies before building,
 * the same line-by-line breakdown the guided process teaches.
 */
export function CommanderProfileCard({ profile, title }: CommanderProfileCardProps) {
  const { abilities, summary, primaryArchetype, voltronVetoed } = profile;

  // Default to expanded — the commander breakdown is a discovery feature.
  const [savedCollapsed, setSavedCollapsed] = useCollapsedPref(
    'spellcontrol-game-plan-collapsed',
    false
  );
  const [stepCollapsed, setStepCollapsed] = useState(true);
  const inStep = title !== undefined;
  const collapsed = inStep ? stepCollapsed : savedCollapsed;
  const setCollapsed = inStep ? setStepCollapsed : setSavedCollapsed;
  const Heading = inStep ? 'h3' : 'h2';

  return (
    <section className={inStep ? 'cmdr-profile is-in-step' : 'deck-builder-section cmdr-profile'}>
      <Heading className="deck-builder-section-title cmdr-profile-heading">
        <button
          type="button"
          className="cmdr-profile-toggle"
          aria-expanded={!collapsed}
          aria-controls="cmdr-profile-body"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand commander breakdown' : 'Collapse commander breakdown'}
        >
          <span>{title ?? 'What your commander wants'}</span>
          <span className="cmdr-profile-chevron" aria-hidden>
            {collapsed ? (
              <ChevronDown width={18} height={18} />
            ) : (
              <ChevronUp width={18} height={18} />
            )}
          </span>
        </button>
      </Heading>

      <div id="cmdr-profile-body" hidden={collapsed} aria-hidden={collapsed}>
        <p className="cmdr-profile-summary">{summary}</p>

        {abilities.length > 0 && (
          <ul className="list-stack list-stack--loose">
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
          Reads as: <strong>{ARCHETYPE_LABEL[primaryArchetype]}</strong>,{' '}
          {voltronVetoed ? 'from card text and EDHREC deck data.' : 'from card text.'}
        </p>
      </div>
    </section>
  );
}
