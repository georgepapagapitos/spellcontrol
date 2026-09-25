import '@/styles/horde-table.css';
import { HordeAttackBanner } from '@/components/play/horde/HordeAttackBanner';
import { usePlaytestStore } from '@/playtest/store';
import type { SoloHordeState } from '@/playtest/lib/horde-solo';
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
  const resolveHordeAttack = usePlaytestStore((s) => s.resolveHordeAttack);
  if (horde.phase !== 'combat' || !horde.pendingAttack) return null;
  return (
    <div className="horde-solo-banner">
      <HordeAttackBanner
        attackers={horde.pendingAttack.attackers}
        power={horde.pendingAttack.power}
        onTake={resolveHordeAttack}
      />
    </div>
  );
}
