import type { Config } from '@/types';

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
