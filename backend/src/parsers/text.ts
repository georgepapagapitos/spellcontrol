import type { Finish, ImportRow, ParseResult } from './types';

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
// "4x Lightning Bolt", "4 Lightning Bolt", or "4xLightning Bolt" (no space after x)
const QTY_NAME = /^(\d+)\s*x?\s*(.+)$/;

export function parseTextList(text: string): ParseResult {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const rows: ImportRow[] = [];
  const unparsedLines: string[] = [];
  let usedMtga = false;
  let currentSection: string | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('#')) continue;
    if (SECTION_HEADERS.has(line.toLowerCase())) {
      currentSection = line.toLowerCase();
      continue;
    }

    let match = line.match(MTGA_FULL);
    if (match) {
      usedMtga = true;
      const cleaned = cleanName(match[2]);
      rows.push({
        name: cleaned.name,
        quantity: parseInt(match[1]) || 1,
        setCode: match[3].toUpperCase(),
        collectorNumber: match[4],
        finish: cleaned.finish,
        sourceFormat: 'mtga',
        section: currentSection,
      });
      continue;
    }

    match = line.match(MTGA_NO_COLLECTOR);
    if (match) {
      usedMtga = true;
      const cleaned = cleanName(match[2]);
      rows.push({
        name: cleaned.name,
        quantity: parseInt(match[1]) || 1,
        setCode: match[3].toUpperCase(),
        finish: cleaned.finish,
        sourceFormat: 'mtga',
        section: currentSection,
      });
      continue;
    }

    match = line.match(QTY_NAME);
    if (match) {
      const cleaned = cleanName(match[2]);
      rows.push({
        name: cleaned.name,
        quantity: parseInt(match[1]) || 1,
        finish: cleaned.finish,
        sourceFormat: 'plain',
        section: currentSection,
      });
      continue;
    }

    // Plain name with no quantity prefix
    if (line.length > 0 && line.length < 200) {
      const cleaned = cleanName(line);
      rows.push({
        name: cleaned.name,
        quantity: 1,
        finish: cleaned.finish,
        sourceFormat: 'plain',
        section: currentSection,
      });
      continue;
    }

    unparsedLines.push(raw);
  }

  return { rows, format: usedMtga ? 'mtga' : 'plain', unparsedLines };
}

function cleanName(raw: string): { name: string; finish?: Finish } {
  let finish: Finish | undefined;
  let name = raw;
  if (/\s*\*ETCHED\*\s*$/i.test(name)) {
    finish = 'etched';
    name = name.replace(/\s*\*ETCHED\*\s*$/i, '');
  } else if (/\s*\[ETCHED\]\s*$/i.test(name)) {
    finish = 'etched';
    name = name.replace(/\s*\[ETCHED\]\s*$/i, '');
  } else if (/\s*\*FOIL\*\s*$/i.test(name)) {
    finish = 'foil';
    name = name.replace(/\s*\*FOIL\*\s*$/i, '');
  } else if (/\s*\*F\*\s*$/i.test(name)) {
    finish = 'foil';
    name = name.replace(/\s*\*F\*\s*$/i, '');
  } else if (/\s*\[FOIL\]\s*$/i.test(name)) {
    finish = 'foil';
    name = name.replace(/\s*\[FOIL\]\s*$/i, '');
  }
  return { name: name.trim(), finish };
}
