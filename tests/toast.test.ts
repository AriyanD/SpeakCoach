import { afterEach, describe, expect, it, vi } from 'vitest';
import { showToast } from '../src/ui/toast';

describe('accessible toast feedback', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.querySelector('.app-toast')?.remove();
  });

  it('announces a short confirmation in a polite live region', () => {
    showToast('API key copied into this field.');

    const toast = document.querySelector<HTMLElement>('.app-toast');
    expect(toast?.textContent).toBe('API key copied into this field.');
    expect(toast?.getAttribute('role')).toBe('status');
    expect(toast?.getAttribute('aria-live')).toBe('polite');
    expect(toast?.getAttribute('aria-hidden')).toBe('false');
    expect(toast?.classList.contains('is-visible')).toBe(true);
  });

  it('replaces the current message and dismisses it after the requested duration', () => {
    vi.useFakeTimers();
    showToast('First message');
    showToast('Second message', 'info', 1500);

    const toast = document.querySelector<HTMLElement>('.app-toast');
    expect(toast?.textContent).toBe('Second message');
    expect(toast?.classList.contains('app-toast-info')).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(toast?.classList.contains('is-visible')).toBe(false);
    expect(toast?.getAttribute('aria-hidden')).toBe('true');
  });
});
