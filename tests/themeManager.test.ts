import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Theme manager', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('color-scheme');
    document.head.innerHTML = '<meta name="theme-color" content="#F3F8F4" />';
  });

  it('applies the dark theme and enables its stylesheet', async () => {
    const { applyThemePreference } = await import('../src/services/themeManager');

    expect(applyThemePreference('dark')).toBe('dark');

    const stylesheet = document.querySelector<HTMLLinkElement>('#speakcoach-dark-theme');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(stylesheet).not.toBeNull();
    expect(stylesheet?.disabled).toBe(false);
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe('#111814');
  });

  it('applies the light theme and disables the dark stylesheet', async () => {
    const { applyThemePreference } = await import('../src/services/themeManager');

    applyThemePreference('dark');
    expect(applyThemePreference('light')).toBe('light');

    const stylesheet = document.querySelector<HTMLLinkElement>('#speakcoach-dark-theme');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(stylesheet?.disabled).toBe(true);
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe('#F3F8F4');
  });

  it('follows the system preference when system mode is selected', async () => {
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn(),
      addListener: vi.fn()
    } as unknown as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue(mediaQuery)
    });
    const { applyThemePreference } = await import('../src/services/themeManager');

    expect(applyThemePreference('system')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
