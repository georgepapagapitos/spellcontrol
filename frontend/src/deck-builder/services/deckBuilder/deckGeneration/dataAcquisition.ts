import { logger } from '@/lib/logger';
import { OWNED_POOL_THIN_RATIO } from '@/lib/commander-coverage';
import type {
  EDHRECCard,
  EDHRECCombo,
  EDHRECCommanderData,
  EDHRECCommanderStats,
  DeckDataSource,
  TargetBracket,
  BudgetOption,
  ThemeResult,
  ScryfallCard,
} from '@/deck-builder/types';
import {
  fetchCommanderData,
  fetchCommanderThemeData,
  fetchPartnerCommanderData,
  fetchPartnerThemeData,
  fetchCommanderCombosRaw,
  fetchTagPageData,
  isPoolTooThin,
} from '@/deck-builder/services/edhrec/client';
import { prefetchBasicLands, getGameChangerNames } from '@/deck-builder/services/scryfall/client';
import { loadTaggerData, hasTaggerData } from '@/deck-builder/services/tagger/client';
import { offlineCombosCached, offlineGetCombosByIds } from '@/lib/offline';
import { bracketLabel } from '../bracketEstimator';
import { calculateCardPriority } from '../cardPicking';
import { loadCardSimilar, hasCardSimilar } from '../cardSimilar';
import { buildAlternatePool, type AlternatePoolResult } from '../phaseAlternatePool';
import { blendTagPageIntoPool, resolveArchetypeBlend } from '../archetypeBlend';
import { constrainsToCollection } from '../deckFilters';
import type { GenerationState, GenerationContext } from './state';

// ── Merge cardlists from multiple theme results ──
// Verbatim, relocated from deckGenerator.ts (only caller is fetchMergedThemeData
// below).
function mergeThemeCardlists(themeDataResults: EDHRECCommanderData[]): {
  cardlists: EDHRECCommanderData['cardlists'];
  themeOverlapCounts: Map<string, number>;
} {
  // Track how many themes each card appears in (for hyper focus mode)
  const themeOverlapCounts = new Map<string, number>();

  // Merge all cards, keeping the best version for duplicates
  // Prioritize: highest synergy first, then highest inclusion
  const mergeCards = (cards: EDHRECCard[][]): EDHRECCard[] => {
    const cardMap = new Map<string, EDHRECCard>();

    for (const cardList of cards) {
      // Track which cards we've seen in THIS theme's list to avoid double-counting
      const seenInThisList = new Set<string>();
      for (const card of cardList) {
        if (!seenInThisList.has(card.name)) {
          seenInThisList.add(card.name);
          themeOverlapCounts.set(card.name, (themeOverlapCounts.get(card.name) ?? 0) + 1);
        }

        const existing = cardMap.get(card.name);
        if (!existing) {
          cardMap.set(card.name, card);
        } else {
          // Keep the card with better synergy, or if tied, better inclusion
          const existingSynergy = existing.synergy ?? 0;
          const newSynergy = card.synergy ?? 0;

          if (
            newSynergy > existingSynergy ||
            (newSynergy === existingSynergy && card.inclusion > existing.inclusion)
          ) {
            cardMap.set(card.name, card);
          }
        }
      }
    }

    // Sort by priority (synergy-aware)
    return Array.from(cardMap.values()).sort(
      (a, b) => calculateCardPriority(b) - calculateCardPriority(a)
    );
  };

  const cardlists = {
    creatures: mergeCards(themeDataResults.map((r) => r.cardlists.creatures)),
    instants: mergeCards(themeDataResults.map((r) => r.cardlists.instants)),
    sorceries: mergeCards(themeDataResults.map((r) => r.cardlists.sorceries)),
    artifacts: mergeCards(themeDataResults.map((r) => r.cardlists.artifacts)),
    enchantments: mergeCards(themeDataResults.map((r) => r.cardlists.enchantments)),
    planeswalkers: mergeCards(themeDataResults.map((r) => r.cardlists.planeswalkers)),
    lands: mergeCards(themeDataResults.map((r) => r.cardlists.lands)),
    allNonLand: mergeCards(themeDataResults.map((r) => r.cardlists.allNonLand)),
  };

  return { cardlists, themeOverlapCounts };
}

/**
 * Fetch + merge all selected EDHREC themes for a given bracket (or `undefined`
 * for the bracket-agnostic page). Each theme's fetch failure is swallowed
 * (logged) so one theme's 404/network error doesn't sink the others; returns
 * `null` only when every theme failed. Shared by the normal fetch phase and
 * the E93 thinness fallback ladder below, so both go through one fetch+merge
 * path instead of two hand-rolled copies.
 */
async function fetchMergedThemeData(
  themes: ThemeResult[],
  commanderName: string,
  partnerCommanderName: string | undefined,
  budgetOption: BudgetOption | undefined,
  bracket: TargetBracket | undefined
): Promise<{ data: EDHRECCommanderData; themeOverlapCounts: Map<string, number> } | null> {
  const results = await Promise.all(
    themes.map((theme) =>
      (partnerCommanderName
        ? fetchPartnerThemeData(
            commanderName,
            partnerCommanderName,
            theme.slug!,
            budgetOption,
            bracket
          )
        : fetchCommanderThemeData(commanderName, theme.slug!, budgetOption, bracket)
      ).catch((err) => {
        logger.warn(`[DeckGen] theme fetch failed, skipping "${theme.slug}":`, err);
        return null;
      })
    )
  );
  const ok = results.filter((r): r is EDHRECCommanderData => r != null);
  if (ok.length === 0) return null;
  const merged = mergeThemeCardlists(ok);
  return {
    data: { themes: [], stats: ok[0].stats, cardlists: merged.cardlists, similarCommanders: [] },
    themeOverlapCounts: merged.themeOverlapCounts,
  };
}

/** The EDHREC pool candidates the E93 thinness ladder can land on, from most
 *  to least specific. Mirrors the existing DeckDataSource labels so the
 *  Build Report's "which pool" line needs no new vocabulary. */
