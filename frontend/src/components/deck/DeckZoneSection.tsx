import type { RoleKey } from '@/lib/deck-analysis/role-badges';
import type { DeckZone } from '../../store/decks';
import type { DeckBodyCtx } from './DeckBody';
import { CategorySection } from './DeckMainboardRow';
import { PartnerHeaderButton } from './deck-display-icons';
import type { Row, TypedGroup } from './deck-display-rows';

import { bindQtyToZone } from './deck-display-derive';
import type { DeckDisplayProps } from './deck-display-types';

/** Same zone-binding shape for reorder (E172); the section hands the sortIndex already resolved. */
const bindReorderToZone = (onReorder: DeckDisplayProps['onReorder'], zone: DeckZone) =>
  onReorder
    ? (slotIds: string[], sortIndex: number) => onReorder(zone, slotIds, sortIndex)
    : undefined;

/** The state both kinds of section share, on top of what the body renders with. */
export interface ZoneSectionCtx extends DeckBodyCtx {
  deckTags: string[];
  selectMode: boolean;
  isRowSelected: (zone: DeckZone, row: Row) => boolean;
  toggleRowSelected: (zone: DeckZone, row: Row) => void;
  dragEnabled: boolean;
  isSingleton: boolean | undefined;
  hasSideboard: boolean;
  cardProvenance: Record<string, string> | undefined;
}

interface SectionProps {
  group: TypedGroup;
  ctx: ZoneSectionCtx;
  host: DeckDisplayProps;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/** A mainboard section (a type, role or tag group, or the command zone). */
export function MainboardZoneSection({
  group: g,
  ctx,
  host,
  collapsed,
  onToggleCollapsed,
  roleFilter,
}: SectionProps & { roleFilter: RoleKey | null }) {
  return (
    <CategorySection
      deckTags={ctx.deckTags}
      onSetRowTags={
        host.onSetCardTags
          ? (slotIds, tags) => host.onSetCardTags!('cards', slotIds, tags)
          : undefined
      }
      onRowContextMenu={ctx.openCardMenu('cards')}
      menuCtx={(row) => ctx.cardMenuCtx(row, 'cards')}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      title={g.title}
      icon={g.icon}
      rows={g.rows}
      target={g.target}
      currency={ctx.currency}
      showPrefs={ctx.showPrefs}
      onRowClick={ctx.openPreview}
      onRemoveCard={host.onRemoveCard}
      onSetQty={bindQtyToZone(host.onSetQty, 'cards')}
      selectMode={ctx.selectMode}
      isRowSelected={(row) => ctx.isRowSelected('cards', row)}
      onToggleRowSelected={(row) => ctx.toggleRowSelected('cards', row)}
      dragEnabled={ctx.dragEnabled}
      onReorder={bindReorderToZone(host.onReorder, 'cards')}
      isSingleton={ctx.isSingleton}
      onEditCard={host.onEditCard}
      roleFilter={roleFilter}
      legalityBySlot={ctx.legalityBySlot}
      onMoveToSideboard={ctx.hasSideboard ? host.onMoveToSideboard : undefined}
      onMoveToConsidering={host.onMoveToConsidering}
      onMakeCommander={host.onMakeCommander}
      canMakeCommander={host.canMakeCommander}
      onMakePartner={host.onMakePartner}
      canMakePartner={host.canMakePartner}
      onChangeCommander={host.onChangeCommander}
      onMoveToAnotherDeck={host.onMoveToAnotherDeck}
      onReleaseCopy={host.onReleaseCopy}
      onSetProxy={host.onSetProxy}
      onUseOwnCopy={host.onUseOwnCopy}
      headerAction={
        g.icon === 'commander' && host.onEditPartner ? (
          <PartnerHeaderButton hasPartner={!!host.partnerCommander} onClick={host.onEditPartner} />
        ) : undefined
      }
      synergyByName={ctx.synergyByName}
      cardInclusionMap={host.cardInclusionMap}
      combosByOracle={host.combosByOracle}
      cardProvenance={ctx.cardProvenance}
    />
  );
}

/** The pile a section's icon names. */
const OUTZONE_OF_ICON: Record<string, DeckZone> = {
  sideboard: 'sideboard',
  considering: 'considering',
  extras: 'extras',
};

/**
 * The same section as the deck's own, pointed at its pile's handlers. Roles
 * are not passed: the role lens counts the deck, so it never dims these.
 *
 * In the box holds the box's own cards, not swap or maybe cards: its rows can
 * be removed, re-counted, given or released a copy, and moved out to the
 * sideboard or Considering and back (through the menu, deck-display-actions.tsx),
 * but not moved into the deck, tagged, proxied or seated as commander.
 */
export function OutzoneZoneSection({
  group: g,
  ctx,
  host,
  collapsed,
  onToggleCollapsed,
}: SectionProps) {
  const zone: DeckZone = OUTZONE_OF_ICON[g.icon] ?? 'considering';
  const inSideboard = zone === 'sideboard';
  const inBox = zone === 'extras';
  const removeFromBox = host.onBulkRemove
    ? (slotId: string) => host.onBulkRemove!('extras', [slotId])
    : undefined;
  return (
    <CategorySection
      title={g.title}
      icon={g.icon}
      rows={g.rows}
      empty={g.empty}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      deckTags={ctx.deckTags}
      onSetRowTags={
        host.onSetCardTags && !inBox
          ? (slotIds, tags) => host.onSetCardTags!(zone, slotIds, tags)
          : undefined
      }
      onRowContextMenu={ctx.openCardMenu(zone)}
      menuCtx={(row) => ctx.cardMenuCtx(row, zone)}
      currency={ctx.currency}
      showPrefs={ctx.showPrefs}
      onRowClick={ctx.openPreview}
      onRemoveCard={
        inSideboard
          ? host.onRemoveSideboardCard
          : inBox
            ? removeFromBox
            : host.onRemoveConsideringCard
      }
      onSetQty={bindQtyToZone(host.onSetQty, zone)}
      selectMode={ctx.selectMode}
      isRowSelected={(row) => ctx.isRowSelected(zone, row)}
      onToggleRowSelected={(row) => ctx.toggleRowSelected(zone, row)}
      dragEnabled={ctx.dragEnabled}
      onReorder={bindReorderToZone(host.onReorder, zone)}
      // Considering (E122) and In the box are copy-limit exempt regardless of
      // format singleton rules — never the 1-copy cap `isSingleton ?? true`
      // would otherwise fall back to.
      isSingleton={inSideboard ? ctx.isSingleton : false}
      onEditCard={inSideboard ? host.onEditCard : undefined}
      legalityBySlot={ctx.legalityBySlot}
      onMoveToMainboard={
        inSideboard ? host.onMoveToMainboard : inBox ? undefined : host.onMoveFromConsidering
      }
      onMakeCommander={inSideboard ? host.onMakeCommander : undefined}
      canMakeCommander={host.canMakeCommander}
      onMakePartner={inSideboard ? host.onMakePartner : undefined}
      canMakePartner={host.canMakePartner}
      onMoveToAnotherDeck={inSideboard ? host.onMoveToAnotherDeck : undefined}
      onReleaseCopy={inSideboard || inBox ? host.onReleaseCopy : undefined}
      onSetProxy={inSideboard ? host.onSetProxy : undefined}
      onUseOwnCopy={inSideboard || inBox ? host.onUseOwnCopy : undefined}
      synergyByName={ctx.synergyByName}
      cardInclusionMap={host.cardInclusionMap}
      combosByOracle={host.combosByOracle}
      cardProvenance={ctx.cardProvenance}
    />
  );
}
