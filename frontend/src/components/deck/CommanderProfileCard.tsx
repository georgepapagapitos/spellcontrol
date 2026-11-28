import { ChevronDown, ChevronUp } from 'lucide-react';
import type { CommanderProfile } from '@/deck-builder/services/deckBuilder/commanderProfile';
import { ARCHETYPE_LABEL } from '@/deck-builder/services/deckBuilder/strategyVocabulary';
import { useCollapsedPref } from '@/lib/util/use-collapsed-pref';

const STEP_COLLAPSED_KEY = 'spellcontrol-generator-plan-collapsed';

interface CommanderProfileCardProps {
  profile: CommanderProfile;
  /**
   * A disclosure inside generator step 1 (E1113): no section chrome, a `title` of its own
   * ("What Giada wants"). It starts closed, because the summary row above already shows the
   * rules text this breakdown quotes; closed, it names its read ("Tokens"), and it remembers
   * the player's last open or closed choice under its own key.
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

  // The stand-alone card defaults to expanded (a discovery feature); the step disclosure
  // defaults to closed. Each remembers its own choice.
  const inStep = title !== undefined;
  const [collapsed, setCollapsed] = useCollapsedPref(
    inStep ? STEP_COLLAPSED_KEY : 'spellcontrol-game-plan-collapsed',
    inStep
  );
  const Heading = inStep ? 'h3' : 'h2';
  const reads = ARCHETYPE_LABEL[primaryArchetype];

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
          {inStep && collapsed && <span className="cmdr-profile-toggle-summary">{reads}</span>}
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
          Reads as: <strong>{reads}</strong>,{' '}
          {voltronVetoed ? 'from card text and EDHREC deck data.' : 'from card text.'}
        </p>
      </div>
    </section>
  );
}