export type PoolRung = Extract<DeckDataSource, 'theme+bracket' | 'base+bracket' | 'theme' | 'base'>;

/**
 * Ladder through EDHREC pool candidates from most to least specific (E93),
 * stopping at the first with real signal (isPoolTooThin === false). If every
 * candidate is thin, returns the LAST successfully-fetched rung — the
 * broadest page tried is still the best data available, and it's what the
 * pre-E93 error-only fallback would have landed on anyway. Returns `null`
 * only when every rung's fetch threw (matches pre-E93 total-failure behavior).
 */
/** Why the ladder moved past the originally-requested (first) rung — a
 *  genuine thinness call vs. a fetch that never even resolved to check. See
 *  `buildBracketPoolFallbackNote`'s `cause` param (S1 ladder-cause-honesty). */
export type PoolFallbackCause = 'fetch-failed' | 'thin';

export async function fetchPoolWithFallback(
  rungs: Array<{ source: PoolRung; fetch: () => Promise<EDHRECCommanderData> }>
): Promise<{
  data: EDHRECCommanderData;
  source: PoolRung;
  fellBackFrom?: PoolRung;
  fellBackCause?: PoolFallbackCause;
} | null> {
  let last: { data: EDHRECCommanderData; source: PoolRung } | null = null;
  let firstRungFetchFailed = false;
  for (let i = 0; i < rungs.length; i++) {
    const rung = rungs[i];
    const data = await rung.fetch().catch(() => {
      if (i === 0) firstRungFetchFailed = true;
      return null;
    });
    if (!data) continue;
    last = { data, source: rung.source };
    if (!isPoolTooThin(data)) break;
  }
  if (!last) return null;
  const fellBack = last.source !== rungs[0].source;
  return {
    ...last,
    fellBackFrom: fellBack ? rungs[0].source : undefined,
    fellBackCause: fellBack ? (firstRungFetchFailed ? 'fetch-failed' : 'thin') : undefined,
  };
}

/** Human-readable label for one EDHREC page rung, for the E93 disclosure note. */
function poolRungLabel(
  source: PoolRung,
  bracketPhrase: string,
  themeNames: string | undefined
): string {
  switch (source) {
    case 'theme+bracket':
      return `the ${themeNames} page filtered to ${bracketPhrase}`;
    case 'base+bracket':
      return `the main ${bracketPhrase} page`;
    case 'theme':
      return `the main ${themeNames} page`;
    case 'base':
      return 'the main commander page';
  }
}

/**
 * E93 disclosure text: names what EDHREC page was too thin, what page was
 * used instead, and confirms the target bracket's card permissions (which
 * only ever control curve/salt/game-changer ceilings downstream — never the
 * pool fetch itself) were kept regardless of which page supplied the pool.
 */
export function buildBracketPoolFallbackNote(
  commanderLabel: string,
  targetBracket: TargetBracket,
  fellBackFrom: PoolRung,
  usedSource: PoolRung,
  themeNames: string | undefined,
  cause?: PoolFallbackCause
): string {
  const bracketPhrase = `bracket-${targetBracket} (${bracketLabel(Number(targetBracket))})`;
  const subject = themeNames ? `${commanderLabel} + ${themeNames}` : commanderLabel;
  const missingLabel = poolRungLabel(fellBackFrom, bracketPhrase, themeNames);
  const usedLabel = poolRungLabel(usedSource, bracketPhrase, themeNames);
  // S1 ladder-cause-honesty: undefined (the common "thin" case pre-S1) keeps
  // the exact pre-existing sentence so old snapshots/copy don't drift; only a
  // genuine fetch failure appends the distinction (a thrown fetch never got
  // to prove itself thin — it just never resolved).
  const causeSuffix = cause === 'fetch-failed' ? " (the page couldn't be fetched)" : '';
  return `EDHREC has too little data on ${missingLabel} for ${subject}. Built from ${usedLabel} instead, with ${bracketPhrase} card permissions kept${causeSuffix}.`;
}

/**
 * Calls `fn` once; if it throws, or resolves to a value that fails the
 * optional `isOk` check, tries again exactly once. No backoff — for the
 * per-generation data loads (tagger role data, combos, the substitute index)
 * a single retry is enough to tell "the network blipped" from "it's actually
 * down" without building retry-queue machinery (S1). The second attempt's
 * outcome (success, failure value, or thrown error) is returned/thrown as-is
 * — this only buys one extra try, not resilience against a truly-down host.
 */
export async function retryOnce<T>(fn: () => Promise<T>, isOk?: (value: T) => boolean): Promise<T> {
  try {
    const result = await fn();
    if (!isOk || isOk(result)) return result;
  } catch {
    // fall through to the retry below
  }
  return fn();
}

/** S1 generation-integrity disclosure: tagger role-data still unavailable
 *  after the retry. Role caps/targets/boosts all silently no-op without it —
 *  the #1 cause of a "random-looking" deck out of an RNG-free generator. */
export function buildTaggerIntegrityNote(taggerAvailable: boolean): string | undefined {
  if (taggerAvailable) return undefined;
  return 'Role targets and balance limits went unenforced on this build. Regenerate to retry with full data.';
}

/** S1 generation-integrity disclosure: the EDHREC combo fetch genuinely
 *  failed (not just "this commander happens to have zero combos" — a
 *  common, valid result the note must never fire for) AND the user actually
 *  asked for combo seeding (comboCountSetting > 0) — so combo detection and
 *  the combo boost/floor system were both silently skipped this build. */
export function buildComboIntegrityNote(
  fetchFailed: boolean,
  comboCountSetting: number
): string | undefined {
  if (!fetchFailed || comboCountSetting <= 0) return undefined;
  return 'Combo detection and combo seeding were skipped on this build.';
}

/** S1 generation-integrity disclosure: the EDHREC substitute-ranking index
 *  is unavailable AND this build is collection-constrained (the only path
 *  that actually reaches for it, for shortage-fill ranking) — so replacement
 *  picks fell back to the built-in heuristic instead of the real signal. */
