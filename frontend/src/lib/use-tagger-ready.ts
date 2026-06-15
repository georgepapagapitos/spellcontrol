import { useEffect, useState } from 'react';
import { hasTaggerData, loadTaggerData } from '@/deck-builder/services/tagger/client';

export function useTaggerReady(): boolean {
  const [ready, setReady] = useState(hasTaggerData());
  useEffect(() => {
    if (hasTaggerData()) return;
    let cancelled = false;
    void loadTaggerData().then(() => {
      if (!cancelled && hasTaggerData()) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}
