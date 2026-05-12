import { fetchSync, putSync, type SyncSnapshot } from './auth-api';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { saveCollection, clearCollection, type StoredCollection } from './local-cards';
import type { Deck } from '../store/decks';
import type { BinderDef } from '../types';

const PUSH_DEBOUNCE_MS = 1500;

let currentVersion = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushing = false;
let pushPending = false;
let isApplyingRemote = false;
let unsubscribers: Array<() => void> = [];

function buildBindersSnapshot(): BinderDef[] {
  return useCollectionStore.getState().binders;
}

function buildDecksSnapshot(): Deck[] {
  return useDecksStore.getState().decks;
}

function buildCollectionSnapshot(): StoredCollection | null {
  const s = useCollectionStore.getState();
  if (!s.cards.length && !s.fileName && !s.uploadedAt) return null;
  return {
    fileName: s.fileName,
    cards: s.cards,
    scryfallHits: s.scryfallHits,
    scryfallMisses: s.scryfallMisses,
    uploadedAt: s.uploadedAt ?? Date.now(),
    importHistory: s.importHistory,
  };
}

async function pushNow(): Promise<void> {
  if (pushing) {
    pushPending = true;
    return;
  }
  pushing = true;
  try {
    const result = await putSync({
      collection: buildCollectionSnapshot(),
      binders: buildBindersSnapshot(),
      decks: buildDecksSnapshot(),
      baseVersion: currentVersion,
    });
    currentVersion = result.version;
  } catch (err) {
    const e = err as Error & { status?: number; current?: SyncSnapshot };
    if (e.status === 409 && e.current) {
      // Server moved on (another device wrote). Apply server state and retry
      // with our local on top — last-writer-wins, plus a re-pull to stay in sync.
      await applySnapshot(e.current);
      pushPending = true;
    } else {
      console.warn('[sync] push failed:', err);
    }
  } finally {
    pushing = false;
    if (pushPending) {
      pushPending = false;
      schedulePush();
    }
  }
}

function schedulePush(): void {
  if (isApplyingRemote) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushNow();
  }, PUSH_DEBOUNCE_MS);
}

async function applySnapshot(snap: SyncSnapshot): Promise<void> {
  isApplyingRemote = true;
  try {
    currentVersion = snap.version;
    const binders = Array.isArray(snap.binders) ? (snap.binders as BinderDef[]) : [];
    const decks = Array.isArray(snap.decks)
      ? (snap.decks as Deck[]).map((d) => ({
          ...d,
          format: d.format ?? 'commander',
          sideboard: d.sideboard ?? [],
        }))
      : [];
    const collection = (snap.collection as StoredCollection | null) ?? null;

    if (collection) {
      await saveCollection(collection);
    } else {
      await clearCollection();
    }

    useCollectionStore.setState({
      binders,
      cards: collection?.cards ?? [],
      fileName: collection?.fileName ?? '',
      scryfallHits: collection?.scryfallHits ?? 0,
      scryfallMisses: collection?.scryfallMisses ?? 0,
      uploadedAt: collection?.uploadedAt ?? null,
      importHistory: collection?.importHistory ?? [],
      hydrating: false,
    });
    useDecksStore.setState({ decks, hydrated: true });
  } finally {
    isApplyingRemote = false;
  }
}

/**
 * Subscribe to store changes. Any update outside of an in-flight remote-apply
 * triggers a debounced push to the server.
 */
function attachSubscribers(): void {
  detachSubscribers();
  const u1 = useCollectionStore.subscribe((state, prev) => {
    if (state.binders === prev.binders && state.cards === prev.cards) return;
    schedulePush();
  });
  const u2 = useDecksStore.subscribe((state, prev) => {
    if (state.decks === prev.decks) return;
    schedulePush();
  });
  unsubscribers = [u1, u2];
}

function detachSubscribers(): void {
  for (const u of unsubscribers) u();
  unsubscribers = [];
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}

/**
 * Pull the server snapshot and hydrate both stores. Called once after login.
 */
export async function startSync(): Promise<void> {
  const snap = await fetchSync();

  const serverIsEmpty =
    !snap.collection &&
    (!Array.isArray(snap.binders) || snap.binders.length === 0) &&
    (!Array.isArray(snap.decks) || snap.decks.length === 0);

  if (serverIsEmpty) {
    // Server has no data yet (new account or first login after auth was added).
    // Seed the server with whatever the user already has locally rather than
    // wiping their local collection with the empty server state.
    currentVersion = snap.version;
    attachSubscribers();
    schedulePush();
    return;
  }

  await applySnapshot(snap);
  attachSubscribers();
}

/**
 * Stop subscribing and wipe local persistence so a future user starts clean.
 * Called on logout.
 */
export async function stopSyncAndWipeLocal(): Promise<void> {
  detachSubscribers();
  currentVersion = 0;
  await clearCollection();
  // Reset stores first so their persist middleware writes the cleared state to
  // localStorage; only then remove the keys outright. Doing it in the reverse
  // order gives persist a chance to immediately rewrite the keys we just
  // deleted.
  useCollectionStore.setState({
    binders: [],
    cards: [],
    fileName: '',
    scryfallHits: 0,
    scryfallMisses: 0,
    uploadedAt: null,
    importHistory: [],
    hydrating: false,
  });
  useDecksStore.setState({ decks: [], hydrated: true });
  try {
    localStorage.removeItem('spellcontrol');
    localStorage.removeItem('mtg-decks');
  } catch {
    /* ignore */
  }
}

/** Force an immediate push, bypassing the debounce. Used on logout-time flush. */
export async function flushSync(): Promise<void> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await pushNow();
}
