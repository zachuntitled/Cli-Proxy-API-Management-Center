import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore, useConfigStore } from '@/stores';
import {
  emptyOpenrouterCredits,
  expireOpenrouterCredits,
  openrouterCreditsApi,
  type OpenrouterCreditsState,
} from '@/services/api/openrouterCredits';
import {
  createOpenrouterCreditsResource,
  openrouterConfigStatus,
  openrouterCreditsRoute,
  sameOpenrouterRoute,
} from './openrouterCreditsState';

import { watchOpenrouterCreditsExpiry } from './watchOpenrouterCreditsExpiry';
import { subscribeOpenrouterCreditsInvalidation } from './openrouterCreditsInvalidation';

const context = () => {
  const auth = useAuthStore.getState();
  return {
    authenticated: auth.isAuthenticated,
    connection: `${auth.apiBase}\u0000${auth.managementKey}`,
    route: openrouterCreditsRoute(useConfigStore.getState().config),
  };
};
export function useOpenrouterCredits() {
  const auth = useAuthStore((state) => state.isAuthenticated);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const config = useConfigStore((state) => state.config);
  const ready = useRef(false);
  const [snapshot, setSnapshot] = useState<{
    context: ReturnType<typeof context>;
    value: OpenrouterCreditsState;
  } | null>(null);
  const [resource] = useState(() =>
    createOpenrouterCreditsResource({
      load: openrouterCreditsApi.get,
      onChange: (value) => setSnapshot({ context: context(), value }),
    })
  );
  const refreshCredits = useCallback(
    (configAvailable: boolean) => {
      ready.current = configAvailable;
      const current = context();
      if (!current.authenticated || !configAvailable) {
        resource.invalidate();
        return;
      }
      if (!current.route) {
        const status = openrouterConfigStatus(useConfigStore.getState().config);
        resource.invalidate(status === 'unavailable' ? emptyOpenrouterCredits() : { status });
        return;
      }
      // Deliberately detached: credits cannot delay Codex, Cursor, or header refresh.
      void resource.refresh();
    },
    [resource]
  );
  useEffect(() => {
    const unsubscribe = subscribeOpenrouterCreditsInvalidation(
      () => {
        ready.current = false;
        resource.invalidate();
      },
      () => {
        resource.invalidate();
        if (ready.current) refreshCredits(true);
      }
    );
    return () => {
      unsubscribe();
      resource.invalidate();
    };
  }, [resource, refreshCredits]);
  useEffect(() => {
    const usage = snapshot?.value;
    if (!usage || !('observedAtMs' in usage)) return;
    return watchOpenrouterCreditsExpiry(usage, {
      now: Date.now,
      isVisible: () => !document.hidden,
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (timer) => window.clearTimeout(timer),
      visibility: document,
      focus: window,
      onExpired: () => resource.invalidate(),
      refresh: () => refreshCredits(ready.current),
    });
  }, [snapshot, resource, refreshCredits]);
  const current =
    auth &&
    snapshot?.context.authenticated &&
    snapshot.context.connection === `${apiBase}\u0000${managementKey}` &&
    sameOpenrouterRoute(snapshot.context.route, openrouterCreditsRoute(config))
      ? snapshot.value
      : emptyOpenrouterCredits();
  return {
    openrouterCredits: current.status === 'fresh' ? expireOpenrouterCredits(current) : current,
    refreshCredits,
  };
}
