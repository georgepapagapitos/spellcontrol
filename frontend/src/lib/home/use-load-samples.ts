import { useState } from 'react';
import { useCollectionStore } from '@/store/collection';
import { importText } from '@/lib/api';
import { sampleCardsAsCsv } from '@/lib/binder/samples';
import { userMessage } from '@/lib/util/user-error';

/**
 * Shared "try the sample collection" load path: importText (CSV) →
 * loadSampleBinders (importCards + the three sample binder defs). Extracted
 * from WelcomePage's door 3 so it and Home's get-started card share one
 * implementation instead of two copies of the same import call + error
 * handling. Callers own what happens after a successful load (navigation,
 * analytics, dismissing the first-run gate) since those differ per surface.
 */
export function useLoadSamples() {
  const loadSampleBinders = useCollectionStore((s) => s.loadSampleBinders);
  const setGlobalError = useCollectionStore((s) => s.setError);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<boolean> {
    setLoading(true);
    setError(null);
    try {
      const response = await importText(sampleCardsAsCsv());
      await loadSampleBinders(response);
      return true;
    } catch (err) {
      const msg = userMessage(err, "Couldn't load the sample cards. Try again in a moment.");
      setError(msg);
      // Propagate to the global error banner too (matches BindersIndexPage behavior).
      setGlobalError(msg);
      return false;
    } finally {
      setLoading(false);
    }
  }

  return { load, loading, error };
}
