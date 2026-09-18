import type { TFunction } from 'i18next';
import type { ClaudeQuotaWindow } from '@/types';
import { fetchClaudeQuota } from '@/features/quota/providers/claude/data';
import { isClaudeFile, isDisabledAuthFile } from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { authFilesApi } from './authFiles';
import type { RouterAccount } from './untitled';

export type ClaudeAccountSnapshot = {
  key: string;
  email: string | null;
  status: RouterAccount['status'];
  planType: string | null;
  windows: ClaudeQuotaWindow[];
  success: number;
  failed: number;
  checkedAt: number | null;
  quotaError: boolean;
};

// Keep translated labels out of snapshot identity; rendering resolves labelKey.
const labelKey = ((key: string) => key) as TFunction;
const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
};

export const claudeOverviewApi = {
  listAccounts: async (signal: AbortSignal): Promise<ClaudeAccountSnapshot[]> => {
    throwIfAborted(signal);
    const response = await authFilesApi.list();
    throwIfAborted(signal);
    return Promise.all(
      response.files.filter(isClaudeFile).map(async (file, index) => {
        const authIndex = normalizeAuthIndex(file.authIndex ?? file['auth_index']);
        const disabled = isDisabledAuthFile(file);
        const empty: ClaudeAccountSnapshot = {
          key: authIndex || `claude-unavailable-${index}`,
          email: typeof file.email === 'string' ? file.email.trim() || null : null,
          status: disabled
            ? 'disabled'
            : file.unavailable
              ? 'unavailable'
              : file.status === 'active'
                ? 'active'
                : 'unknown',
          planType: null,
          windows: [],
          success: file.successCount ?? 0,
          failed: file.failureCount ?? 0,
          checkedAt: null,
          quotaError: false,
        };
        if (disabled || !authIndex) return empty;
        try {
          const quota = await fetchClaudeQuota(file, labelKey, { signal, timeout: 20000 });
          throwIfAborted(signal);
          return {
            ...empty,
            windows: quota.windows,
            planType: quota.planType ?? null,
            checkedAt: Date.now(),
          };
        } catch {
          throwIfAborted(signal);
          return { ...empty, quotaError: true };
        }
      })
    );
  },
};