export function buildSubstituteIntegrityNote(
  substituteIndexAvailable: boolean,
  collectionMode: boolean
): string | undefined {
  if (substituteIndexAvailable || !collectionMode) return undefined;
  return 'Replacement picks used a simpler heuristic this time.';
}

// ---- Fast regeneration cache ----
// Caches EDHREC + Scryfall data from the first generation so regenerations
// (ban a card, add a must-include, tweak settings) can skip the fetch phase entirely.
interface GenerationCache {
  edhrecData: EDHRECCommanderData;
  cardMap: Map<string, ScryfallCard>;
  themeOverlapCounts: Map<string, number>;
  combos: EDHRECCombo[];
  gameChangerNames: Set<string>;
  dataSource: DeckDataSource;
  bracketPoolFallbackNote: string | undefined;
  /** S1: combo/substitute integrity notes only (never the tagger note — that's
   *  always recomputed fresh on regeneration, see acquireCommanderDataPhase). */
  integrityNotes: string[];
  representativeStats: EDHRECCommanderStats;
  // Cache keys — ALL must match for a cache hit
  commanderName: string;
  partnerName: string | null;
  themeSlugs: string[];
  targetBracket: TargetBracket | undefined;
  budgetOption: BudgetOption | undefined;
  // Isolates alternative generators so an art/oracle/historical pool can never be
  // served from (or pollute) a plain-EDHREC cache for the same commander.
  modeKey: string;
}

let generationCache: GenerationCache | null = null;

function buildCacheKey(context: GenerationContext) {
  const { commander, partnerCommander, customization } = context;
  const selectedThemesWithSlugs =
    context.selectedThemes?.filter((t) => t.isSelected && t.source === 'edhrec' && t.slug) || [];
  return {
    commanderName: commander.name,
    partnerName: partnerCommander?.name ?? null,
    themeSlugs: selectedThemesWithSlugs.map((t) => t.slug!).sort(),
    targetBracket: (customization.targetBracket !== 'all'
      ? customization.targetBracket
      : undefined) as TargetBracket | undefined,
    budgetOption: (customization.budgetOption !== 'any'
      ? customization.budgetOption
      : undefined) as BudgetOption | undefined,
    modeKey: [
      customization.generationMode ?? 'edhrec',
      customization.artThemeTag ?? '',
      customization.historicalYear ?? '',
      customization.permanentsOnly ? 'perm' : '',
      // Isolates PDH builds — same commander, same mode, different legal pool.
      customization.mtgFormat ?? 'commander',
    ].join('|'),
  };
}

function isCacheValid(context: GenerationContext): boolean {
  if (!generationCache) return false;
  const key = buildCacheKey(context);
  return (
    generationCache.commanderName === key.commanderName &&
    generationCache.partnerName === key.partnerName &&
    generationCache.targetBracket === key.targetBracket &&
    generationCache.budgetOption === key.budgetOption &&
    generationCache.modeKey === key.modeKey &&
    generationCache.themeSlugs.length === key.themeSlugs.length &&
    generationCache.themeSlugs.every((s, i) => s === key.themeSlugs[i])
  );
}

export function clearGenerationCache(): void {
  generationCache = null;
  logger.debug('[DeckGen] Generation cache cleared');
}

/** Expose the cached EDHREC data from the most recent generation (avoids re-fetching). */
export function getGenerationCacheEdhrecData(): EDHRECCommanderData | null {
  return generationCache?.edhrecData ?? null;
}

/** Update the cached Scryfall cardMap once the batch fetch resolves (not used
 *  on the fast/cache-hit path currently, but kept for potential future use).
 *  No-op if this generation never populated the cache (e.g. a cache hit). */
export function setGenerationCacheCardMap(cardMap: Map<string, ScryfallCard>): void {
  if (generationCache) {
    generationCache.cardMap = cardMap;
  }
}

/**
 * Best-effort enrichment: EDHREC's own combo feed hard-codes `bracketTag:
 * null` on every entry (client.ts's fetchCommanderCombosRaw) — EDHREC never
 * exposes Spellbook's per-combo bracket call. But EDHREC's `comboId` IS the
 * Commander Spellbook variant id verbatim, template suffix included (verified
 * live 2026-09-24: EDHREC's "1529-1887" for Vraska + Vorinclex is the exact id
 * Spellbook's own API returns for that pair), so the same tag the deck page
 * reads from the local Spellbook dataset (`lib/offline`) can be looked up by
 * id here too. Without it, the bracket estimator (`deck-metrics`) treats every
 * EDHREC-sourced combo as untagged: an Exhibition/Core loop (e.g. Hullbreaker
 * Horror + Sol Ring) floors a deck that shouldn't floor, and a Ruthless
 * two-card combo reads as a slow Bracket 3 line instead of the automatic
 * Bracket 4 the tag means — so generation and the deck page (which sees the
 * real Spellbook tag) disagree on the same deck.
 *
 * Only a dataset already on the device is used. It is 17 MB gzipped, and a
 * device that has never cached it must not make generation wait for (or share
 * its bandwidth with) that download; the deck page fetches it and re-estimates
 * with the tags anyway.
 *
 * Runs once per generation, right after the EDHREC fetch, so every downstream
 * phase (combo detection, the combo floor, bracket convergence, the build
 * report) reads an already-tagged `state.combos` — nothing else needs to know
 * this lookup happens. Never blocks or fails generation: leaves `bracketTag`
 * null (today's conservative behavior) when the dataset isn't cached or a
 * lookup errors.
 */
async function enrichCombosWithBracketTags(combos: EDHRECCombo[]): Promise<EDHRECCombo[]> {
  if (combos.length === 0) return combos;
  try {
    if (!(await offlineCombosCached())) return combos;
    const rows = await offlineGetCombosByIds(combos.map((c) => c.comboId));
    if (rows.size === 0) return combos;
    return combos.map((c) => {
      const row = rows.get(c.comboId);
      return row ? { ...c, bracketTag: row.bracketTag ?? null } : c;
    });
  } catch (error) {
    logger.warn('[DeckGen] combo bracketTag enrichment skipped —', error);
    return combos;
  }
}

export interface AcquireCommanderDataResult {
  usingCache: boolean;
  integrityNotes: string[];
  cacheableIntegrityNotes: string[];
}

