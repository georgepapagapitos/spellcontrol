import type { Finish, ImportRow, ParseResult } from './types';
import { parseBool, parseCondition, parseLanguage } from './csv';

const PRICE_FROM_END = 6;

/**
 * Detect: header row contains "Scryfall ID" and "Purchase price" with tab delimiter,
 * AND has the ManaBox-specific "Binder Name" / "Binder Type" leading columns.
 */
export function looksLikeManabox(text: string): boolean {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  if (!firstLine.includes('\t')) return false;
  const lower = firstLine.toLowerCase();
  return (
    lower.includes('scryfall id') &&
    lower.includes('purchase price') &&
    (lower.includes('binder name') || lower.includes('manabox id'))
  );
}

/**
 * Parses ManaBox CSV/TSV export. Reads price by counting from the right end to be robust
 * against embedded tabs in card/set names.
 */
export function parseManabox(text: string): ParseResult {
  const lines = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/);
  if (lines.length < 2)
    return { rows: [], format: 'manabox', unparsedLines: [], skippedUnownedRows: 0 };

  const headers = splitLine(lines[0], '\t');
  const numCols = headers.length;

  // Find indexes of fields we care about. Some are by name; price falls back to right-side.
  const idx = {
    binderName: headers.findIndex((h) => h.toLowerCase() === 'binder name'),
    name: headers.findIndex((h) => h.toLowerCase() === 'name'),
    setCode: headers.findIndex((h) => h.toLowerCase() === 'set code'),
    setName: headers.findIndex((h) => h.toLowerCase() === 'set name'),
    collectorNumber: headers.findIndex((h) => h.toLowerCase() === 'collector number'),
    finish: headers.findIndex((h) => h.toLowerCase() === 'foil'),
    rarity: headers.findIndex((h) => h.toLowerCase() === 'rarity'),
    quantity: headers.findIndex((h) => h.toLowerCase() === 'quantity'),
    scryfallId: headers.findIndex((h) => h.toLowerCase() === 'scryfall id'),
    condition: headers.findIndex((h) => h.toLowerCase() === 'condition'),
    language: headers.findIndex((h) => h.toLowerCase() === 'language'),
    altered: headers.findIndex((h) => h.toLowerCase() === 'altered'),
    misprint: headers.findIndex((h) => h.toLowerCase() === 'misprint'),
  };

  const rows: ImportRow[] = [];
  const unparsedLines: string[] = [];

  for (let lineIdx = 1; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (!line.trim()) continue;

    const vals = splitLine(line, '\t');

    let row: Record<number, string>;
    if (vals.length === numCols) {
      row = vals.reduce<Record<number, string>>((acc, v, i) => {
        acc[i] = v;
        return acc;
      }, {});
    } else if (vals.length > numCols && numCols > 10) {
      // Embedded tabs in name/set caused extra columns — stitch the middle back together.
      const tailLen = numCols - 10;
      const head = vals.slice(0, 9);
      const tail = vals.slice(vals.length - tailLen);
      const middle = vals.slice(9, vals.length - tailLen);
      row = {};
      head.forEach((v, i) => (row[i] = v));
      // Index 9 is Scryfall ID per ManaBox convention
      row[9] = middle.join('');
      tail.forEach((v, i) => (row[10 + i] = v));
    } else {
      unparsedLines.push(line);
      continue;
    }

    const name = idx.name >= 0 ? row[idx.name] || '' : '';
    if (!name) {
      unparsedLines.push(line);
      continue;
    }

    // Always read Purchase price from the right — robust against tab-shifted middle columns.
    let purchasePrice: number | undefined;
    if (vals.length >= PRICE_FROM_END) {
      const priceVal = vals[vals.length - PRICE_FROM_END];
      const p = parseFloat(priceVal);
      if (isFinite(p) && p >= 0 && p < 10000) purchasePrice = p;
    }

    const qty = Math.max(1, parseInt(idx.quantity >= 0 ? row[idx.quantity] || '1' : '1') || 1);

    rows.push({
      name,
      quantity: qty,
      setCode: idx.setCode >= 0 ? row[idx.setCode] || undefined : undefined,
      setName: idx.setName >= 0 ? row[idx.setName] || undefined : undefined,
      collectorNumber: idx.collectorNumber >= 0 ? row[idx.collectorNumber] || undefined : undefined,
      finish: idx.finish >= 0 ? parseManaboxFinish(row[idx.finish]) : undefined,
      rarity: idx.rarity >= 0 ? (row[idx.rarity] || '').toLowerCase() || undefined : undefined,
      scryfallId: idx.scryfallId >= 0 ? row[idx.scryfallId] || undefined : undefined,
      purchasePrice,
      sourceCategory: idx.binderName >= 0 ? row[idx.binderName] || undefined : undefined,
      condition: idx.condition >= 0 ? parseCondition(row[idx.condition]) : undefined,
      language: idx.language >= 0 ? parseLanguage(row[idx.language]) : undefined,
      altered: idx.altered >= 0 ? parseBool(row[idx.altered]) : undefined,
      misprint: idx.misprint >= 0 ? parseBool(row[idx.misprint]) : undefined,
      sourceFormat: 'manabox',
    });
  }

  return { rows, format: 'manabox', unparsedLines, skippedUnownedRows: 0 };
}

function parseManaboxFinish(raw: string | undefined): Finish {
  const v = (raw || '').toLowerCase().trim();
  if (v === 'foil') return 'foil';
  if (v === 'etched') return 'etched';
  return 'nonfoil';
}

function splitLine(line: string, delim: string): string[] {
  return line.split(delim).map((v) => v.trim().replace(/^"|"$/g, ''));
}
