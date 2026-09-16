import type { Config, OpenAIProviderConfig } from '@/types';

export type CursorIntegrationState = 'configured' | 'disabled' | 'not_configured' | 'unavailable';

// Configuration proves a route exists, not that the subscription is healthy or has quota.
export function cursorIntegrationState(
  config: Config | null,
  read: { loading: boolean; error: boolean }
): CursorIntegrationState {
  if (read.error || read.loading || !config) return 'unavailable';
  const providers = (config.openaiCompatibility ?? []).filter(
    (provider) => provider.name === 'cursor-subscription'
  );
  if (
    providers.some(
      (provider) =>
        provider.disabled !== true &&
        provider.baseUrl.trim() &&
        provider.apiKeyEntries.some((entry) => entry.apiKey.trim()) &&
        provider.models?.some((model) => model.name.trim())
    )
  ) {
    return 'configured';
  }
  if (providers.length && providers.every((provider) => provider.disabled === true)) {
    return 'disabled';
  }
  return 'not_configured';
}

// Account usage belongs only to the isolated service, never an arbitrary named provider.
export function cursorUsageRoute(config: Config | null): OpenAIProviderConfig | null {
  const routes = (config?.openaiCompatibility ?? []).filter(
    (provider) => provider.name === 'cursor-subscription' && provider.disabled !== true
  );
  if (routes.length !== 1) return null;
  const route = routes[0];
  if (
    !/^http:\/\/127\.0\.0\.1:18317(?:\/v1)?\/?$/.test(route.baseUrl.trim()) ||
    !route.apiKeyEntries.some((entry) => entry.apiKey.trim()) ||
    !route.models?.some((model) => model.name.trim())
  )
    return null;
  return route;
}

export function sameCursorUsageRoute(
  first: OpenAIProviderConfig | null,
  second: OpenAIProviderConfig | null
): boolean {
  // Compare locally only; never persist or expose credential-bearing route identity.
  return (
    first === second ||
    (first !== null && second !== null && JSON.stringify(first) === JSON.stringify(second))
  );
}
