import { useCallback, useMemo, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { Modal } from '../Modal';
// Reuses AppendDeckDialog's offline / nothing-to-add notes by name.
import './AppendDeckDialog.css';
import { ProgressBar } from '../ProgressBar';
import { importDeckText } from '../../lib/api';
import { useDecksStore, useLocalMutationToken, type Deck } from '../../store/decks';
import { useCollectionStore } from '../../store/collection';
import { useDeckHistoryStore } from '../../store/deck-history';
import { useCollectionByCopyId } from '../../lib/allocations';
import { buildExport } from '../../lib/deck-export';
import {
  parseBulkEditText,
  findPendingNames,
  buildBulkEditPlan,
  buildResyncCardDiff,
  summarizeAllocationImpact,
  type ParsedBulkEdit,
  type BulkEditPlan,
} from '../../lib/deck-bulk-edit';
import { DiffGroup } from './DiffCardRow';
import { formatRelativeTime } from '../../lib/format-time';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { ScryfallCard } from '@/deck-builder/types';
import { useOnline } from './import-deck-shared';
import './BulkEditDeckDialog.css';

interface Props {
  deck: Deck;
  onClose: () => void;
  /**
   * 'edit' (default) is the original text/bulk-edit flow — the textarea
   * opens pre-filled with the current decklist for direct editing.
   * 'resync' (E173) is paste-and-diff: the textarea opens EMPTY, the user
   * pastes an updated export from wherever they keep their list-of-record
   * (Moxfield, Archidekt, anywhere — the parser already auto-detects both
   * layouts, so there's no source picker to get wrong), and the commit
   * stamps `lastSyncedFrom` instead of just `replaceDeck`. Both modes share
   * the exact same parse/resolve/reconcile core below.
   */
  mode?: 'edit' | 'resync';
}

type Step = 'input' | 'resolving' | 'review';

/**
 * Text/bulk-edit view (E168 slice 4, the last one) — edit the whole decklist
 * as "qty name" lines and commit as one replace. The reconciliation
 * (allocatedCopyId preservation) lives in lib/deck-bulk-edit.ts; this dialog
 * is just the parse → resolve-new-names → review → commit flow around it.
 * `mode="resync"` (E173) reuses this same flow for "refresh from an external
 * list" — see the Props doc above.
 *
 * Local-first: `findPendingNames` only asks for names not already anywhere
 * in the deck, so a pure quantity/removal/reorder edit never touches the
 * network. Only genuinely new names go through `importDeckText`.
 */
export function BulkEditDeckDialog({ deck, onClose, mode = 'edit' }: Props) {
  const decks = useDecksStore((s) => s.decks);
  const replaceDeck = useDecksStore((s) => s.replaceDeck);
  const resyncDeck = useDecksStore((s) => s.resyncDeck);
  const recordEdit = useDeckHistoryStore((s) => s.record);
  const collectionCards = useCollectionStore((s) => s.cards);
  const collectionByCopyId = useCollectionByCopyId();
  const online = useOnline();
  const formatConfig = DECK_FORMAT_CONFIGS[deck.format];
  const liveMutationToken = useLocalMutationToken(deck.id);

  // Surfaced, never silently clobbered: has the user edited this deck locally
  // since the last resync? Compares the local-mutation token (E177) snapshotted
  // at that sync against the live one — not `updatedAt`/`syncedAt` timestamps,
  // which race (see the `touch()` doc comment in store/decks.ts).
  const divergedSinceSync =
    mode === 'resync' &&
    !!deck.lastSyncedFrom &&
    liveMutationToken !== deck.lastSyncedFrom.localMutationToken;

  const [text, setText] = useState(() =>
    mode === 'resync'
      ? ''
      : buildExport(
          {
            commander: deck.commander,
            partner: deck.partnerCommander,
            cards: deck.cards,
            sideboard: deck.sideboard,
            considering: deck.considering,
            collectionByCopyId,
            commanderAllocatedCopyId: deck.commanderAllocatedCopyId,
            partnerAllocatedCopyId: deck.partnerCommanderAllocatedCopyId,
          },
          'mtga'
        )
  );
  const [step, setStep] = useState<Step>('input');
  const [emptyError, setEmptyError] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBulkEdit | null>(null);
  const [resolvedByName, setResolvedByName] = useState<Map<string, ScryfallCard>>(new Map());
  const [offlineNames, setOfflineNames] = useState<string[]>([]);
  const [fetchErrorNames, setFetchErrorNames] = useState<string[]>([]);

  const runResolve = useCallback(async () => {
    if (!text.trim()) {
      setEmptyError(true);
      return;
    }
    setEmptyError(false);
    setFetchError(null);
    const p = parseBulkEditText(text);
    setParsed(p);
    const pending = findPendingNames(deck, p);
    if (pending.length === 0) {
      setOfflineNames([]);
      setFetchErrorNames([]);
      setStep('review');
      return;
    }
    if (!online) {
      setOfflineNames(pending);
      setFetchErrorNames([]);
      setStep('review');
      return;
    }
    setOfflineNames([]);
    setStep('resolving');
    try {
      const synthetic = pending.map((n) => `1 ${n}`).join('\n');
      const r = await importDeckText(synthetic);
      const map = new Map<string, ScryfallCard>();
      for (const c of r.cards) map.set(c.name.toLowerCase(), c);
      setResolvedByName(map);
      setFetchErrorNames(r.fetchErrors);
      setStep('review');
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : 'Could not resolve new cards. Check your connection.'
      );
      setStep('input');
    }
  }, [text, deck, online]);

  const plan: BulkEditPlan | null = useMemo(() => {
    if (!parsed || step !== 'review') return null;
    return buildBulkEditPlan(deck, parsed, resolvedByName, formatConfig, {
      decks,
      collectionCards,
    });
  }, [parsed, step, deck, resolvedByName, formatConfig, decks, collectionCards]);

  // Genuinely-unmatched names: unresolved minus the ones we know are just a
  // retryable network hiccup (those get their own banner + Retry button).
  const unresolvedGenuine = useMemo(() => {
    if (!plan) return [];
    const retryable = new Set(fetchErrorNames.map((n) => n.toLowerCase()));
    return plan.unresolvedNames.filter((n) => !retryable.has(n.toLowerCase()));
  }, [plan, fetchErrorNames]);

  // Resync-only richer diff: every zone, added/removed/changed with real
  // before→after quantities — renders through the same shared DiffGroup/
  // DiffCardRow as /decks/compare rather than re-deriving diff markup.
  const cardDiff = useMemo(() => {
    if (mode !== 'resync' || !plan) return null;
    return buildResyncCardDiff(deck, plan);
  }, [mode, plan, deck]);

  const allocationImpact = useMemo(() => {
    if (mode !== 'resync' || !plan) return null;
    return summarizeAllocationImpact(deck, plan);
  }, [mode, plan, deck]);

  const handleConfirm = useCallback(() => {
    if (!plan || plan.commanderMissing || !plan.hasChanges) return;
    const changeCount =
      plan.added.reduce((s, e) => s + e.qty, 0) + plan.removed.reduce((s, e) => s + e.qty, 0);
    const label = `${mode === 'resync' ? 'resync' : 'bulk edit'}${changeCount > 0 ? ` (${changeCount} card${changeCount === 1 ? '' : 's'})` : ''}`;
    const fields = {
      cards: plan.cards,
      sideboard: plan.sideboard,
      considering: plan.considering,
      commander: plan.commander,
      partnerCommander: plan.partnerCommander,
      commanderAllocatedCopyId: plan.commanderAllocatedCopyId,
      partnerCommanderAllocatedCopyId: plan.partnerCommanderAllocatedCopyId,
    };
    recordEdit(deck.id, label, () => {
      if (mode === 'resync') resyncDeck(deck.id, fields);
      else replaceDeck(deck.id, { ...deck, ...fields });
    });
    onClose();
  }, [plan, deck, mode, recordEdit, replaceDeck, resyncDeck, onClose]);

  const isLoading = step === 'resolving';

  return (
    <Modal
      onClose={onClose}
      labelledBy="bulk-edit-deck-title"
      className="modal bulk-edit-deck-modal"
      dismissable={!isLoading}
    >
      <div className="modal-header">
        <h2 id="bulk-edit-deck-title">
          {mode === 'resync' ? `Resync ${deck.name}` : `Bulk edit ${deck.name}`}
        </h2>
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close"
          disabled={isLoading}
        >
          ×
        </button>
      </div>

      <div className="modal-body">
        {step === 'input' && (
          <>
            <p className="import-deck-hint">
              {mode === 'resync' ? (
                <>
                  Paste the updated list from wherever you keep it — Moxfield, Archidekt, anywhere.
                  We'll diff it against this deck and show exactly what changed before you save.
                  Cards you keep unchanged stay bound to the same physical copy.
                </>
              ) : (
                <>
                  Edit the whole decklist as <strong>qty name</strong> lines, one per row. Cards you
                  keep unchanged stay bound to the same physical copy — only genuine additions and
                  removals touch your collection's allocations.
                </>
              )}
            </p>
            {mode === 'resync' && deck.lastSyncedFrom && (
              <p className="bulk-edit-last-synced">
                Last synced {formatRelativeTime(deck.lastSyncedFrom.syncedAt, { verbose: true })}.
              </p>
            )}
            {divergedSinceSync && (
              <div className="import-deck-warning" role="alert">
                <div className="import-deck-warning-title">Edited since the last sync</div>
                You've changed this deck locally since it was last synced. If the pasted list
                doesn't include those changes, they'll show up as removed below — check the diff
                before saving so a stale paste doesn't overwrite them.
              </div>
            )}
            {fetchError && (
              <div className="error-banner">
                <span>{fetchError}</span>
                <button
                  className="banner-dismiss"
                  onClick={() => setFetchError(null)}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            )}
            {emptyError && (
              <div className="error-banner" role="alert">
                <span>
                  Nothing to save — the list is empty. Add at least a commander or one card, or
                  close this dialog to leave the deck unchanged.
                </span>
                <button
                  className="banner-dismiss"
                  onClick={() => setEmptyError(false)}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            )}
            <textarea
              className="paste-textarea bulk-edit-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={isLoading}
              autoFocus
              spellCheck={false}
            />
          </>
        )}

        {step === 'resolving' && (
          <div className="import-deck-loading">
            <ProgressBar indeterminate message="Resolving new cards…" />
          </div>
        )}

        {step === 'review' && plan && (
          <>
            {plan.commanderMissing && (
              <div className="import-deck-warning" role="alert">
                <div className="import-deck-warning-title">Commander is missing</div>
                This format requires a commander, and the Commander section is now empty (or the
                name didn't resolve). Go back and restore it before saving.
              </div>
            )}

            {offlineNames.length > 0 && (
              <p className="append-deck-offline" role="status">
                <WifiOff width={14} height={14} strokeWidth={2} aria-hidden />
                You're offline — {offlineNames.length} new card
                {offlineNames.length === 1 ? '' : 's'} couldn't be resolved and will be skipped.
                Everything else in this edit still applies.
              </p>
            )}

            {fetchErrorNames.length > 0 && (
              <div className="import-deck-warning">
                <div className="import-deck-warning-title">
                  {fetchErrorNames.length} card{fetchErrorNames.length === 1 ? '' : 's'} couldn't be
                  fetched — the card service was unreachable. They'll be skipped:
                </div>
                <ul className="import-deck-unresolved-list">
                  {fetchErrorNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
                <button type="button" className="btn-link" onClick={() => void runResolve()}>
                  Retry
                </button>
              </div>
            )}

            {unresolvedGenuine.length > 0 && (
              <div className="import-deck-warning">
                <div className="import-deck-warning-title">
                  {unresolvedGenuine.length} card{unresolvedGenuine.length === 1 ? '' : 's'}{' '}
                  couldn't be matched and will be skipped:
                </div>
                <ul className="import-deck-unresolved-list">
                  {unresolvedGenuine.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            )}

            {plan.malformedLines.length > 0 && (
              <div className="import-deck-warning">
                <div className="import-deck-warning-title">
                  {plan.malformedLines.length} line{plan.malformedLines.length === 1 ? '' : 's'}{' '}
                  couldn't be read and will be ignored:
                </div>
                <ul className="import-deck-unresolved-list">
                  {plan.malformedLines.map((line, i) => (
                    <li key={`${line}-${i}`}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            {plan.legalityIssues.length > 0 && (
              <div className="import-deck-warning">
                <div className="import-deck-warning-title">
                  This edit leaves {plan.legalityIssues.length} card
                  {plan.legalityIssues.length === 1 ? '' : 's'} illegal in {formatConfig.label}:
                </div>
                <ul className="import-deck-unresolved-list">
                  {plan.legalityIssues.map((issue) => (
                    <li key={`${issue.slotId}-${issue.issue}`}>
                      {issue.cardName} — {issue.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {mode === 'resync' && cardDiff ? (
              <>
                <DiffGroup tone="added" deltas={cardDiff.added} />
                <DiffGroup tone="removed" deltas={cardDiff.removed} />
                <DiffGroup tone="changed" deltas={cardDiff.changed} />
                {allocationImpact && (allocationImpact.kept > 0 || allocationImpact.added > 0) && (
                  <p className="bulk-edit-allocation-impact" role="status">
                    {allocationImpact.kept > 0 &&
                      (allocationImpact.kept === 1
                        ? '1 card keeps its allocated copy. '
                        : `${allocationImpact.kept} cards keep their allocated copy. `)}
                    {allocationImpact.added > 0 &&
                      `${allocationImpact.added} newly added${
                        allocationImpact.addedUnallocated > 0
                          ? ` (${allocationImpact.addedUnallocated} not yet in your collection)`
                          : ''
                      }.`}
                  </p>
                )}
              </>
            ) : (
              (plan.added.length > 0 || plan.removed.length > 0) && (
                <div className="bulk-edit-diff">
                  {plan.added.length > 0 && (
                    <ul className="bulk-edit-diff-list bulk-edit-diff-added">
                      {plan.added.map((e) => (
                        <li key={`add-${e.name}`}>
                          <span aria-hidden>+</span> {e.qty > 1 ? `${e.qty}× ` : ''}
                          {e.name}
                        </li>
                      ))}
                    </ul>
                  )}
                  {plan.removed.length > 0 && (
                    <ul className="bulk-edit-diff-list bulk-edit-diff-removed">
                      {plan.removed.map((e) => (
                        <li key={`rm-${e.name}`}>
                          <span aria-hidden>−</span> {e.qty > 1 ? `${e.qty}× ` : ''}
                          {e.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            )}

            {!plan.hasChanges && !plan.commanderMissing && (
              <p className="append-deck-nothing-to-add" role="status">
                No changes to save.
              </p>
            )}
          </>
        )}
      </div>

      {step === 'input' && (
        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={() => void runResolve()}>
            Review changes
          </button>
        </div>
      )}

      {step === 'review' && plan && (
        <div className="modal-footer">
          <button type="button" className="btn" onClick={() => setStep('input')}>
            Back
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={plan.commanderMissing || !plan.hasChanges}
          >
            Save changes
          </button>
        </div>
      )}
    </Modal>
  );
}
