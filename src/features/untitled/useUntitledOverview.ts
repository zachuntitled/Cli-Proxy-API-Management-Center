import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore, useConfigStore } from '@/stores';
import { untitledApi, type RouterAccountSnapshot } from '@/services/api/untitled';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { refreshUntitledOverview } from './refreshUntitledOverview';

export function useUntitledOverview() {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const [snapshot, setSnapshot] = useState<{
    connection: string;
    accounts: RouterAccountSnapshot[];
    checkedAt: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [routingErrorConnection, setRoutingErrorConnection] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  // This value is local-only and never persisted or rendered.
  const connection = `${apiBase}\u0000${managementKey}`;
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const request = ++generation.current;
    if (!authenticated) return;
    setLoading(true);
    setError(false);
    const matchesSession = () => {
      const current = useAuthStore.getState();
      return (
        !abort.signal.aborted &&
        request === generation.current &&
        current.isAuthenticated &&
        current.apiBase === apiBase &&
        current.managementKey === managementKey
      );
    };
    await refreshUntitledOverview({
      signal: abort.signal,
      isCurrent: matchesSession,
      loadAccounts: () => untitledApi.listAccounts(abort.signal),
      loadConfig: () => useConfigStore.getState().fetchConfig(true),
      onAccounts: (accounts) => setSnapshot({ connection, accounts, checkedAt: Date.now() }),
      onAccountsError: () => setError(true),
      onRoutingError: (failed) => setRoutingErrorConnection(failed ? connection : null),
    });
    if (matchesSession()) setLoading(false);
  }, [apiBase, managementKey, authenticated, connection]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 60000);
    return () => {
      window.clearInterval(timer);
      controller.current?.abort();
    };
  }, [refresh]);
  useHeaderRefresh(refresh);
  const current = snapshot?.connection === connection ? snapshot : null;
  return {
    accounts: current?.accounts ?? [],
    checkedAt: current?.checkedAt ?? null,
    loading,
    error,
    routingError: routingErrorConnection === connection,
    refresh,
  };
}
