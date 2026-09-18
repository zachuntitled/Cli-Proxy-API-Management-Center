import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore, useConfigStore } from '@/stores';
import { untitledApi, type RouterAccountSnapshot } from '@/services/api/untitled';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { claudeOverviewApi, type ClaudeAccountSnapshot } from '@/services/api/claudeOverview';
import { refreshClaudeOverview, refreshUntitledOverview } from './refreshUntitledOverview';
import {
  cursorUsageApi,
  emptyCursorUsage,
  expireCursorUsage,
  type CursorUsage,
} from '@/services/api/cursorUsage';
import { cursorUsageRoute, sameCursorUsageRoute } from './cursorIntegrationState';
import { refreshCursorUsage } from './refreshCursorUsage';
import { subscribeCursorUsageInvalidation } from './cursorUsageInvalidation';
import { watchCursorUsageExpiry } from './watchCursorUsageExpiry';
import type { OpenAIProviderConfig } from '@/types';
import { useOpenrouterCredits } from './useOpenrouterCredits';

export function useUntitledOverview() {
  const { openrouterCredits, refreshCredits } = useOpenrouterCredits();
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const [snapshot, setSnapshot] = useState<{
    connection: string;
    accounts: RouterAccountSnapshot[];
    checkedAt: number;
  } | null>(null);
  const [claudeSnapshot, setClaudeSnapshot] = useState<{
    connection: string;
    accounts: ClaudeAccountSnapshot[];
    checkedAt: number;
  } | null>(null);
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [claudeError, setClaudeError] = useState(false);
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
  const refreshUsage = useCallback(
    (route: OpenAIProviderConfig) => {
      const session = useAuthStore.getState();
      if (
        !authenticated ||
        !session.isAuthenticated ||
        session.apiBase !== apiBase ||
        session.managementKey !== managementKey ||
        !sameCursorUsageRoute(route, cursorUsageRoute(useConfigStore.getState().config)) ||
        (cursorController.current && !cursorController.current.signal.aborted)
      )
        return;
      const cursorAbort = new AbortController();
      cursorController.current = cursorAbort;
      const request = generation.current;
      setCursorSnapshot((current) => {
        if (
          current?.connection === connection &&
          sameCursorUsageRoute(current.route, route) &&
          current.usage.status !== 'loading' &&
          expireCursorUsage(current.usage) === current.usage &&
          ['fresh', 'stale'].includes(current.usage.status)
        )
          return current;
        return { connection, route, usage: { status: 'loading' } };
      });
      // Cursor latency never holds the independent Codex refresh open.
      void refreshCursorUsage({
        signal: cursorAbort.signal,
        isCurrent: () => {
          const current = useAuthStore.getState();
          return (
            request === generation.current &&
            current.isAuthenticated &&
            current.apiBase === apiBase &&
            current.managementKey === managementKey &&
            sameCursorUsageRoute(route, cursorUsageRoute(useConfigStore.getState().config))
          );
        },
        load: () => cursorUsageApi.get(cursorAbort.signal),
        onUsage: (usage) => setCursorSnapshot({ connection, route, usage }),
      }).finally(() => {
        if (cursorController.current === cursorAbort) cursorController.current = null;
      });
    },
    [apiBase, managementKey, authenticated, connection]
  );
  const refresh = useCallback(async () => {
    controller.current?.abort();
    cursorController.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const request = ++generation.current;
    if (!authenticated) return;
    setLoading(true);
    setClaudeLoading(true);
    setClaudeError(false);
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
    void refreshClaudeOverview({
      signal: abort.signal,
      isCurrent: matchesSession,
      load: () => claudeOverviewApi.listAccounts(abort.signal),
      onAccounts: (accounts) => setClaudeSnapshot({ connection, accounts, checkedAt: Date.now() }),
      onError: () => {
        setClaudeError(true);
      },
      onSettled: () => setClaudeLoading(false),
    });
    await refreshUntitledOverview({
      signal: abort.signal,
      isCurrent: matchesSession,
      loadAccounts: () => untitledApi.listAccounts(abort.signal),
      loadConfig: () => useConfigStore.getState().fetchConfig(true),
      onAccounts: (accounts) => setSnapshot({ connection, accounts, checkedAt: Date.now() }),
      onAccountsError: () => setError(true),
      onRoutingError: (failed) => {
        refreshCredits(!failed);
        setRoutingErrorConnection(failed ? connection : null);
        setConfigReadConnection(connection);
        const route = failed ? null : cursorUsageRoute(useConfigStore.getState().config);
        if (!route) {
          setCursorSnapshot(null);
          return;
        }
        refreshUsage(route);
      },
    });
    if (matchesSession()) setLoading(false);
  }, [apiBase, managementKey, authenticated, connection, refreshUsage, refreshCredits]);
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
      setClaudeSnapshot(null);
      setClaudeLoading(false);
      setClaudeError(false);
      setConfigReadConnection(null);
    }, clearCursor);
    return () => {
      unsubscribe();
      cursorController.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!cursorSnapshot || cursorSnapshot.usage.status === 'loading') return;
    const usage = cursorSnapshot.usage;
    return watchCursorUsageExpiry(usage, {
      now: Date.now,
      isVisible: () => !document.hidden,
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (timer) => window.clearTimeout(timer),
      visibility: document,
      focus: window,
      onExpired: () =>
        setCursorSnapshot((current) =>
          current === cursorSnapshot ? { ...current, usage: emptyCursorUsage() } : current
        ),
      refresh: () => {
        if (configReadConnection === connection && routingErrorConnection !== connection)
          refreshUsage(cursorSnapshot.route);
      },
    });
  }, [cursorSnapshot, refreshUsage, configReadConnection, routingErrorConnection, connection]);
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
  const claudeCurrent =
    authenticated && claudeSnapshot?.connection === connection ? claudeSnapshot : null;
  const cursorCurrent =
    authenticated &&
    configReadConnection === connection &&
    routingErrorConnection !== connection &&
    cursorSnapshot?.connection === connection &&
    sameCursorUsageRoute(cursorSnapshot.route, cursorUsageRoute(config))
      ? cursorSnapshot.usage
      : null;
  return {
    openrouterCredits,
    claudeAccounts: claudeCurrent?.accounts ?? [],
    claudeCheckedAt: claudeCurrent?.checkedAt ?? null,
    claudeLoading,
    claudeError,
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