/**
 * ── Phase A (part 1): cache check + prefetch battery ──
 * Verbatim extraction from generateDeckInner. On a cache hit, populates
 * state from the cached generation instead of refetching; otherwise
 * pre-fetches basic lands, the game-changer list, combo data, tagger data,
 * and the substitute index in parallel.
 */
export async function acquireCommanderDataPhase(
  state: GenerationState
): Promise<AcquireCommanderDataResult> {
  const { commander, onProgress, collectionNames } = state.context;
  const usingCache = isCacheValid(state.context);
  // S1 generation-integrity disclosures. `cacheableIntegrityNotes` holds only
  // the combo/substitute notes — the data the fast (cache) path never
  // refetches — so a regeneration from cache carries them forward unchanged.
  // The tagger note is recomputed fresh on every path below (tagger reloads
  // regardless of cache hit) and is deliberately never itself cached.
  const cacheableIntegrityNotes: string[] = [];
  let integrityNotes: string[];

  if (usingCache) {
    logger.debug('[DeckGen] FAST PATH: Reusing cached EDHREC + Scryfall data');
    onProgress?.('Reshuffling…', 5);
    state.gameChangerNames = generationCache!.gameChangerNames;
    state.combos = generationCache!.combos;
    state.edhrecData = generationCache!.edhrecData;
    state.dataSource = generationCache!.dataSource;
    state.bracketPoolFallbackNote = generationCache!.bracketPoolFallbackNote;
    state.themeOverlapCounts = generationCache!.themeOverlapCounts;
    integrityNotes = [...(generationCache!.integrityNotes ?? [])];
    await retryOnce(loadTaggerData, (d) => d !== null);
    onProgress?.('Your library takes shape…', 12);
  } else {
    // FULL PATH: Pre-fetch basic lands, game changer list, combo data, and tagger data in parallel
    onProgress?.('Opening the archives…', 5);
    let combosFetchFailed = false;
    const [, fetchedGCNames, fetchedCombos] = await Promise.all([
      prefetchBasicLands(state.cfg.arenaOnly),
      getGameChangerNames(),
      retryOnce(() => fetchCommanderCombosRaw(commander.name)).catch(() => {
        combosFetchFailed = true;
        return [] as EDHRECCombo[];
      }),
      retryOnce(loadTaggerData, (d) => d !== null),
      retryOnce(loadCardSimilar, (d) => d !== null), // EDHREC substitute index for shortage-fill ranking
    ]);
    state.gameChangerNames = fetchedGCNames;
    state.combos = await enrichCombosWithBracketTags(fetchedCombos);
    onProgress?.('Studying the cards…', 7);
    logger.debug(`[DeckGen] Fetched ${state.combos.length} combos from EDHREC`);
    logger.debug(
      `[DeckGen] Tagger data: ${hasTaggerData() ? 'loaded' : 'unavailable (role detection disabled)'}`
    );
    const comboNote = buildComboIntegrityNote(combosFetchFailed, state.cfg.comboCountSetting);
    if (comboNote) cacheableIntegrityNotes.push(comboNote);
    const substituteNote = buildSubstituteIntegrityNote(hasCardSimilar(), !!collectionNames);
    if (substituteNote) cacheableIntegrityNotes.push(substituteNote);
    integrityNotes = [...cacheableIntegrityNotes];
  }

  const taggerNote = buildTaggerIntegrityNote(hasTaggerData());
  if (taggerNote) integrityNotes.push(taggerNote);

  return { usingCache, integrityNotes, cacheableIntegrityNotes };
}

export interface AcquireCardPoolContext {
  usingCache: boolean;
  /** Effective Scryfall query so far — an alt-pool's relaxed constraint (e.g.
   *  a historical year) gets appended to it. */
  scryfallQuery: string;
}

export interface AcquireCardPoolResult {
  /** Captured from the alternative-pool build so the finished deck can report
   *  how it was made. Null on EDHREC mode / cache hit. */
  altPool: AlternatePoolResult | null;
  scryfallQuery: string;
}

/**
 * ── Phase A (part 2): candidate-pool fetch ladder ──
 * Verbatim extraction from generateDeckInner. Alternative generators
 * synthesize the pool from Scryfall; otherwise EDHREC theme/base pages are
 * fetched (with the E93 thinness ladder falling back to a broader page when
 * a bracket-narrowed page is too thin). No-op (besides re-deriving `mode`)
 * on a cache hit.
 */
