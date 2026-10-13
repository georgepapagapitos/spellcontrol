import { useMemo } from 'react';
import {
  buildExport,
  type BuildExportInput,
  type ExportFormat,
} from '@/lib/import-export/deck-export';

/** The deck as export text in `format`, rebuilt only when an input changes. */
export function useDeckExportText(input: BuildExportInput, format: ExportFormat): string {
  const {
    commander,
    partner,
    cards,
    sideboard,
    considering,
    collectionByCopyId,
    commanderAllocatedCopyId,
    partnerAllocatedCopyId,
  } = input;
  return useMemo(
    () =>
      buildExport(
        {
          commander,
          partner,
          cards,
          sideboard,
          considering,
          collectionByCopyId,
          commanderAllocatedCopyId,
          partnerAllocatedCopyId,
        },
        format
      ),
    [
      commander,
      partner,
      cards,
      sideboard,
      considering,
      collectionByCopyId,
      commanderAllocatedCopyId,
      partnerAllocatedCopyId,
      format,
    ]
  );
}
