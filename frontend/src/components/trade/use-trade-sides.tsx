import { useMemo, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { ConfirmDialog } from '@/components/overlays/ConfirmDialog';
import type { CollectionBrowserTradeHooks } from '@/components/share/CollectionBrowser';
import type { BrowserGroup } from '@/components/share/use-collection-browser';
import type { AllocationInfo } from '@/lib/collection/allocations-core';
import { nextGiveCopy } from '@/lib/trade/draft-edits';
import {
  describeOwned,
  giveWarning,
  givePriority,
  type OwnedBrowserModel,
} from '@/lib/trade/owned-to-browser';
import { keyOf } from '@/lib/trade/trade-basket';
import type { OwnedTradeLine } from '@/lib/trade/trade-picker';
import type { WorkspaceDraft } from '@/lib/trade/use-workspace-draft';
import { TradeAddButton } from './TradeAddButton';
import { TradePreviewPanel } from './TradePreviewPanel';

/**
 * What the trade workspace plugs into the collection browser on each side.
 * The browser stays one component for profile, hub and share links; these are
 * the only places it learns it is also a basket.
 */

const ICON = <Plus width={16} height={16} strokeWidth={2} aria-hidden="true" />;

/** Their cards: "+" asks for the card, capped at what they really have. */
export function theirSideHooks(opts: {
  friendName: string;
  draft: WorkspaceDraft;
  myWants?: ReadonlySet<string>;
}): CollectionBrowserTradeHooks {
  const { friendName, draft: wd, myWants } = opts;
  const idOf = (g: BrowserGroup) => g.card.oracleId || null;
  const ask = (g: BrowserGroup) => {
    const oracleId = idOf(g);
    if (oracleId) wd.addGet({ oracleId, name: g.card.name });
  };
  return {
    renderAdd: (g) => {
      const oracleId = idOf(g);
      if (!oracleId) return null;
      return (
        <TradeAddButton
          name={g.card.name}
          count={wd.getQuantity(oracleId)}
          verb="Ask for"
          onAdd={() => ask(g)}
          onRemove={() => wd.removeGet(oracleId)}
        />
      );
    },
    // The ask is per card, not per printing, so every printing of a picked
    // card says the same true thing.
    caption: (g) => {
      const oracleId = idOf(g);
      const n = oracleId ? wd.getQuantity(oracleId) : 0;
      return n > 0 ? `In trade · ${n}` : null;
    },
    flag: (g) => {
      const oracleId = idOf(g);
      return oracleId && myWants?.has(oracleId) ? 'You want' : null;
    },
    pickedCount: (g) => {
      const oracleId = idOf(g);
      return oracleId ? wd.getQuantity(oracleId) : 0;
    },
    preview: {
      getActions: (g) => {
        const oracleId = idOf(g);
        if (!oracleId || wd.getQuantity(oracleId) > 0) return [];
        return [{ key: 'trade-ask', icon: ICON, label: 'Ask for this', onClick: () => ask(g) }];
      },
      renderPanelExtra: (g) => {
        const oracleId = idOf(g);
        if (!oracleId) return null;
        const have = wd.theirCount(oracleId, g.card.name);
        const carriesUse = g.card.spare !== undefined || g.card.inDeck !== undefined;
        const use = g.spare ? 'one to spare' : g.card.inDeck ? 'in a deck' : 'not in a deck';
        const status = `${friendName} has ${have ?? 'some'}${carriesUse ? ` · ${use}` : ''}`;
        return (
          <TradePreviewPanel
            status={status}
            count={wd.getQuantity(oracleId)}
            max={Math.min(20, have ?? 20)}
            ceilingNote={`that's all ${friendName} has`}
            onMore={() => ask(g)}
            onFewer={() => wd.removeGet(oracleId)}
          />
        );
      },
    },
  };
}

/**
 * Your cards. "+" puts the cheapest copy you haven't already added into the
 * trade, and asks first when that copy is in a deck or is your only one: the
 * deck badge used to show only after the decision was made.
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
  const [pending, setPending] = useState<{ line: OwnedTradeLine; warning: string } | null>(null);

  const keyFor = (g: BrowserGroup) =>
    g.card.oracleId ? keyOf(g.card as { oracleId: string; name: string }) : null;
  const infoFor = (g: BrowserGroup) => {
    const key = keyFor(g);
    return key ? model.info.get(key) : undefined;
  };
  const wanted = (g: BrowserGroup) => !!g.card.oracleId && !!friendWants?.has(g.card.oracleId);

  function offer(line: OwnedTradeLine) {
    const info = model.info.get(keyOf(line));
    const copy = nextGiveCopy(wd.draft, line);
    const warning = copy && info ? giveWarning(copy, info, allocations, friendName) : null;
    if (warning) setPending({ line, warning });
    else wd.addGive(line);
  }

  const trade: CollectionBrowserTradeHooks = {
    renderAdd: (g) => {
      const info = infoFor(g);
      const key = keyFor(g);
      if (!info || !key) return null;
      return (
        <TradeAddButton
          name={g.card.name}
          count={wd.giveQuantity(key)}
          verb="Offer"
          onAdd={() => offer(info.line)}
          onRemove={() => wd.removeGive(key)}
        />
      );
    },
    caption: (g) => {
      const info = infoFor(g);
      const key = keyFor(g);
      const n = key ? wd.giveQuantity(key) : 0;
      if (n > 0) return `In trade · ${n}`;
      return info ? describeOwned(info) : null;
    },
    flag: (g) => (wanted(g) ? `${friendName} wants` : null),
    pickedCount: (g) => {
      const key = keyFor(g);
      return key ? wd.giveQuantity(key) : 0;
    },
    preview: {
      getActions: (g) => {
        const info = infoFor(g);
        const key = keyFor(g);
        if (!info || !key || wd.giveQuantity(key) > 0) return [];
        return [
          { key: 'trade-offer', icon: ICON, label: 'Offer this', onClick: () => offer(info.line) },
        ];
      },
      renderPanelExtra: (g) => {
        const info = infoFor(g);
        const key = keyFor(g);
        if (!info || !key) return null;
        return (
          <TradePreviewPanel
            status={`You have ${info.owned} · ${describeOwned(info)}`}
            count={wd.giveQuantity(key)}
            max={info.owned}
            ceilingNote="that's all you have"
            onMore={() => offer(info.line)}
            onFewer={() => wd.removeGive(key)}
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
        wd.addGive(pending.line);
        setPending(null);
      }}
    />
  ) : null;

  return { trade, priority, dialog };
}
