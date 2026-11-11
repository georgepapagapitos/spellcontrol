import '@/styles/deck-builder-commander.css';
import { InfoTip } from '@/components/overlays/InfoTip';
import { Button } from '@/components/shared/Button';
import { Chip } from '@/components/shared/Chip';
import { ManaCost } from '@/components/shared/ManaCost';
import { RulesTextParagraphs } from '@/components/card/RulesText';
import type { ScryfallCard } from '@/deck-builder/types';
import { classifyCommanderPlaystyles } from '@/lib/deck/commander-playstyle-index';
import type { ReadinessScore } from '@/lib/deck/commander-readiness';
import { CommanderPickArt } from './CommanderPickArt';
import { CommanderReadiness } from './CommanderReadiness';

interface Props {
  value: ScryfallCard;
  /** Whether a staples score can be read at all (a collection big enough, not PDH). */
  canScore: boolean;
  readiness: ReadinessScore | 'loading' | undefined;
  voltronVetoed: boolean;
  onChange: () => void;
}

/** The chosen commander in the plain finder: art, rules text, how it plays, how much you own. */
export function CommanderPick({ value, canScore, readiness, voltronVetoed, onChange }: Props) {
  // Two-faced commanders keep oracle text on card_faces; fall back to the
  // front face. Both faces belong to the card preview, not here.
  const front = value.card_faces?.[0];
  const manaCost = value.mana_cost ?? front?.mana_cost ?? '';
  const oracleText = value.oracle_text ?? front?.oracle_text ?? '';
  const power = value.power ?? front?.power;
  const toughness = value.toughness ?? front?.toughness;
  const loyalty = value.loyalty;
  const playstyleMatches = classifyCommanderPlaystyles(value, { voltronVetoed }).slice(0, 3);
  return (
    <div className="commander-pick">
      <CommanderPickArt card={value} label="Commander" />
      <div className="commander-pick-body">
        <div className="commander-pick-headline">
          <span className="commander-pick-name">{value.name}</span>
          {manaCost && <ManaCost cost={manaCost} className="commander-pick-mana" />}
          {power && toughness && (
            <span className="commander-pick-stat">
              <span className="commander-pick-stat-value">
                {power}/{toughness}
              </span>
            </span>
          )}
          {loyalty && (
            <span className="commander-pick-stat">
              <span className="commander-pick-stat-label">Loyalty</span>
              <span className="commander-pick-stat-value">{loyalty}</span>
            </span>
          )}
        </div>
        <div className="commander-pick-type">{value.type_line}</div>
        {oracleText && (
          <div className="commander-pick-oracle">
            <RulesTextParagraphs text={oracleText} names={[value.name]} />
          </div>
        )}
        {playstyleMatches.length > 0 && (
          <div className="commander-pick-playstyles">
            <span className="commander-pick-playstyles-label">
              Plays like
              <InfoTip
                label="Plays like"
                text="How this commander tends to win, read from its rules text."
              />
            </span>
            {playstyleMatches.map((m) => (
              <Chip key={m.playstyle.id} className="commander-pick-playstyle-tag" tone="neutral">
                {m.playstyle.label}
              </Chip>
            ))}
          </div>
        )}
        {canScore && (
          <div className="commander-pick-readiness">
            <CommanderReadiness score={readiness === 'loading' ? undefined : readiness} />
          </div>
        )}
      </div>
      <Button onClick={onChange} className="commander-pick-change">
        Change
      </Button>
    </div>
  );
}
