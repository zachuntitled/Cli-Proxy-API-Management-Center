import { useAuthStore, useConfigStore } from '@/stores';
import { openrouterCreditsRoute, sameOpenrouterRoute } from './openrouterCreditsState';

export function subscribeOpenrouterCreditsInvalidation(onSession: () => void, onRoute: () => void) {
  const offAuth = useAuthStore.subscribe((next, previous) => {
    if (
      next.isAuthenticated !== previous.isAuthenticated ||
      next.apiBase !== previous.apiBase ||
      next.managementKey !== previous.managementKey
    )
      onSession();
  });
  const offConfig = useConfigStore.subscribe((next, previous) => {
    if (
      !sameOpenrouterRoute(
        openrouterCreditsRoute(next.config),
        openrouterCreditsRoute(previous.config)
      )
    )
      onRoute();
  });
  return () => {
    offAuth();
    offConfig();
  };
}
