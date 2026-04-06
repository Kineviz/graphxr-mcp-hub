import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Reusable polling hook with AbortController to prevent race conditions.
 * - `loading` is true only on initial load (data === null), not on background refreshes.
 * - Concurrent requests are aborted before starting a new one.
 * - Cleanup on unmount cancels any in-flight request.
 */
export function usePolling<T>(
  fetchFn: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const doFetch = useCallback(async () => {
    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await fetchFn(controller.signal);
      if (mountedRef.current && !controller.signal.aborted) {
        setData(result);
        setError(null);
        setLoading(false);
      }
    } catch (err) {
      if (controller.signal.aborted) return; // Intentional abort, ignore
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }
  }, [fetchFn]);

  useEffect(() => {
    mountedRef.current = true;
    doFetch();
    const timer = setInterval(doFetch, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [doFetch, intervalMs]);

  return { data, loading, error, refresh: doFetch };
}
