import { MoreVertical } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '@/components/shared/Button';
import { useMenuKeyboard } from '@/lib/overlays/use-menu-keyboard';
import { computePopoverPlacement, getSafeViewport } from '@/lib/overlays/popover-placement';

export function DeckEditorOverflowMenu({
  onDuplicate,
  onDelete,
  onImport,
  onBulkEdit,
  onResync,
  onFeedback,
  onPrimer,
  onBuildReport,
  onRegenerate,
  onPlaytest,
  onTokens,
  onPullList,
  onCheapestPrintings,
  onMatchCopies,
  onPrintProxies,
  onUndo,
  onRedo,
  undoLabel,
  redoLabel,
}: {
  onDuplicate: () => void;
  onDelete: () => void;
  /** Opens the paste-into-this-deck dialog (E168 slice 2): kebab-only at
   *  every breakpoint, no separate toolbar button. Export is the deck
   *  toolbar's (its ⋯ on a wide row, its kebab on a phone). */
  onImport: () => void;
  /** Opens the text/bulk-edit dialog (E168 slice 4) — same kebab-only,
   *  every-breakpoint placement as onImport. */
  onBulkEdit: () => void;
  /** Opens the same dialog in resync mode (E173) — paste-and-diff against an
   *  external list-of-record (Moxfield, Archidekt, …), kebab-only like
   *  onBulkEdit/onImport. */
  onResync: () => void;
  /** Opens the Feedback Tool sheet (mint link + review responses). */
  onFeedback: () => void;
  /** Opens the primer (strategy notes) editor sheet. */
  onPrimer: () => void;
  /** Reopens the one-shot generation Build Report (B6-06). Present only when
   *  the deck has one — a hand-built deck never got one to reopen. */
  onBuildReport?: () => void;
  /** Rebuild with this deck's own settings, landing on the compare diff.
   *  Present only on a generated deck, the one kind with settings to replay;
   *  it used to live only in the decks index's tile menu. */
  onRegenerate?: () => void;
  onPlaytest?: () => void;
  /** Present only when the deck makes tokens. */
  onTokens?: () => void;
  /** Present only when the deck has cards to pull. */
  onPullList?: () => void;
  /** Present only when the deck has a missing card (no owned copy bound). */
  onCheapestPrintings?: () => void;
  /** Present only when an owned slot's printing differs from its copy's. */
  onMatchCopies?: () => void;
  /** Opens the printable proxy sheet. Present only when the deck has cards. */
  onPrintProxies?: () => void;
  /** Present only when there's an edit to undo; carries the action label. */
  onUndo?: () => void;
  /** Present only when there's an edit to redo; carries the action label. */
  onRedo?: () => void;
  undoLabel?: string | null;
  redoLabel?: string | null;
}) {
  // Portal + fixed-position placement (B6-02): the panel used to be
  // `position: absolute; right: 0` inside a wrapper no wider than the 44px
  // kebab button, so a right-aligned panel wider than that wrapper computed a
  // negative `left` and clipped off the left edge of the viewport at 360px.
  // Portaling to <body> and computing coordinates from the trigger's real
  // screen position (same primitives as OverflowMenu/SelectMenu/ToolbarPopover)
  // clamps it into the safe viewport regardless of the wrapper's own width.
  // useMenuKeyboard also replaces the hand-rolled mousedown/Escape listeners
  // with real menu semantics (B6-13): arrow-key nav, Home/End, Escape/Tab
  // return focus to the trigger, pointerdown (not mousedown) dismiss.
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { closeAndReturnFocus } = useMenuKeyboard({
    open,
    onClose: () => setOpen(false),
    panelRef,
    triggerRef: buttonRef,
  });

  useLayoutEffect(() => {
    if (!open || !panelRef.current || !buttonRef.current) return;
    const anchorRect = buttonRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const placement = computePopoverPlacement(
      anchorRect,
      { width: panelRect.width, height: panelRect.height },
      getSafeViewport(),
      'right',
      4
    );
    setPanelPos({
      top: placement.top,
      bottom: placement.bottom,
      left: placement.left,
      right: placement.right,
    });
  }, [open]);

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setPanelPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((v) => !v);
  };

  // Sectioned groups (E181): a flat 12-13 row list read as an undifferentiated
  // wall. Undo/Redo stay unlabelled at top (existing convention) and Delete
  // stays last (STYLE_GUIDE UX-316 — destructive actions live in this menu);
  // everything else buckets into labelled clusters. Each row is `{ key, label,
  // onClick }` so a whole section can be built + filtered in one line instead
  // of ~10 near-identical <button> blocks.
  type Row = { key: string; label: string; onClick: () => void };
  const quickActions: Row[] = [
    onPlaytest && { key: 'playtest', label: 'Playtest', onClick: onPlaytest },
    onTokens && { key: 'tokens', label: 'Tokens to prep', onClick: onTokens },
    onPullList && { key: 'pull-list', label: 'Pull list', onClick: onPullList },
    onPrintProxies && { key: 'proxies', label: 'Print proxies', onClick: onPrintProxies },
  ].filter((r): r is Row => !!r);
  const textTools: Row[] = [
    { key: 'paste', label: 'Paste cards', onClick: onImport },
    { key: 'bulk-edit', label: 'Bulk edit', onClick: onBulkEdit },
    { key: 'resync', label: 'Resync from a list', onClick: onResync },
  ];
  const deckActions: Row[] = [
    { key: 'duplicate', label: 'Duplicate', onClick: onDuplicate },
    { key: 'primer', label: 'Primer', onClick: onPrimer },
    { key: 'feedback', label: 'Get feedback', onClick: onFeedback },
    onBuildReport && { key: 'build-report', label: 'Build report', onClick: onBuildReport },
    onRegenerate && { key: 'regenerate', label: 'Regenerate', onClick: onRegenerate },
    onCheapestPrintings && {
      key: 'cheapest-printings',
      label: 'Cheapest printings for missing',
      onClick: onCheapestPrintings,
    },
    onMatchCopies && { key: 'match-copies', label: 'Match my copies', onClick: onMatchCopies },
  ].filter((r): r is Row => !!r);

  const renderRow = (row: Row) => (
    <button
      key={row.key}
      type="button"
      role="menuitem"
      className="deck-editor-overflow-item"
      onClick={() => {
        closeAndReturnFocus();
        row.onClick();
      }}
    >
      {row.label}
    </button>
  );

  const renderSection = (label: string, rows: Row[]) =>
    rows.length > 0 && (
      <div className="deck-editor-overflow-section" key={label}>
        <div className="deck-editor-overflow-label">{label}</div>
        {rows.map(renderRow)}
      </div>
    );

  return (
    <div className="deck-editor-overflow">
      <IconButton
        className="deck-editor-overflow-btn"
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={handleToggle}
        label="Deck actions"
        icon={<MoreVertical width={20} height={20} strokeWidth={1.8} />}
      />
      {open &&
        panelPos &&
        createPortal(
          <div
            ref={panelRef}
            className="deck-editor-overflow-panel"
            role="menu"
            style={{
              position: 'fixed',
              top: panelPos.top,
              bottom: panelPos.bottom,
              left: panelPos.left,
              right: panelPos.right,
            }}
          >
            {onUndo && (
              <button
                type="button"
                role="menuitem"
                className="deck-editor-overflow-item"
                onClick={() => {
                  closeAndReturnFocus();
                  onUndo();
                }}
              >
                Undo{undoLabel ? ` ${undoLabel}` : ''}
              </button>
            )}
            {onRedo && (
              <button
                type="button"
                role="menuitem"
                className="deck-editor-overflow-item"
                onClick={() => {
                  closeAndReturnFocus();
                  onRedo();
                }}
              >
                Redo{redoLabel ? ` ${redoLabel}` : ''}
              </button>
            )}
            {(onUndo || onRedo) && (
              <div className="deck-editor-overflow-divider" role="separator" aria-hidden />
            )}
            {quickActions.length > 0 && (
              <>
                {renderSection('Quick actions', quickActions)}
                <div className="deck-editor-overflow-divider" role="separator" aria-hidden />
              </>
            )}
            {renderSection('Text tools', textTools)}
            <div className="deck-editor-overflow-divider" role="separator" aria-hidden />
            {renderSection('Deck actions', deckActions)}
            <div className="deck-editor-overflow-divider" role="separator" aria-hidden />
            <button
              type="button"
              role="menuitem"
              className="deck-editor-overflow-item deck-editor-overflow-item--danger"
              onClick={() => {
                closeAndReturnFocus();
                onDelete();
              }}
            >
              Delete
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
