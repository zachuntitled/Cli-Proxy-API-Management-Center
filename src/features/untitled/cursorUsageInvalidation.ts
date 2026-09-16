import { useAuthStore, useConfigStore } from '@/stores';
import { cursorUsageRoute, sameCursorUsageRoute } from './cursorIntegrationState';

// Subscribe synchronously so batched logout/login or route A/B/A changes cannot
// make a previous request appear current again before React renders.
export function subscribeCursorUsageInvalidation(
  onSessionChange: () => void,
  onRouteChange: () => void
) {
  const offAuth = useAuthStore.subscribe((next, previous) => {
    if (
      next.isAuthenticated !== previous.isAuthenticated ||
      next.apiBase !== previous.apiBase ||
      next.managementKey !== previous.managementKey
    )
      onSessionChange();
  });
  const offConfig = useConfigStore.subscribe((next, previous) => {
    if (!sameCursorUsageRoute(cursorUsageRoute(next.config), cursorUsageRoute(previous.config)))
      onRouteChange();
  });
  return () => {
    offAuth();
    offConfig();
  };
}
