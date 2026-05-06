import jsPDF from 'jspdf';
import type {
  BinderPage,
  EnrichedCard,
  MaterializedBinder,
  Page,
  PocketSize,
  UnbinnedBucket,
} from '../types';
import { COLOR_INFO } from './colors';

/**
 * Generates a printable PDF of all binders + the unbinned bucket.
 * One PDF page per physical binder page.
 */
export function exportBindersToPDF(
  binders: MaterializedBinder[],
  unbinned: UnbinnedBucket | null,
  fileName: string
): void {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  let firstPage = true;

  for (const mb of binders) {
    if (mb.totalCards === 0) continue;
    if (!firstPage) doc.addPage();
    firstPage = false;
    drawCoverPage(doc, mb.def.name, mb.totalCards, mb.totalPages, mb.sections);

    for (const section of mb.sections) {
      const info = COLOR_INFO[section.colorKey] || { label: section.colorKey };
      for (const page of section.pages) {
        doc.addPage();
        drawBinderPage(
          doc,
          mb.def.name,
          info.label,
          page.pageNum,
          section.pages.length,
          page.slots,
          mb.effectivePocketSize
        );
      }
    }
  }

  if (unbinned && unbinned.totalCards > 0) {
    if (!firstPage) doc.addPage();
    drawCoverPage(
      doc,
      'Bulk (unbinned)',
      unbinned.totalCards,
      unbinned.totalPages,
      unbinned.sections
    );
    for (const section of unbinned.sections) {
      const info = COLOR_INFO[section.colorKey] || { label: section.colorKey };
      for (const page of section.pages) {
        doc.addPage();
        drawBinderPage(
          doc,
          'Bulk (unbinned)',
          info.label,
          page.pageNum,
          section.pages.length,
          page.slots,
          unbinned.effectivePocketSize
        );
      }
    }
  }

  const safeName = (fileName || 'collection').replace(/\.[^.]+$/, '');
  doc.save(`${safeName}-binder-layout.pdf`);
}

function drawCoverPage(
  doc: jsPDF,
  label: string,
  totalCards: number,
  totalPages: number,
  sections: Array<{ colorKey: string; cards: EnrichedCard[]; pages: BinderPage[] }>
) {
  doc.setFontSize(28);
  doc.setFont('helvetica', 'normal');
  doc.text(label, 105, 60, { align: 'center' });

  doc.setFontSize(12);
  doc.setTextColor(120);
  doc.text(`${totalCards} cards · ${totalPages} physical pages`, 105, 72, {
    align: 'center',
  });

  doc.setFontSize(10);
  let y = 100;
  for (const section of sections) {
    const info = COLOR_INFO[section.colorKey] || { label: section.colorKey };
    doc.setTextColor(50);
    doc.text(info.label, 60, y);
    doc.setTextColor(140);
    doc.text(`${section.cards.length} cards (${section.pages.length} pages)`, 150, y, {
      align: 'right',
    });
    y += 7;
    if (y > 250) break;
  }
}

function drawBinderPage(
  doc: jsPDF,
  binderLabel: string,
  sectionLabel: string,
  pageNum: number,
  totalPages: number,
  page: Page,
  pocketSize: PocketSize
) {
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`${binderLabel} — ${sectionLabel}`, 15, 15);
  doc.text(`Page ${pageNum} of ${totalPages}`, 195, 15, { align: 'right' });

  if (pocketSize === 18) {
    drawGrid(doc, page.slice(0, 9), 3, 3, 15, 25, 85, 110, 'Front');
    drawGrid(doc, page.slice(9, 18), 3, 3, 110, 25, 85, 110, 'Back');
  } else if (pocketSize === 4) {
    drawGrid(doc, page, 2, 2, 30, 30, 150, 200);
  } else {
    drawGrid(doc, page, 3, 3, 25, 25, 160, 220);
  }
}

function drawGrid(
  doc: jsPDF,
  cards: (EnrichedCard | null)[],
  cols: number,
  rows: number,
  startX: number,
  startY: number,
  totalWidth: number,
  totalHeight: number,
  label?: string
) {
  if (label) {
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(label, startX + totalWidth / 2, startY - 2, { align: 'center' });
  }

  const cellW = totalWidth / cols;
  const cellH = totalHeight / rows;
  const padding = 1;

  for (let i = 0; i < rows * cols; i++) {
    const card = cards[i];
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = startX + c * cellW;
    const y = startY + r * cellH;

    doc.setDrawColor(200);
    doc.setLineWidth(0.2);
    doc.rect(x + padding, y + padding, cellW - padding * 2, cellH - padding * 2);

    if (!card) continue;

    doc.setFontSize(6.5);
    doc.setTextColor(40);
    const innerX = x + padding + 1;
    const innerY = y + padding + 4;
    const maxWidth = cellW - padding * 2 - 2;

    const nameLines = doc.splitTextToSize(card.name, maxWidth);
    const trimmedNameLines = nameLines.slice(0, 2);
    doc.text(trimmedNameLines, innerX, innerY);

    doc.setFontSize(5.5);
    doc.setTextColor(120);
    const setText = card.setCode ? card.setCode.toUpperCase() : '';
    doc.text(setText, innerX, innerY + trimmedNameLines.length * 3 + 1);
    doc.text(`$${card.purchasePrice.toFixed(2)}`, innerX, innerY + trimmedNameLines.length * 3 + 5);
    if (card.cmc !== undefined) {
      doc.text(`CMC ${card.cmc}`, innerX, innerY + trimmedNameLines.length * 3 + 9);
    }
  }
}
