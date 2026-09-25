import '@/styles/horde-table.css';
import { HordeAttackBanner } from '@/components/play/horde/HordeAttackBanner';
import type { SoloHordeState } from '@/playtest/lib/horde-solo';
import { useHordeActions } from './horde-actions';
import './HordeSoloBanner.css';

interface Props {
  horde: SoloHordeState;
}

/**
 * The desktop attack banner, in YOUR half's own banner slot (design point 3)
 * — never floating over the horde's half, unlike the paper table's own
 * screen-centred version. Absent on a phone, where the combat total moves
 * into the band's bar instead.
 */
export function HordeSoloBanner({ horde }: Props) {
  const { take } = useHordeActions();
  if (horde.phase !== 'combat' || !horde.pendingAttack) return null;
  return (
    <div className="horde-solo-banner">
      <HordeAttackBanner
        attackers={horde.pendingAttack.attackers}
        power={horde.pendingAttack.power}
        groups={horde.pendingAttack.groups}
        onTake={take}
      />
    </div>
  );
}
