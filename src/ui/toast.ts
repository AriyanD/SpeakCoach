export type ToastKind = 'success' | 'info' | 'error';

let toastHost: HTMLDivElement | null = null;
let dismissTimer: number | null = null;

/**
 * Show a short, non-blocking confirmation for transient actions.
 * Persistent warnings and operation details should remain in their inline status areas.
 */
export function showToast(
  message: string,
  kind: ToastKind = 'success',
  durationMs = 2600
): void {
  const text = message.trim();
  if (!text || typeof document === 'undefined' || !document.body) return;

  if (!toastHost || !toastHost.isConnected) {
    toastHost = document.createElement('div');
    toastHost.className = 'app-toast';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    toastHost.setAttribute('aria-atomic', 'true');
    toastHost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(toastHost);
  }

  if (dismissTimer !== null) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }

  toastHost.textContent = text;
  toastHost.className = `app-toast app-toast-${kind} is-visible`;
  toastHost.setAttribute('aria-hidden', 'false');

  dismissTimer = window.setTimeout(() => {
    toastHost?.classList.remove('is-visible');
    toastHost?.setAttribute('aria-hidden', 'true');
    dismissTimer = null;
  }, Math.max(1200, durationMs));
}
