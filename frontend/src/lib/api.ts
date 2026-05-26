import { useEffect, useState } from 'react';
import type { DeckImportResponse, UploadResponse } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';
import { handleResponse } from './fetch-utils';
import { apiUrl } from './api-base';
import { isNativePlatform } from './platform';

const TIMEOUT_MS = 120_000;

function fetchWithTimeout(url: string, opts: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(apiUrl(url), { ...opts, signal: controller.signal })
    .catch((err) => {
      if (err.name === 'AbortError') {
        throw new Error(
          'The request timed out. This can happen with very large collections. Try importing a smaller batch.'
        );
      }
      throw new Error('The server is not responding. Give it a moment and try again.');
    })
    .finally(() => clearTimeout(timer));
}

/** Import via file upload (CSV, TSV, or text). */
export async function importFile(file: File): Promise<UploadResponse> {
  // On native, CapacitorHttp intercepts window.fetch and serialises File/Blob
  // bodies through a JS↔native bridge that is unreliable for multipart bodies
  // (the import POST silently fails with "Failed to fetch"). All our import
  // formats are plain text — CSV / TSV / TXT / MTGA — so route through the
  // existing JSON {text} branch of /api/import that importText already uses.
  // Web keeps the multipart path: it doesn't go through CapacitorHttp at all,
  // and FormData uploads are well-supported by the browser fetch.
  if (isNativePlatform()) {
    return importText(await file.text());
  }
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetchWithTimeout('/api/import', { method: 'POST', body: formData });
  return handleResponse<UploadResponse>(response);
}

interface SetSummary {
  code: string;
  name: string;
  iconSvgUri: string;
  releasedAt: string;
}
export type SetMap = Record<string, SetSummary>;

let setMapPromise: Promise<SetMap> | null = null;

/** Fetches the Scryfall set list (cached per page-load). Resolves to a map keyed by uppercase set code. */
export function getSetMap(): Promise<SetMap> {
  if (!setMapPromise) {
    setMapPromise = fetchWithTimeout('/api/sets', { method: 'GET' })
      .then((r) => handleResponse<{ sets: SetMap }>(r))
      .then((j) => j.sets)
      .catch((err) => {
        setMapPromise = null;
        throw err;
      });
  }
  return setMapPromise;
}

/** React hook that resolves the set map once per mount (cached globally). */
export function useSetMap(): SetMap | undefined {
  const [map, setMap] = useState<SetMap | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    getSetMap()
      .then((m) => {
        if (!cancelled) setMap(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return map;
}

/** Import via pasted text — MTGA format, plain card names, or CSV-as-text. */
export async function importText(text: string): Promise<UploadResponse> {
  const response = await fetchWithTimeout('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return handleResponse<UploadResponse>(response);
}

/** Import a deck from pasted text. Returns ScryfallCard objects grouped by section. */
export async function importDeckText(text: string): Promise<DeckImportResponse> {
  const response = await fetchWithTimeout('/api/import-deck', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return handleResponse<DeckImportResponse>(response);
}

/** Import a deck from a file upload. Returns ScryfallCard objects grouped by section. */
export async function importDeckFile(file: File): Promise<DeckImportResponse> {
  // Same CapacitorHttp+FormData workaround as importFile() — route file
  // uploads through the JSON {text} branch on native.
  if (isNativePlatform()) {
    return importDeckText(await file.text());
  }
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetchWithTimeout('/api/import-deck', { method: 'POST', body: formData });
  return handleResponse<DeckImportResponse>(response);
}

/**
 * Identifies a card from imperfect text (typically OCR output from the in-browser
 * card scanner). Returns null when Scryfall can't find a confident match.
 */
export async function identifyCard(query: string): Promise<ScryfallCard | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const response = await fetchWithTimeout(`/api/cards/identify?q=${encodeURIComponent(trimmed)}`, {
    method: 'GET',
  });
  const data = await handleResponse<{ card: ScryfallCard | null }>(response);
  return data.card;
}

/**
 * Try a ranked list of OCR candidates in order, returning the first hit.
 * The scanner generates several plausible interpretations of each read
 * (raw text, common Tesseract-substitution variants, first-word fallback)
 * and passes them here — the matcher walks them one by one. Short-circuits
 * on the first successful match.
 *
 * Returns the matched card plus the candidate string that produced it
 * (useful for showing "Read as: X" feedback on success), or null/null on
 * a total miss.
 */
export async function identifyCardFromCandidates(
  candidates: string[]
): Promise<{ card: ScryfallCard | null; matchedQuery: string | null }> {
  for (const candidate of candidates) {
    const card = await identifyCard(candidate);
    if (card) return { card, matchedQuery: candidate };
  }
  return { card: null, matchedQuery: null };
}

/**
 * Resolve a card to its exact printing using set code + collector number.
 * Used by the scanner's bottom-strip OCR path — when both fields land
 * confidently, this returns the *one* printing the user is holding
 * instead of fuzzy-named's canonical-by-name pick.
 *
 * Returns null when Scryfall doesn't recognise the combo. The scanner
 * falls back to the existing fuzzy-named flow on the same scan.
 */
export async function identifyCardBySetNumber(
  set: string,
  number: string
): Promise<ScryfallCard | null> {
  const trimmedSet = set.trim();
  const trimmedNumber = number.trim();
  if (!trimmedSet || !trimmedNumber) return null;
  const response = await fetchWithTimeout(
    `/api/cards/by-set/${encodeURIComponent(trimmedSet)}/${encodeURIComponent(trimmedNumber)}`,
    { method: 'GET' }
  );
  const data = await handleResponse<{ card: ScryfallCard | null }>(response);
  return data.card;
}

/** Fetch all printings of a card by name. */
export async function fetchPrintings(cardName: string): Promise<ScryfallCard[]> {
  const encoded = encodeURIComponent(cardName);
  const response = await fetchWithTimeout(`/api/cards/${encoded}/printings`, { method: 'GET' });
  const data = await handleResponse<{ printings: ScryfallCard[] }>(response);
  return data.printings;
}