export async function acquireCardPoolPhase(
  state: GenerationState,
  ctx: AcquireCardPoolContext
): Promise<AcquireCardPoolResult> {
  const { usingCache } = ctx;
  let scryfallQuery = ctx.scryfallQuery;
  let altPool: AlternatePoolResult | null = null;

  const { commander, partnerCommander, colorIdentity, customization, onProgress } = state.context;
  const mode = customization.generationMode ?? 'edhrec';
  const { budgetOption, targetBracket, selectedThemesWithSlugs } = state.cfg;

  // Alternative generators: synthesize the candidate pool from Scryfall instead
  // of EDHREC. Populates state.edhrecData so the entire pipeline below runs
  // unchanged; selectedThemes are ignored (the UI hides the theme picker here).
  // PDH routes here even in the default mode — EDHREC has nothing for
  // non-legendary uncommon commanders; the pool builder appends
  // f:paupercommander so every query (and the fills below, via
  // effectiveConstraint → scryfallQuery) stays inside the legal pool.
  if (!usingCache && (mode !== 'edhrec' || state.cfg.mtgFormat === 'paupercommander')) {
    altPool = await buildAlternatePool(mode, customization, colorIdentity, onProgress);
    if (altPool.poolSize === 0 && (mode === 'art-theme' || mode === 'historical')) {
      // Rebuild the pool by function, as the note below says. Keeping the
      // empty pool's constraint (an art: tag no card matches) on every later
      // fill made each of them come back empty too: LIVE, a mistyped motif
      // shipped 97 lands and 2 spells under "Built by function instead".
      logger.warn(`[DeckGen] Alternative pool (${mode}) returned no cards — building by function.`);
      const byFunction = await buildAlternatePool(
        'oracle-role',
        { ...customization, permanentsOnly: false },
        colorIdentity,
        onProgress
      );
      altPool = {
        ...byFunction,
        relaxedNote:
          mode === 'art-theme'
            ? 'No cards matched that motif in your colors. Built by function instead.'
            : 'No cards that old in your colors. Built by function instead.',
      };
    } else if (altPool.poolSize === 0) {
      altPool = {
        ...altPool,
        relaxedNote: altPool.relaxedNote ?? 'That pool came up empty. Filled the deck with basics.',
      };
    }
    state.edhrecData = altPool.data;
    state.dataSource = altPool.dataSource;
    // Append the pool's EFFECTIVE constraint (e.g. the relaxed historical year)
    // so the strict printing upgrade + fallback fills match what was fetched.
    if (altPool.effectiveConstraint) {
      scryfallQuery = [scryfallQuery.trim(), altPool.effectiveConstraint].filter(Boolean).join(' ');
    }
  }
  // Try to fetch EDHREC data (works for all formats) — skip on cache hit
  else if (!usingCache && selectedThemesWithSlugs.length > 0) {
    // Fetch theme-specific data for all selected themes
    onProgress?.('Consulting the Oracle…', 8);
    try {
      // Catch each theme fetch individually so one theme's 404/network error
      // doesn't discard the themes that succeeded (F14).
      const themeMergeResult = await fetchMergedThemeData(
        selectedThemesWithSlugs,
        commander.name,
        partnerCommander?.name,
        budgetOption,
        targetBracket
      );

      if (!themeMergeResult) {
        throw new Error(
          "EDHREC didn't return data for any of those themes. Try fewer themes or a different commander."
        );
      }

      let mergedCardlists = themeMergeResult.data.cardlists;
      state.themeOverlapCounts = themeMergeResult.themeOverlapCounts;
      let representativeStats = themeMergeResult.data.stats;
      let dataSource: DeckDataSource = targetBracket ? 'theme+bracket' : 'theme';

      if (targetBracket && isPoolTooThin(themeMergeResult.data)) {
        // E93: a bracket-narrowed theme page can resolve to a statistically
        // thin (or entirely empty) pool while still parsing as valid JSON.
        // Ladder down to a broader page rather than silently generate off
        // noise — but theme outranks bracket-only: the user explicitly
        // picked this theme, so it's the deck's identity, while the target
        // bracket's power semantics (permissions/ceilings below) survive
        // untouched regardless of which page supplied the pool. Dropping the
        // theme first (bracket-only) would silently swap "the theme deck the
        // user asked for" for "a goodstuff deck at the right power level" —
        // the exact failure this fix exists to prevent. So: theme+bracket →
        // theme (no bracket) → bracket-only → plain commander page.
        let noBracketThemeOverlapCounts: Map<string, number> | undefined;
        const outcome = await fetchPoolWithFallback([
          { source: 'theme+bracket', fetch: () => Promise.resolve(themeMergeResult.data) },
          {
            source: 'theme',
            fetch: async () => {
              const noBracket = await fetchMergedThemeData(
                selectedThemesWithSlugs,
                commander.name,
                partnerCommander?.name,
                budgetOption,
                undefined
              );
              if (!noBracket)
                throw new Error(
                  "EDHREC didn't return data for that theme. Try a different theme or bracket."
                );
              // Stash the counts but don't commit to state yet — this rung
              // may still turn out thin and the ladder moves on, in which
              // case these counts would describe a page that isn't the pool.
              noBracketThemeOverlapCounts = noBracket.themeOverlapCounts;
              return noBracket.data;
            },
          },
          {
            source: 'base+bracket',
            fetch: () =>
              partnerCommander
                ? fetchPartnerCommanderData(
                    commander.name,
                    partnerCommander.name,
                    budgetOption,
                    targetBracket
                  )
                : fetchCommanderData(commander.name, budgetOption, targetBracket),
          },
          {
            source: 'base',
            fetch: () =>
              partnerCommander
                ? fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption)
                : fetchCommanderData(commander.name, budgetOption),
          },
        ]);
        if (outcome) {
          mergedCardlists = outcome.data.cardlists;
          representativeStats = outcome.data.stats;
          dataSource = outcome.source;
          // Only commit the theme-only overlap counts if the ladder actually
          // settled on that rung — otherwise leave the theme+bracket counts
          // already assigned above (or whatever an earlier rung set).
          if (outcome.source === 'theme' && noBracketThemeOverlapCounts) {
            state.themeOverlapCounts = noBracketThemeOverlapCounts;
          }
          if (outcome.fellBackFrom) {
            logger.warn(
              `[DeckGen] E93: theme+bracket pool too thin, laddered down to "${outcome.source}"`
            );
            const commanderLabel = partnerCommander
              ? `${commander.name} // ${partnerCommander.name}`
              : commander.name;
            state.bracketPoolFallbackNote = buildBracketPoolFallbackNote(
              commanderLabel,
              targetBracket,
              outcome.fellBackFrom,
              outcome.source,
              selectedThemesWithSlugs.map((t) => t.name).join(', '),
              outcome.fellBackCause
            );
          }
        }
        // outcome === null means every rung's fetch threw — keep the original
        // thin-but-parsed theme+bracket pool computed above rather than nothing.
      } else if (!representativeStats.numDecks || representativeStats.numDecks === 0) {
        // Pre-E93 behavior, unchanged: no bracket was targeted, but the theme
        // endpoint parsed fine while lacking type-distribution stats — patch
        // stats only from the base page (the cardlist itself is still used).
        logger.warn(
          '[DeckGen] FALLBACK: Theme endpoint lacks stats (numDecks=0), fetching base commander stats'
        );
        try {
          const baseStatsData = partnerCommander
            ? await fetchPartnerCommanderData(
                commander.name,
                partnerCommander.name,
                budgetOption,
                targetBracket
              )
            : await fetchCommanderData(commander.name, budgetOption, targetBracket);
          representativeStats = baseStatsData.stats;
          logger.debug('[DeckGen] FALLBACK: Got stats from base commander+bracket');
        } catch {
          if (targetBracket) {
            logger.warn(
              '[DeckGen] FALLBACK: Base commander+bracket stats failed, trying without bracket'
            );
            try {
              const fallbackData = partnerCommander
                ? await fetchPartnerCommanderData(
                    commander.name,
                    partnerCommander.name,
                    budgetOption
                  )
                : await fetchCommanderData(commander.name, budgetOption);
              representativeStats = fallbackData.stats;
              logger.debug('[DeckGen] FALLBACK: Got stats from base commander (no bracket)');
            } catch {
              logger.warn(
                '[DeckGen] FALLBACK: All stats fetches failed — will use fallback type targets'
              );
            }
          } else {
            logger.warn(
              '[DeckGen] FALLBACK: Base commander stats fetch failed — will use fallback type targets'
            );
          }
        }
      }

      state.edhrecData = {
        themes: [],
        stats: representativeStats,
        cardlists: mergedCardlists,
        similarCommanders: [],
      };

      state.dataSource = dataSource;
      const themeNames = selectedThemesWithSlugs.map((t) => t.name).join(', ');
      onProgress?.(`Attuning to ${themeNames}…`, 12);
    } catch (error) {
      logger.warn(
        '[DeckGen] FALLBACK: Theme-specific EDHREC fetch failed, trying base commander+bracket:',
        error
      );
      // Fall back to base commander data (with bracket)
      try {
        state.edhrecData = partnerCommander
          ? await fetchPartnerCommanderData(
              commander.name,
              partnerCommander.name,
              budgetOption,
              targetBracket
            )
          : await fetchCommanderData(commander.name, budgetOption, targetBracket);
        state.dataSource = targetBracket ? 'base+bracket' : 'base';
        logger.debug('[DeckGen] FALLBACK: Using base commander data (with bracket)');
        onProgress?.('Consulting the Oracle…', 12);
      } catch {
        // Fall back to base commander without bracket
        if (targetBracket) {
          logger.warn(
            '[DeckGen] FALLBACK: Base commander+bracket also failed, trying without bracket'
          );
          try {
            state.edhrecData = partnerCommander
              ? await fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption)
              : await fetchCommanderData(commander.name, budgetOption);
            state.dataSource = 'base';
            logger.debug('[DeckGen] FALLBACK: Using base commander data (no bracket)');
            onProgress?.('Consulting the Oracle…', 12);
          } catch {
            logger.warn(
              '[DeckGen] FALLBACK: All EDHREC fetches failed — will use Scryfall-only generation'
            );
            onProgress?.('Scrying for more…', 12);
          }
        } else {
          logger.warn(
            '[DeckGen] FALLBACK: Base commander fetch failed — will use Scryfall-only generation'
          );
          onProgress?.('Scrying for more…', 12);
        }
      }
    }
  } else if (!usingCache) {
    // No themes selected - use base commander data (top recommended cards)
    onProgress?.('Consulting the Oracle…', 8);
    if (targetBracket) {
      // E93: ladder bracket-only → plain commander page when the bracket page
      // is too thin to build from. This also subsumes the pre-E93 error-only
      // fallback below (a thrown fetch is just a rung with no data).
      const outcome = await fetchPoolWithFallback([
        {
          source: 'base+bracket',
          fetch: () =>
            partnerCommander
              ? fetchPartnerCommanderData(
                  commander.name,
                  partnerCommander.name,
                  budgetOption,
                  targetBracket
                )
              : fetchCommanderData(commander.name, budgetOption, targetBracket),
        },
        {
          source: 'base',
          fetch: () =>
            partnerCommander
              ? fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption)
              : fetchCommanderData(commander.name, budgetOption),
        },
      ]);
      if (outcome) {
        state.edhrecData = outcome.data;
        state.dataSource = outcome.source;
        if (outcome.fellBackFrom) {
          logger.warn(
            `[DeckGen] E93: bracket-only pool too thin, laddered down to "${outcome.source}"`
          );
          const commanderLabel = partnerCommander
            ? `${commander.name} // ${partnerCommander.name}`
            : commander.name;
          state.bracketPoolFallbackNote = buildBracketPoolFallbackNote(
            commanderLabel,
            targetBracket,
            outcome.fellBackFrom,
            outcome.source,
            undefined,
            outcome.fellBackCause
          );
        }
        onProgress?.('Your commander heeds the call…', 12);
      } else {
        logger.warn(
          '[DeckGen] FALLBACK: All EDHREC fetches failed — will use Scryfall-only generation'
        );
        onProgress?.('Scrying for more…', 12);
      }
    } else {
      try {
        state.edhrecData = partnerCommander
          ? await fetchPartnerCommanderData(commander.name, partnerCommander.name, budgetOption)
          : await fetchCommanderData(commander.name, budgetOption);
        state.dataSource = 'base';
        onProgress?.('Your commander heeds the call…', 12);
      } catch {
        logger.warn(
          '[DeckGen] FALLBACK: Base commander fetch failed — will use Scryfall-only generation'
        );
        onProgress?.('Scrying for more…', 12);
      }
    }
  }

  // E282: one thinness reading BEFORE either widener runs, so the second
  // widener (and the disclosure) sees the commander page's own coverage, not
  // the first widener's injections.
  const thinOwnedOnPage = thinOwnedPoolCount(state);
  await applyArchetypeBlend(state, thinOwnedOnPage);
  await applyOwnedSimilarPool(state, thinOwnedOnPage);

  return { altPool, scryfallQuery };
}

