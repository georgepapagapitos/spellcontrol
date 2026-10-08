import { useMemo, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { ConfirmDialog } from '@/components/overlays/ConfirmDialog';
import type { CollectionBrowserTradeHooks } from '@/components/share/CollectionBrowser';
import type { BrowserGroup } from '@/components/share/use-collection-browser';
import type { AllocationInfo } from '@/lib/collection/allocations-core';
import { nextGiveCopy } from '@/lib/trade/draft-edits';
import {
  describeOwnedPrinting,
  giveWarning,
  givePriority,
  printingStats,
  type OwnedBrowserModel,
} from '@/lib/trade/owned-to-browser';
import { getEntryKey, keyOf } from '@/lib/trade/trade-basket';
import type { OwnedTradeLine, PrintingRef } from '@/lib/trade/trade-picker';
import type { WorkspaceDraft } from '@/lib/trade/use-workspace-draft';
import { TradeAddButton } from './TradeAddButton';
import { TradePreviewPanel } from './TradePreviewPanel';

/**
 * What the trade workspace plugs into the collection browser on each side.
 * The browser stays one component for profile, hub and share links; these are
 * the only places it learns it is also a basket.
 */

const ICON = <Plus width={16} height={16} strokeWidth={2} aria-hidden="true" />;

/**
 * Their cards: "+" asks for the PRINTING on the tile, capped at what they
 * really hold of it. Tapping a printing is asking for that printing, so only
 * that tile shows the ring and the count.
 */
export function theirSideHooks(opts: {
  friendName: string;
  draft: WorkspaceDraft;
  myWants?: ReadonlySet<string>;
}): CollectionBrowserTradeHooks {
  const { friendName, draft: wd, myWants } = opts;
  const refOf = (g: BrowserGroup) =>
    g.card.oracleId
      ? {
          oracleId: g.card.oracleId,
          name: g.card.name,
          scryfallId: g.card.scryfallId,
          finish: g.card.finish,
        }
      : null;
  const quantityOf = (g: BrowserGroup) => {
    const ref = refOf(g);
    return ref ? wd.getQuantity(ref) : 0;
  };
  return {
    renderAdd: (g) => {
      const ref = refOf(g);
      if (!ref) return null;
      return (
        <TradeAddButton
          name={g.card.name}
          count={wd.getQuantity(ref)}
          verb="Ask for"
          onAdd={() => wd.addGet(ref)}
          onRemove={() => wd.removeGet(getEntryKey(ref))}
        />
      );
    },
    caption: (g) => {
      const n = quantityOf(g);
      return n > 0 ? `In trade · ${n}` : null;
    },
    flag: (g) => {
      const oracleId = g.card.oracleId;
      return oracleId && myWants?.has(oracleId) ? 'You want' : null;
    },
    pickedCount: quantityOf,
    preview: {
      getActions: (g) => {
        const ref = refOf(g);
        if (!ref || wd.getQuantity(ref) > 0) return [];
        return [
          { key: 'trade-ask', icon: ICON, label: 'Ask for this', onClick: () => wd.addGet(ref) },
        ];
      },
      renderPanelExtra: (g) => {
        const ref = refOf(g);
        if (!ref) return null;
        const have = wd.theirPrintingCount(ref);
        const carriesUse = g.card.spare !== undefined || g.card.inDeck !== undefined;
        const use = g.spare ? 'one to spare' : g.card.inDeck ? 'in a deck' : 'not in a deck';
        const status = `${friendName} has ${have ?? 'some'}${have === null ? '' : ' of this printing'}${carriesUse ? ` · ${use}` : ''}`;
        return (
          <TradePreviewPanel
            status={status}
            count={wd.getQuantity(ref)}
            max={Math.min(20, have ?? 20)}
            ceilingNote={`that's all ${friendName} has of this printing`}
            onMore={() => wd.addGet(ref)}
            onFewer={() => wd.removeGet(getEntryKey(ref))}
          />
        );
      },
    },
  };
}

/**
 * Your cards. "+" on a tile puts a copy OF THAT PRINTING into the trade: one no
 * deck or cube holds if any is left, the cheapest of those. Only when every
 * free copy of the printing is already in does it take a deck's, and it asks
 * first (as it does for the only copy you own).
 */
export function useYourSide(opts: {
  friendName: string;
  draft: WorkspaceDraft;
  model: OwnedBrowserModel;
  allocations: ReadonlyMap<string, AllocationInfo>;
  /** Oracle ids and lowercased names the friend wants. */
  friendWants: ReadonlySet<string> | undefined;
}): {
  trade: CollectionBrowserTradeHooks;
  priority: { label: string; rank: (g: BrowserGroup) => number };
  dialog: ReactNode;
} {
  const { friendName, draft: wd, model, allocations, friendWants } = opts;
  const claimed = useMemo(() => new Set(allocations.keys()), [allocations]);
  const [pending, setPending] = useState<{
    line: OwnedTradeLine;
    printing: PrintingRef;
    warning: string;
  } | null>(null);

  const keyFor = (g: BrowserGroup) =>
    g.card.oracleId ? keyOf(g.card as { oracleId: string; name: string }) : null;
  const infoFor = (g: BrowserGroup) => {
    const key = keyFor(g);
    return key ? model.info.get(key) : undefined;
  };
  const printingOf = (g: BrowserGroup): PrintingRef => ({
    scryfallId: g.card.scryfallId,
    finish: g.card.finish,
  });
  /** This tile's own copies: its caption, count and "-" are about these. */
  const statsFor = (g: BrowserGroup) => {
    const info = infoFor(g);
    return info ? printingStats(info, printingOf(g), allocations) : undefined;
  };
  const wanted = (g: BrowserGroup) => !!g.card.oracleId && !!friendWants?.has(g.card.oracleId);

  function offer(line: OwnedTradeLine, printing: PrintingRef) {
    const info = model.info.get(keyOf(line));
    const copy = nextGiveCopy(wd.draft, line, { claimed, printing });
    const warning = copy && info ? giveWarning(copy, info, allocations, friendName) : null;
    if (warning) setPending({ line, printing, warning });
    else wd.addGive(line, { claimed, printing });
  }

  const quantityOf = (g: BrowserGroup) => {
    const key = keyFor(g);
    const stats = statsFor(g);
    return key && stats ? wd.giveQuantity(key, stats.copyIds) : 0;
  };

  const trade: CollectionBrowserTradeHooks = {
    renderAdd: (g) => {
      const info = infoFor(g);
      const key = keyFor(g);
      const stats = statsFor(g);
      if (!info || !key || !stats) return null;
      return (
        <TradeAddButton
          name={g.card.name}
          count={wd.giveQuantity(key, stats.copyIds)}
          verb="Offer"
          onAdd={() => offer(info.line, printingOf(g))}
          onRemove={() => wd.removeGive(key, stats.copyIds)}
        />
      );
    },
    caption: (g) => {
      const info = infoFor(g);
      const stats = statsFor(g);
      const n = quantityOf(g);
      if (n > 0) return `In trade · ${n}`;
      return info && stats ? describeOwnedPrinting(info, stats) : null;
    },
    flag: (g) => (wanted(g) ? `${friendName} wants` : null),
    pickedCount: quantityOf,
    preview: {
      getActions: (g) => {
        const info = infoFor(g);
        if (!info || quantityOf(g) > 0) return [];
        return [
          {
            key: 'trade-offer',
            icon: ICON,
            label: 'Offer this',
            onClick: () => offer(info.line, printingOf(g)),
          },
        ];
      },
      renderPanelExtra: (g) => {
        const info = infoFor(g);
        const key = keyFor(g);
        const stats = statsFor(g);
        if (!info || !key || !stats) return null;
        return (
          <TradePreviewPanel
            status={`You have ${stats.owned} of this printing · ${describeOwnedPrinting(info, stats)}`}
            count={wd.giveQuantity(key, stats.copyIds)}
            max={stats.owned}
            ceilingNote="that's all you have of this printing"
            onMore={() => offer(info.line, printingOf(g))}
            onFewer={() => wd.removeGive(key, stats.copyIds)}
          />
        );
      },
    },
  };

  const priority = useMemo(
    () => ({
      label: `${friendName} wants first`,
      rank: (g: BrowserGroup) =>
        givePriority(!!g.card.oracleId && !!friendWants?.has(g.card.oracleId), g.spare),
    }),
    [friendName, friendWants]
  );

  const dialog = pending ? (
    <ConfirmDialog
      title={`Offer ${pending.line.name}?`}
      body={pending.warning}
      confirmLabel="Offer it anyway"
      // Raised from a card preview as often as from the grid, and the preview
      // sits above the ordinary modal tier.
      backdropClassName="modal-backdrop--over-sheet"
      onCancel={() => setPending(null)}
      onConfirm={() => {
        wd.addGive(pending.line, { claimed, printing: pending.printing });
        setPending(null);
      }}
    />
  ) : null;

  return { trade, priority, dialog };
}
