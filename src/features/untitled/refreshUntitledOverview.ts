import type { ClaudeAccountSnapshot } from '@/services/api/claudeOverview';
import type { RouterAccountSnapshot } from '@/services/api/untitled';

interface OverviewRefreshOptions {
  signal: AbortSignal;
  isCurrent: () => boolean;
  loadAccounts: () => Promise<RouterAccountSnapshot[]>;
  loadConfig: () => Promise<unknown>;
  onAccounts: (accounts: RouterAccountSnapshot[]) => void;
  onAccountsError: () => void;
  onRoutingError: (failed: boolean) => void;
}

// Each resource commits as soon as it settles, so a failed or slow config read
// cannot discard or delay healthy account data.
export async function refreshUntitledOverview({
  signal,
  isCurrent,
  loadAccounts,
  loadConfig,
  onAccounts,
  onAccountsError,
  onRoutingError,
}: OverviewRefreshOptions): Promise<void> {
  const canCommit = () => !signal.aborted && isCurrent();
  await Promise.all([
    (async () => {
      try {
        const accounts = await loadAccounts();
        if (canCommit()) onAccounts(accounts);
      } catch {
        if (canCommit()) onAccountsError();
      }
    })(),
    (async () => {
      try {
        await loadConfig();
        if (canCommit()) onRoutingError(false);
      } catch {
        if (canCommit()) onRoutingError(true);
      }
    })(),
  ]);
}

// Launched separately by the hook so Claude cannot hold Codex loading open.
export async function refreshClaudeOverview(options: {
  signal: AbortSignal;
  isCurrent: () => boolean;
  load: () => Promise<ClaudeAccountSnapshot[]>;
  onAccounts: (accounts: ClaudeAccountSnapshot[]) => void;
  onError: () => void;
  onSettled: () => void;
}): Promise<void> {
  const canCommit = () => !options.signal.aborted && options.isCurrent();
  try {
    const accounts = await options.load();
    if (canCommit()) options.onAccounts(accounts);
  } catch {
    if (canCommit()) options.onError();
  } finally {
    if (canCommit()) options.onSettled();
  }
}