/** E282: an owned-only build — "Only my cards" / "Available only" with a
 *  collection attached. Both pool wideners below key off this. */
function isOwnedOnlyBuild(state: GenerationState): boolean {
  return constrainsToCollection(state.cfg.collectionStrategy) && !!state.context.collectionNames;
}

/**
 * E282: widen only when the collection genuinely can't fill the deck from the
 * commander's own page with margin. The live A/B showed the E228 failure mode
 * otherwise — a 1–2 card injection into a pool that had no thin slots (Talrand,
 * 76 owned cards on a 62-slot page) still reshuffled six cards downstream
 * (lift seeds, combo swaps) and cost a grade. Calibrated on the 2026-09-10
 * owned-only panel, owned-on-page vs 62 spell slots: Sram 59 (16 thin-pool
 * fills, widening cut them to 7) needs it; Talrand 76 / Ayara 77 / Krenko 86 /
 * Ezuri 93 are left alone — their few remaining fills are disclosed instead.
 * Returns the owned-on-page count when the pool is thin, undefined otherwise.
 */
// E283: the ratio lives in lib/commander-coverage.ts so the commander picker
// ranks by the exact line the generator gates on; re-exported for callers.
export { OWNED_POOL_THIN_RATIO };
function thinOwnedPoolCount(state: GenerationState): number | undefined {
  const { collectionNames, colorIdentity, collectionPool } = state.context;
  if (!collectionNames || !state.edhrecData) return undefined;
  const identity = new Set(colorIdentity);
  const identityOf = new Map((collectionPool ?? []).map((c) => [c.name, c.colorIdentity] as const));
  const ownedOnPage = state.edhrecData.cardlists.allNonLand.filter((c) => {
    if (!collectionNames.has(c.name)) return false;
    const ci = identityOf.get(c.name);
    return !ci || ci.every((x) => identity.has(x));
  }).length;
  const { deckFormat, landCount } = state.context.customization;
  const deckSize = deckFormat === 99 ? 99 : deckFormat - 1;
  const nonlandSlots = deckSize - landCount;
  return ownedOnPage < nonlandSlots * OWNED_POOL_THIN_RATIO ? ownedOnPage : undefined;
}

