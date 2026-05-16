import type { CommanderProfile } from '@/deck-builder/services/deckBuilder/commanderProfile';

interface CommanderProfileCardProps {
  profile: CommanderProfile;
  /**
   * Where the theme picker lives relative to this card. 'below' = same
   * page (one-shot builder); 'next-step' = the guided wizard's next step.
   */
  themesLocation?: 'below' | 'next-step';
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

  return (
    <section className="deck-builder-section cmdr-profile">
      <h2 className="deck-builder-section-title">Game plan</h2>
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
    </section>
  );
}
