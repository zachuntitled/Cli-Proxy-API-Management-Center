import { emptyCursorUsage, type CursorUsage } from '@/services/api/cursorUsage';

export async function refreshCursorUsage({
  signal,
  isCurrent,
  load,
  onUsage,
}: {
  signal: AbortSignal;
  isCurrent: () => boolean;
  load: () => Promise<CursorUsage>;
  onUsage: (usage: CursorUsage) => void;
}): Promise<void> {
  let usage: CursorUsage;
  try {
    usage = await load();
  } catch {
    usage = emptyCursorUsage();
  }
  if (!signal.aborted && isCurrent()) onUsage(usage);
}
