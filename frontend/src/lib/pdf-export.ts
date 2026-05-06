import jsPDF from 'jspdf';
import type {
  BinderPage,
  EnrichedCard,
  MaterializedBinder,
  Page,
  PocketSize,
  UncategorizedBucket,
} from '../types';
import { fetchImagesAsDataUrls } from './image-fetch';

export interface ExportOptions {
  /** Embed Scryfall card images inside each pocket. Default true. */
  includeImages?: boolean;
  /** Reports image-fetch progress as `(done, total)`. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Generates a printable PDF of all binders + the uncategorized bucket.
 * One PDF page per physical binder page. When `includeImages` is set,
 * card art is embedded in each pocket; otherwise cells render as a text
 * card (name / set / price / CMC).
 */
export async function exportBindersToPDF(
  binders: MaterializedBinder[],
  uncategorized: UncategorizedBucket | null,
  fileName: string,
  opts: ExportOptions = {}
): Promise<void> {
  const includeImages = opts.includeImages ?? true;

  const images = includeImages
    ? await fetchImagesAsDataUrls(collectImageUrls(binders, uncategorized), {
        onProgress: opts.onProgress,
      })
    : new Map<string, string>();

  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  let firstPage = true;

  for (const mb of binders) {
    if (mb.totalCards === 0) continue;
    if (!firstPage) doc.addPage();
    firstPage = false;
    drawCoverPage(doc, mb.def.name, mb.totalCards, mb.totalPages, mb.sections);

    for (const section of mb.sections) {
      const info = { label: section.label };
      for (const page of section.pages) {
        doc.addPage();
        drawBinderPage(
          doc,
          mb.def.name,
          info.label,
          page.pageNum,
          section.pages.length,
          page.slots,
          mb.effectivePocketSize,
          images
        );
      }
    }
  }

  if (uncategorized && uncategorized.totalCards > 0) {
    if (!firstPage) doc.addPage();
    drawCoverPage(
      doc,
      'Uncategorized',
      uncategorized.totalCards,
      uncategorized.totalPages,
      uncategorized.sections
    );
    for (const section of uncategorized.sections) {
      const info = { label: section.label };
      for (const page of section.pages) {
        doc.addPage();
        drawBinderPage(
          doc,
          'Uncategorized',
          info.label,
          page.pageNum,
          section.pages.length,
          page.slots,
          uncategorized.effectivePocketSize,
          images
        );
      }
    }
  }

  const safeName = (fileName || 'collection').replace(/\.[^.]+$/, '');
  doc.save(`${safeName}-binder-layout.pdf`);
}

function collectImageUrls(
  binders: MaterializedBinder[],
  uncategorized: UncategorizedBucket | null
): string[] {
  const urls: string[] = [];
  const visit = (slots: (EnrichedCard | null)[]) => {
    for (const c of slots) {
      if (c?.imageNormal) urls.push(c.imageNormal);
    }
  };
  for (const mb of binders) {
    for (const section of mb.sections) {
      for (const page of section.pages) visit(page.slots);
    }
  }
  if (uncategorized) {
    for (const section of uncategorized.sections) {
      for (const page of section.pages) visit(page.slots);
    }
  }
  return urls;
}

function drawCoverPage(
  doc: jsPDF,
  label: string,
  totalCards: number,
  totalPages: number,
  sections: Array<{ key: string; label: string; cards: EnrichedCard[]; pages: BinderPage[] }>
) {
  doc.setFontSize(28);
  doc.setFont('helvetica', 'normal');
  doc.text(label, 105, 60, { align: 'center' });

  doc.setFontSize(12);
  doc.setTextColor(120);
  doc.text(`${totalCards} cards · ${totalPages} pages`, 105, 72, {
    align: 'center',
  });

  doc.setFontSize(10);
  let y = 100;
  for (const section of sections) {
    doc.setTextColor(50);
    doc.text(section.label, 60, y);
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
  pocketSize: PocketSize,
  images: Map<string, string>
) {
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`${binderLabel} — ${sectionLabel}`, 15, 15);
  doc.text(`Page ${pageNum} of ${totalPages}`, 195, 15, { align: 'right' });

  if (pocketSize === 18) {
    drawGrid(doc, page.slice(0, 9), 3, 3, 15, 25, 85, 110, images, 'Front');
    drawGrid(doc, page.slice(9, 18), 3, 3, 110, 25, 85, 110, images, 'Back');
  } else if (pocketSize === 4) {
    drawGrid(doc, page, 2, 2, 30, 30, 150, 200, images);
  } else {
    drawGrid(doc, page, 3, 3, 25, 25, 160, 220, images);
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
  images: Map<string, string>,
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

    const innerX = x + padding;
    const innerY = y + padding;
    const innerW = cellW - padding * 2;
    const innerH = cellH - padding * 2;

    const dataUrl = card?.imageNormal ? images.get(card.imageNormal) : undefined;
    if (card && dataUrl) {
      try {
        doc.addImage(dataUrl, 'JPEG', innerX, innerY, innerW, innerH, undefined, 'FAST');
        continue;
      } catch {
        // Fall through to the text cell on decode failure.
      }
    }

    doc.setDrawColor(200);
    doc.setLineWidth(0.2);
    doc.rect(innerX, innerY, innerW, innerH);

    if (!card) continue;

    doc.setFontSize(6.5);
    doc.setTextColor(40);
    const textX = innerX + 1;
    const textY = innerY + 3;
    const maxWidth = innerW - 2;

    const nameLines = doc.splitTextToSize(card.name, maxWidth);
    const trimmedNameLines = nameLines.slice(0, 2);
    doc.text(trimmedNameLines, textX, textY);

    doc.setFontSize(5.5);
    doc.setTextColor(120);
    const setText = card.setCode ? card.setCode.toUpperCase() : '';
    doc.text(setText, textX, textY + trimmedNameLines.length * 3 + 1);
    doc.text(`$${card.purchasePrice.toFixed(2)}`, textX, textY + trimmedNameLines.length * 3 + 5);
    if (card.cmc !== undefined) {
      doc.text(`CMC ${card.cmc}`, textX, textY + trimmedNameLines.length * 3 + 9);
    }
  }
}