/**
 * Keep only the NONLAND cards the user owns (and, when the lean owned pool is
 * attached, only those inside the deck's identity) — a widener for an
 * owned-only build must not spend its per-category injection caps on cards the
 * pick gate will drop. Lands are deliberately excluded: the thin pool this
 * widening exists for is the spell slots, and land selection has its own
 * machinery — the live A/B showed two injected lands reshuffling a deck that
 * had no thin pool at all (Talrand, A → B).
 */
function filterCardlistsToOwnedSpells(
  cardlists: EDHRECCommanderData['cardlists'],
  state: GenerationState
): EDHRECCommanderData['cardlists'] {
  const owned = state.context.collectionNames ?? new Set<string>();
  const identity = new Set(state.context.colorIdentity);
  const identityOf = new Map(
    (state.context.collectionPool ?? []).map((c) => [c.name, c.colorIdentity] as const)
  );
  const fits = (name: string) => {
    const ci = identityOf.get(name);
    return !ci || ci.every((c) => identity.has(c));
  };
  const keep = (cards: EDHRECCard[]) => cards.filter((c) => owned.has(c.name) && fits(c.name));
  return {
    creatures: keep(cardlists.creatures),
    instants: keep(cardlists.instants),
    sorceries: keep(cardlists.sorceries),
    artifacts: keep(cardlists.artifacts),
    enchantments: keep(cardlists.enchantments),
    planeswalkers: keep(cardlists.planeswalkers),
    lands: [],
    allNonLand: keep(cardlists.allNonLand),
  };
}

/** The commander page's most-played theme, when it carries enough of the
 *  page's theme mass to stand in for a user-selected theme (E282 owned-only
 *  blend). `popularityPercent` is the share of ALL taglinks, type tags
 *  included, so the bar is deliberately modest. */
const OWNED_ONLY_THEME_MIN_SHARE = 20;
function topCommanderTheme(data: EDHRECCommanderData): ThemeResult | undefined {
  const top = [...data.themes].sort((a, b) => b.count - a.count)[0];
  if (!top?.slug || (top.popularityPercent ?? 0) < OWNED_ONLY_THEME_MIN_SHARE) return undefined;
  return { name: top.name, slug: top.slug, source: 'edhrec', isSelected: true };
}

export const SIMILAR_POOL_SOURCE = 'similar-commanders';
/** How many similar commanders' pages to draw from — enough to cover a thin
 *  mono-color page, few enough that the injected inclusion (weighted like the
 *  archetype blend) never outranks the commander's own staples. */
const SIMILAR_COMMANDER_PAGES = 3;

/**
 * ── E282: owned-only pool widening from similar commanders ──
 *
 * When the commander's own page ∩ collection runs thin, the deck used to fall
 * to a color-identity-only search of the collection (Ruby Medallion in mono-W).
 * The cards a similar commander's players run — that the user OWNS — are a far
 * better next rung: they enter the POOL here, discounted the same way the
 * archetype blend discounts (weight from the commander's own deck count, per-
 * category caps, the lift floor), so every pick gate still applies. Owned-only
 * builds only; any failure leaves the pool exactly as it was.
 */
