import { useEffect, useRef } from 'react';

/** A checkout opens another tab; update balances when this page becomes active again. */
export function useRefreshOnReturn(refresh: () => Promise<void>, enabled = true) {
  const current = useRef(refresh);
  current.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    let lastRefresh = 0;
    let pending = false;
    const update = () => {
      if (document.visibilityState === 'hidden' || pending || Date.now() - lastRefresh < 1500) return;
      pending = true;
      lastRefresh = Date.now();
      // A failed automatic refresh keeps the last known account; manual refresh reports errors.
      void current.current().catch(() => undefined).finally(() => { pending = false; });
    };
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [enabled]);
}
