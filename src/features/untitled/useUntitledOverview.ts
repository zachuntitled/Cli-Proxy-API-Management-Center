import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore, useConfigStore } from '@/stores';
import { untitledApi, type RouterAccountSnapshot } from '@/services/api/untitled';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { refreshUntitledOverview } from './refreshUntitledOverview';
import {
  cursorUsageApi,
  emptyCursorUsage,
  expireCursorUsage,
  cursorUsageExpiresAt,
  type CursorUsage,
} from '@/services/api/cursorUsage';
import { cursorUsageRoute, sameCursorUsageRoute } from './cursorIntegrationState';
import { refreshCursorUsage } from './refreshCursorUsage';
import { subscribeCursorUsageInvalidation } from './cursorUsageInvalidation';
import type { OpenAIProviderConfig } from '@/types';

export function useUntitledOverview() {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const [snapshot, setSnapshot] = useState<{
    connection: string;
    accounts: RouterAccountSnapshot[];
    checkedAt: number;
  } | null>(null);
  const config = useConfigStore((state) => state.config);
  const [cursorSnapshot, setCursorSnapshot] = useState<{
    connection: string;
    route: OpenAIProviderConfig;
    usage: CursorUsage | { status: 'loading' };
  } | null>(null);
  const cursorController = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [routingErrorConnection, setRoutingErrorConnection] = useState<string | null>(null);
  const [configReadConnection, setConfigReadConnection] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  // This value is local-only and never persisted or rendered.
  const connection = `${apiBase}\u0000${managementKey}`;
  const refresh = useCallback(async () => {
    controller.current?.abort();
    cursorController.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const request = ++generation.current;
    if (!authenticated) return;
    setLoading(true);
    setConfigReadConnection(null);
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
      onRoutingError: (failed) => {
        setRoutingErrorConnection(failed ? connection : null);
        setConfigReadConnection(connection);
        const route = failed ? null : cursorUsageRoute(useConfigStore.getState().config);
        if (!route) {
          setCursorSnapshot(null);
          return;
        }
        const cursorAbort = new AbortController();
        cursorController.current = cursorAbort;
        setCursorSnapshot({ connection, route, usage: { status: 'loading' } });
        // Intentionally independent: Cursor latency must not hold Codex cards or refresh open.
        void refreshCursorUsage({
          signal: cursorAbort.signal,
          isCurrent: () =>
            matchesSession() &&
            sameCursorUsageRoute(route, cursorUsageRoute(useConfigStore.getState().config)),
          load: () => cursorUsageApi.get(cursorAbort.signal),
          onUsage: (usage) => setCursorSnapshot({ connection, route, usage }),
        });
      },
    });
    if (matchesSession()) setLoading(false);
  }, [apiBase, managementKey, authenticated, connection]);
  useEffect(() => {
    // Synchronous subscriptions invalidate even a logout/login or A/B/A route change
    // batched into one React render. An old request must never become current again.
    const clearCursor = () => {
      cursorController.current?.abort();
      setCursorSnapshot(null);
    };
    const unsubscribe = subscribeCursorUsageInvalidation(() => {
      controller.current?.abort();
      generation.current += 1;
      clearCursor();
      setSnapshot(null);
    }, clearCursor);
    return () => {
      unsubscribe();
      cursorController.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!cursorSnapshot || cursorSnapshot.usage.status === 'loading') return;
    const usage = cursorSnapshot.usage;
    const expires = cursorUsageExpiresAt(usage);
    if (expires === null) return;
    const expire = () => {
      setCursorSnapshot((current) =>
        current === cursorSnapshot ? { ...current, usage: expireCursorUsage(usage) } : current
      );
    };
    const timer = window.setTimeout(expire, Math.max(0, expires - Date.now()));
    document.addEventListener('visibilitychange', expire);
    window.addEventListener('focus', expire);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', expire);
      window.removeEventListener('focus', expire);
    };
  }, [cursorSnapshot]);
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
  const current = authenticated && snapshot?.connection === connection ? snapshot : null;
  const cursorCurrent =
    authenticated &&
    configReadConnection === connection &&
    routingErrorConnection !== connection &&
    cursorSnapshot?.connection === connection &&
    sameCursorUsageRoute(cursorSnapshot.route, cursorUsageRoute(config))
      ? cursorSnapshot.usage
      : null;
  return {
    cursorUsage:
      cursorCurrent?.status === 'loading'
        ? cursorCurrent
        : expireCursorUsage(cursorCurrent ?? emptyCursorUsage()),
    accounts: current?.accounts ?? [],
    checkedAt: current?.checkedAt ?? null,
    loading,
    error,
    routingError: routingErrorConnection === connection,
    configLoading: !authenticated || configReadConnection !== connection,
    refresh,
  };
}