async function applyOwnedSimilarPool(
  state: GenerationState,
  ownedOnPage: number | undefined
): Promise<void> {
  const { collectionNames, colorIdentity, commander, partnerCommander } = state.context;
  if (!collectionNames || !isOwnedOnlyBuild(state)) return;
  if (!state.edhrecData) return;
  if (ownedOnPage === undefined) return; // rich enough — leave the pool alone
  if (state.dataSource === 'scryfall' || state.dataSource === 'paupercommander') return;

  try {
    // Theme/partner pages strip `similarCommanders`; the base page (cached
    // from the pool ladder in the common case) always carries them.
    let similar = state.edhrecData.similarCommanders;
    if (similar.length === 0 && !partnerCommander) {
      similar = (await fetchCommanderData(commander.name, state.cfg.budgetOption))
        .similarCommanders;
    }
    const identity = new Set(colorIdentity);
    const picked = similar
      .filter(
        (s) => s.name && s.name !== commander.name && s.colorIdentity.every((c) => identity.has(c))
      )
      .slice(0, SIMILAR_COMMANDER_PAGES);
    if (picked.length === 0) return;

    const fetched = await Promise.all(
      picked.map((s) =>
        fetchCommanderData(s.name, state.cfg.budgetOption)
          .then((data) => ({ name: s.name, data }))
          .catch(() => null)
      )
    );
    const pages = fetched.filter(
      (p): p is { name: string; data: EDHRECCommanderData } => p != null
    );
    if (pages.length === 0) return;

    const merged = mergeThemeCardlists(pages.map((p) => p.data)).cardlists;
    const { cardlists, injectedNames, weight } = blendTagPageIntoPool({
      pool: state.edhrecData.cardlists,
      tagPageCardlists: filterCardlistsToOwnedSpells(merged, state),
      tagPagePotentialDecks: Math.max(...pages.map((p) => p.data.stats.numDecks)),
      commanderNumDecks: state.edhrecData.stats.numDecks,
      source: SIMILAR_POOL_SOURCE,
      tail: true,
    });
    if (injectedNames.length === 0) return;

    state.edhrecData = { ...state.edhrecData, cardlists };
    state.similarPoolNames = injectedNames;
    state.similarPoolCommanders = pages.map((p) => p.name);
    state.similarPoolOwnedOnPage = ownedOnPage;
    logger.debug(
      `[DeckGen] E282: added ${injectedNames.length} owned cards from similar commanders ` +
        `(${state.similarPoolCommanders.join(', ')}) at w=${weight.toFixed(2)}`
    );
  } catch (error) {
    logger.warn('[DeckGen] E282: similar-commander pool widening skipped —', error);
  }
}

/**
 * ── E221: archetype tag-page blending ──
 *
 * Pool AUGMENTATION, deliberately not a post-fill phase. Injecting here — after
 * the pool ladder has settled, before any type pass runs — means budget,
 * bracket, role caps, colour identity, legality, salt, ban lists and price
 * sanity all apply to injected cards unchanged, for free. Every post-fill phase
 * we've shipped that seated cards outside the normal pick path discovered at
 * the gate that it had bypassed a gate the pick path enforces (#1044).
 *
 * Off by default (`resolveArchetypeBlend`), and a no-op without a selected
 * theme — the blend needs a tag page to blend *from*. Any failure is swallowed:
 * a missing tag page means the deck builds exactly as it would have.
 */
async function applyArchetypeBlend(
  state: GenerationState,
  thinOwnedOnPage?: number
): Promise<void> {
  const { customization, colorIdentity } = state.context;
  // Owned-only turns the blend on by default, but only for a THIN owned pool
  // (thinOwnedPoolCount's doc) — an explicit archetypeBlend=true still runs it
  // regardless, exactly as before.
  const ownedOnly = isOwnedOnlyBuild(state) && thinOwnedOnPage !== undefined;
  if (!resolveArchetypeBlend(customization, ownedOnly)) return;
  if (!state.edhrecData) return;

  // E282: an owned-only build with no theme chosen blends from the commander's
  // own most-played theme — the thin pool is the whole reason to reach for it.
  const theme =
    state.cfg.selectedThemesWithSlugs[0] ??
    (ownedOnly ? topCommanderTheme(state.edhrecData) : undefined);
  if (!theme?.slug) return;

  // Alternative generators synthesize their own pool from Scryfall and have no
  // EDHREC commander page behind them, so there's no local sample to weight
  // against — leave those pools alone.
  if (state.dataSource === 'scryfall' || state.dataSource === 'paupercommander') return;

  try {
    const tagPage = await fetchTagPageData(theme.slug, colorIdentity);
    if (!tagPage) return;

    const commanderNumDecks = state.edhrecData.stats.numDecks;
    const { cardlists, injectedNames, weight } = blendTagPageIntoPool({
      pool: state.edhrecData.cardlists,
      // E282: owned-only builds spend the injection caps on cards the pick
      // gate can actually seat.
      tagPageCardlists: ownedOnly
        ? filterCardlistsToOwnedSpells(tagPage.cardlists, state)
        : tagPage.cardlists,
      // Owned-only: fill only what the commander's page couldn't (tail mode).
      tail: ownedOnly,
      highSynergyNames: tagPage.highSynergyNames,
      tagPagePotentialDecks: tagPage.potentialDecks,
      commanderNumDecks,
    });
    if (injectedNames.length === 0) return;

    state.edhrecData = { ...state.edhrecData, cardlists };
    // Pool-level list; deckGenerator narrows it to what actually shipped before
    // it reaches the report (summarizeSeatedBlend).
    state.archetypeBlendNames = injectedNames;
    state.archetypeBlendTheme = theme.name;
    logger.debug(
      `[DeckGen] E221: blended ${injectedNames.length} cards from "${theme.slug}"` +
        `${tagPage.colorSlug ? `/${tagPage.colorSlug}` : ' (unfiltered)'} at w=${weight.toFixed(2)}`
    );
  } catch (error) {
    // Never fail a generation over an optional backfill.
    logger.warn('[DeckGen] E221: archetype blend skipped —', error);
  }
}

export interface PopulateGenerationCacheContext {
  usingCache: boolean;
  cacheableIntegrityNotes: string[];
}

/**
 * ── Phase A (part 3): cache write-back ──
 * Verbatim extraction from generateDeckInner. Populates the module-private
 * generation cache after a successful (non-cached) EDHREC fetch, so a
 * regeneration (ban a card, add a must-include, tweak settings) can skip
 * straight to the fast path.
 */
export function populateGenerationCachePhase(
  state: GenerationState,
  ctx: PopulateGenerationCacheContext
): void {
  const { usingCache, cacheableIntegrityNotes } = ctx;
  if (!usingCache && state.edhrecData) {
    const key = buildCacheKey(state.context);
    generationCache = {
      edhrecData: state.edhrecData,
      cardMap: new Map(), // Will be populated after Scryfall batch fetch
      themeOverlapCounts: state.themeOverlapCounts,
      combos: state.combos,
      gameChangerNames: state.gameChangerNames,
      dataSource: state.dataSource,
      bracketPoolFallbackNote: state.bracketPoolFallbackNote,
      integrityNotes: cacheableIntegrityNotes,
      representativeStats: state.edhrecData.stats,
      ...key,
    };
    logger.debug('[DeckGen] Generation cache populated for fast regeneration');
  }
}
