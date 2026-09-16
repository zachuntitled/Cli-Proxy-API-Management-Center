import type { Config, OpenAIProviderConfig } from '@/types';
import {
  emptyOpenrouterCredits,
  expireOpenrouterCredits,
  type OpenrouterCredits,
  type OpenrouterCreditsState,
} from '@/services/api/openrouterCredits';

export function openrouterCreditsRoute(config: Config | null): OpenAIProviderConfig | null {
  const routes = (config?.openaiCompatibility ?? []).filter(
    (route) => route.name === 'openrouter' && route.disabled !== true
  );
  if (routes.length !== 1) return null;
  const route = routes[0];
  return route.baseUrl === 'https://openrouter.ai/api/v1' &&
    route.apiKeyEntries.length === 1 &&
    route.apiKeyEntries[0].apiKey.trim()
    ? route
    : null;
}
export function openrouterConfigStatus(
  config: Config | null
): 'disabled' | 'not_configured' | 'unavailable' {
  const routes = (config?.openaiCompatibility ?? []).filter((route) => route.name === 'openrouter');
  return !routes.length
    ? 'not_configured'
    : routes.every((route) => route.disabled === true)
      ? 'disabled'
      : 'unavailable';
}
export function sameOpenrouterRoute(
  first: OpenAIProviderConfig | null,
  second: OpenAIProviderConfig | null
) {
  return (
    first === second ||
    (first !== null && second !== null && JSON.stringify(first) === JSON.stringify(second))
  );
}
// One request owner; synchronous invalidation makes A/B/A transitions irreversible.
export function createOpenrouterCreditsResource(options: {
  load: (signal: AbortSignal) => Promise<OpenrouterCredits>;
  onChange: (value: OpenrouterCreditsState) => void;
}) {
  let generation = 0;
  let controller: AbortController | null = null;
  let value: OpenrouterCreditsState = emptyOpenrouterCredits();
  const publish = (next: OpenrouterCreditsState) => {
    value = next;
    options.onChange(next);
  };
  return {
    invalidate(next: OpenrouterCreditsState = emptyOpenrouterCredits()) {
      generation += 1;
      controller?.abort();
      controller = null;
      publish(next);
    },
    async refresh() {
      if (controller) return;
      const abort = new AbortController();
      controller = abort;
      const request = generation;
      if (value.status !== 'fresh' || expireOpenrouterCredits(value).status !== 'fresh')
        publish({ status: 'loading' });
      try {
        let result: OpenrouterCredits;
        try {
          result = await options.load(abort.signal);
        } catch {
          result = emptyOpenrouterCredits();
        }
        if (!abort.signal.aborted && request === generation)
          publish(expireOpenrouterCredits(result));
      } finally {
        if (controller === abort) controller = null;
      }
    },
  };
}
