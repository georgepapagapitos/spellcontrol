import { useCallback, useEffect, useRef, useState } from 'react';

const EXIT_FALLBACK_MS = 700;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export function useGenerationTakeoverExit() {
  const [isExiting, setIsExiting] = useState(false);
  const resolveRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finishExit = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    resolveRef.current?.();
    resolveRef.current = null;
  }, []);

  const waitForExit = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (prefersReducedMotion()) {
          resolve();
          return;
        }

        finishExit();
        resolveRef.current = resolve;
        setIsExiting(true);
        timerRef.current = setTimeout(finishExit, EXIT_FALLBACK_MS);
      }),
    [finishExit]
  );

  useEffect(() => finishExit, [finishExit]);

  return { isExiting, waitForExit, finishExit };
}
