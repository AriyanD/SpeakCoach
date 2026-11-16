import { loadAppSettings, saveAppSettings, type AppThemePreference } from '../storage/appSettings';

let systemPreference: MediaQueryList | null = null;
let systemListenerAttached = false;

function getEffectiveTheme(preference: AppThemePreference): 'light' | 'dark' {
  if (preference === 'system') {
    return systemPreference?.matches ? 'dark' : 'light';
  }
  return preference;
}

function ensureDarkStylesheet(): HTMLLinkElement | null {
  if (typeof document === 'undefined') return null;
  let link = document.getElementById('speakcoach-dark-theme') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = 'speakcoach-dark-theme';
    link.rel = 'stylesheet';
    link.href = '/src/styles/dark-theme.css';
    link.disabled = true;
    document.head.appendChild(link);
  }
  return link;
}

export function applyThemePreference(preference: AppThemePreference): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'light';
  if (!systemPreference && typeof window.matchMedia === 'function') {
    systemPreference = window.matchMedia('(prefers-color-scheme: dark)');
  }
  const effective = getEffectiveTheme(preference);
  document.documentElement.dataset.theme = effective;
  document.documentElement.style.colorScheme = effective;
  const darkStylesheet = ensureDarkStylesheet();
  if (darkStylesheet) darkStylesheet.disabled = effective !== 'dark';
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = effective === 'dark' ? '#111814' : '#F3F8F4';
  return effective;
}

export async function setThemePreference(preference: AppThemePreference): Promise<void> {
  await saveAppSettings({ theme: preference });
  applyThemePreference(preference);
}

export async function initializeTheme(): Promise<AppThemePreference> {
  const settings = await loadAppSettings();
  applyThemePreference(settings.theme);
  if (!systemListenerAttached && systemPreference) {
    const onSystemChange = (): void => {
      void loadAppSettings().then(({ theme }) => {
        if (theme === 'system') applyThemePreference('system');
      }).catch(() => undefined);
    };
    if (typeof systemPreference.addEventListener === 'function') {
      systemPreference.addEventListener('change', onSystemChange);
    } else {
      systemPreference.addListener(onSystemChange);
    }
    systemListenerAttached = true;
  }
  return settings.theme;
}
