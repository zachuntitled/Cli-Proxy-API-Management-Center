import {
  openrouterCreditsExpiresAt,
  type OpenrouterCredits,
} from '@/services/api/openrouterCredits';

// Keep expiry tied to the observation, not the overview's independent poll clock.
export function watchOpenrouterCreditsExpiry(
  usage: OpenrouterCredits,
  environment: {
    now: () => number;
    isVisible: () => boolean;
    schedule: (callback: () => void, delay: number) => number;
    cancel: (timer: number) => void;
    visibility: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
    focus: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
    onExpired: () => void;
    refresh: () => void;
  }
) {
  const expires = openrouterCreditsExpiresAt(usage);
  let cleared = false;
  let requested = false;
  let disposed = false;
  const check = () => {
    if (disposed || (expires !== null && environment.now() < expires)) return;
    if (expires !== null && !cleared) {
      cleared = true;
      environment.onExpired();
    }
    if (environment.isVisible() && !requested) {
      requested = true;
      environment.refresh();
    }
  };
  const timer =
    expires === null ? null : environment.schedule(check, Math.max(0, expires - environment.now()));
  environment.visibility.addEventListener('visibilitychange', check);
  environment.focus.addEventListener('focus', check);
  return () => {
    disposed = true;
    if (timer !== null) environment.cancel(timer);
    environment.visibility.removeEventListener('visibilitychange', check);
    environment.focus.removeEventListener('focus', check);
  };
}
