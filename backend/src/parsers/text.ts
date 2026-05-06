import type { ImportRow, ParseResult } from './types';

/**
 * Matches MTGA-style lines and plain card names, in order from most specific to least:
 *
 *   "1 Sol Ring (CMR) 472"   — MTGA: qty + name + (set) + collector
 *   "1 Sol Ring (CMR)"        — qty + name + (set)
 *   "4x Lightning Bolt"       — qty + name (with optional 'x')
 *   "Sol Ring"                — just a name
 *
 * Empty lines and lines starting with `//` or `#` are treated as comments.
 * Section headers like "Deck", "Sideboard", "Commander" (alone on a line) are skipped.
 */

const SECTION_HEADERS = new Set(['deck', 'sideboard', 'commander', 'maybeboard', 'companion']);

// "1 Sol Ring (CMR) 472" or "1x Sol Ring (CMR) 472"
const MTGA_FULL = /^(\d+)\s*x?\s+(.+?)\s+\(([A-Za-z0-9]{2,5})\)\s+([A-Za-z0-9★-]+)\s*$/;
// "1 Sol Ring (CMR)"
const MTGA_NO_COLLECTOR = /^(\d+)\s*x?\s+(.+?)\s+\(([A-Za-z0-9]{2,5})\)\s*$/;
// "4x Lightning Bolt" or "4 Lightning Bolt"
const QTY_NAME = /^(\d+)\s*x?\s+(.+)$/;

export function parseTextList(text: string): ParseResult {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const rows: ImportRow[] = [];
  const unparsedLines: string[] = [];
  let usedMtga = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('#')) continue;
    if (SECTION_HEADERS.has(line.toLowerCase())) continue;

    let match = line.match(MTGA_FULL);
    if (match) {
      usedMtga = true;
      rows.push({
        name: cleanName(match[2]),
        quantity: parseInt(match[1]) || 1,
        setCode: match[3].toUpperCase(),
        collectorNumber: match[4],
        sourceFormat: 'mtga',
      });
      continue;
    }

    match = line.match(MTGA_NO_COLLECTOR);
    if (match) {
      usedMtga = true;
      rows.push({
        name: cleanName(match[2]),
        quantity: parseInt(match[1]) || 1,
        setCode: match[3].toUpperCase(),
        sourceFormat: 'mtga',
      });
      continue;
    }

    match = line.match(QTY_NAME);
    if (match) {
      rows.push({
        name: cleanName(match[2]),
        quantity: parseInt(match[1]) || 1,
        sourceFormat: 'plain',
      });
      continue;
    }

    // Plain name with no quantity prefix
    if (line.length > 0 && line.length < 200) {
      rows.push({
        name: cleanName(line),
        quantity: 1,
        sourceFormat: 'plain',
      });
      continue;
    }

    unparsedLines.push(raw);
  }

  return { rows, format: usedMtga ? 'mtga' : 'plain', unparsedLines };
}

/**
 * Strips the *FOIL* / *F* / [FOIL] suffixes some lists use, and trims trailing whitespace.
 * Keeps DFC double slashes intact ("Fire // Ice").
 */
function cleanName(raw: string): string {
  return raw
    .replace(/\s*\*F\*\s*$/i, '')
    .replace(/\s*\*FOIL\*\s*$/i, '')
    .replace(/\s*\[FOIL\]\s*$/i, '')
    .trim();
}
