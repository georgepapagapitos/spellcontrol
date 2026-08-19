import { logger } from '../logger';
import { getRulesIndex, parseComprehensiveRules, type RulesIndex } from './index';

/**
 * Keeps the Comprehensive Rules index current.
 *
 * WotC publishes the CR as a dated `.txt` with NO stable URL — the filename
 * changes every quarterly update — so the ingest scrapes the rules page for the
 * current link and re-ingests only when that link changes. Same class of
 * problem as the Scryfall bulk feed (whose `download_uri` also moves).
 */

const RULES_PAGE_URL = 'https://magic.wizards.com/en/rules';
/** Any honest UA works; the default undici one has been bot-blocked before. */
const USER_AGENT = 'SpellControl/1.0 (+https://spellcontrol.com)';

/** Guard against a page/format change silently ingesting garbage. */
const MIN_PARSED_ENTRIES = 1000;

/**
 * The current CR `.txt` URL out of the rules page HTML. The href contains a
 * literal space ("MagicCompRules 20260808.txt"), so the match must allow
 * spaces and the caller must encode before fetching.
 */
export function extractTxtUrl(html: string): string | null {
  const m = html.match(/https?:\/\/media\.wizards\.com\/[^"'<>]*MagicCompRules[^"'<>]*\.txt/i);
  return m ? m[0] : null;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(encodeURI(url), { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

/**
 * Check for a new Comprehensive Rules document and ingest it if the link moved.
 * Returns whether the index changed. Throws on network/parse failure — the
 * scheduler logs and retries next tick; an already-populated index keeps
 * serving the previous document meanwhile.
 */
export async function refreshRules(index: RulesIndex = getRulesIndex()): Promise<boolean> {
  const page = await fetchText(RULES_PAGE_URL);
  const url = extractTxtUrl(page);
  if (!url) throw new Error('no MagicCompRules .txt link found on the rules page');

  const status = index.status();
  if (status.sourceUrl === url && status.count > 0) return false;

  const text = await fetchText(url);
  const entries = parseComprehensiveRules(text);
  if (entries.length < MIN_PARSED_ENTRIES) {
    throw new Error(`parsed only ${entries.length} rules — document format changed?`);
  }
  const effectiveDate = text.match(/effective as of ([^.\r\n]+)\./)?.[1] ?? null;
  index.replaceAll(entries, { sourceUrl: url, effectiveDate });
  logger.info(
    `[rules] ingested ${entries.length} rules (effective ${effectiveDate ?? 'unknown'}) from ${url}`
  );
  return true;
}

/**
 * Boot check + daily re-check, mirroring `scheduleComboIngest`: skip when a
 * successful ingest is recent AND the index has rows, so a crash-looping deploy
 * doesn't hammer the WotC page; the URL comparison inside `refreshRules` makes
 * the non-skipped checks nearly free (one HTML fetch).
 */
export function scheduleRulesIngest(): void {
  const TWENTY_HOURS = 20 * 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  const tick = async () => {
    try {
      const status = getRulesIndex().status();
      if (status.count > 0 && status.ingestedAt && Date.now() - status.ingestedAt < TWENTY_HOURS) {
        logger.info('[rules] skipping ingest — last successful run was recent');
        return;
      }
      await refreshRules();
    } catch (err) {
      logger.error('[rules] schedule tick failed:', err);
    }
  };

  void tick();
  setInterval(() => void tick(), TWENTY_FOUR_HOURS);
}
