import { useEffect, useState } from 'react';
import type { DeckImportResponse, UploadResponse } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';
import { handleResponse } from './fetch-utils';

const TIMEOUT_MS = 120_000;

function fetchWithTimeout(url: string, opts: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...opts, signal: controller.signal })
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
  const response = await fetchWithTimeout(
    `/api/cards/identify?q=${encodeURIComponent(trimmed)}`,
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
