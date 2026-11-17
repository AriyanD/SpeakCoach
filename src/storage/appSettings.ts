/**
 * App-wide user settings that are persisted across restarts.
 * Uses the same dual-storage pattern as localStore.ts (Capacitor Preferences + localStorage fallback).
 */

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const APP_SETTINGS_KEY = 'speakcoach.app_settings.v1';
const THEME_MIRROR_KEY = 'speakcoach.theme.preference.v1';
const recoveryNotices: string[] = [];

export function getAppSettingsRecoveryNotices(): string[] {
  return [...recoveryNotices];
}

async function preserveCorruptAppSettings(raw: string): Promise<void> {
  const recoveryKey = `${APP_SETTINGS_KEY}.recovery.${Date.now()}`;
  try {
    await setRaw(recoveryKey, raw);
    recoveryNotices.push(`A damaged app-settings copy was preserved as "${recoveryKey}". Default preferences are being used.`);
  } catch (error) {
    recoveryNotices.push('App settings could not be parsed or preserved. Avoid changing preferences until you have exported any recoverable backup.');
    console.error('[SpeakCoach storage] Could not preserve damaged app settings.', error);
  }
}

export type AppThemePreference = 'system' | 'light' | 'dark';
export type AppLanguage = 'en' | 'fa' | null;

export interface AppSettings {
  /** Preferred appearance; system follows the device setting. */
  theme: AppThemePreference;
  /** Legacy compatibility field. Built-in IELTS question fallback is no longer supported. */
  allowBuiltinFallback: boolean;
  /** Selected language for app guidance. Null means first launch has not asked yet. */
  language: AppLanguage;
  /** Whether the setup guide should appear automatically on future launches. */
  showTutorialOnStartup: boolean;
  /** Whether the first-run guide has been completed or skipped. */
  onboardingCompleted: boolean;
}

const DEFAULTS: AppSettings = {
  allowBuiltinFallback: false,
  theme: 'system',
  language: null,
  showTutorialOnStartup: true,
  onboardingCompleted: false
};

async function getRaw(key: string): Promise<string | null> {
  try {
    const res = await Preferences.get({ key });
    if (res && typeof res.value === 'string') return res.value;
    if (Capacitor.isNativePlatform()) return null;
  } catch (error) {
    if (Capacitor.isNativePlatform()) {
      throw new Error(`Could not read app settings from Android storage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  return null;
}

async function setRaw(key: string, value: string): Promise<void> {
  try {
    await Preferences.set({ key, value });
    const saved = await Preferences.get({ key });
    if (saved?.value !== value) {
      throw new Error('The value read back from Preferences does not match the value that was saved.');
    }
  } catch (error) {
    if (Capacitor.isNativePlatform()) {
      throw new Error(`Could not save app settings to Android storage: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      if (localStorage.getItem(key) !== value) throw new Error('Could not verify the app settings saved in browser storage.');
      return;
    }
    throw error;
  }
  if (!Capacitor.isNativePlatform() && typeof localStorage !== 'undefined') {
    localStorage.setItem(key, value);
  }
}

export async function loadAppSettings(): Promise<AppSettings> {
  const raw = await getRaw(APP_SETTINGS_KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const settings: AppSettings = {
      // Ignore the legacy persisted opt-in: IELTS questions must now come from AI.
      allowBuiltinFallback: false,
      theme: parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system'
        ? parsed.theme
        : DEFAULTS.theme,
      language: parsed.language === 'en' || parsed.language === 'fa' ? parsed.language : DEFAULTS.language,
      showTutorialOnStartup: typeof parsed.showTutorialOnStartup === 'boolean' ? parsed.showTutorialOnStartup : DEFAULTS.showTutorialOnStartup,
      onboardingCompleted: typeof parsed.onboardingCompleted === 'boolean' ? parsed.onboardingCompleted : DEFAULTS.onboardingCompleted
    };
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_MIRROR_KEY, settings.theme); } catch { /* Best-effort first-paint hint only. */ }
    return settings;
  } catch {
    await preserveCorruptAppSettings(raw);
    return { ...DEFAULTS };
  }
}

export async function saveAppSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadAppSettings();
  const updated: AppSettings = {
    allowBuiltinFallback: false,
    theme: settings.theme ?? current.theme,
    language: settings.language !== undefined ? settings.language : current.language,
    showTutorialOnStartup: settings.showTutorialOnStartup ?? current.showTutorialOnStartup,
    onboardingCompleted: settings.onboardingCompleted ?? current.onboardingCompleted
  };
  await setRaw(APP_SETTINGS_KEY, JSON.stringify(updated));
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_MIRROR_KEY, updated.theme); } catch { /* Native Preferences remains the source of truth. */ }
  return updated;
}
