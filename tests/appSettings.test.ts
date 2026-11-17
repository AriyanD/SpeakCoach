import { beforeEach, describe, expect, it } from 'vitest';
import { loadAppSettings, saveAppSettings } from '../src/storage/appSettings';

describe('App settings persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to AI-only IELTS question generation and voice-only examiner prompts', async () => {
    await expect(loadAppSettings()).resolves.toEqual({
      allowBuiltinFallback: false,
      theme: 'system',
      language: null,
      showTutorialOnStartup: true,
      onboardingCompleted: false
    });
  });

  it('ignores a legacy stored opt-in to built-in IELTS question fallback', async () => {
    localStorage.setItem('speakcoach.app_settings.v1', JSON.stringify({
      allowBuiltinFallback: true,
      theme: 'dark'
    }));
    await expect(loadAppSettings()).resolves.toMatchObject({
      allowBuiltinFallback: false,
      theme: 'dark'
    });
  });

  it('ignores and removes the retired examiner question text preference', async () => {
    localStorage.setItem('speakcoach.app_settings.v1', JSON.stringify({
      showQuestionText: true,
      theme: 'dark'
    }));

    await saveAppSettings({ theme: 'dark' });

    const saved = JSON.parse(localStorage.getItem('speakcoach.app_settings.v1') || '{}');
    expect(saved).not.toHaveProperty('showQuestionText');
    await expect(loadAppSettings()).resolves.toMatchObject({ theme: 'dark' });
    await expect(loadAppSettings()).resolves.not.toHaveProperty('showQuestionText');
  });

  it('persists the AI-only setting across subsequent loads', async () => {
    await saveAppSettings({ allowBuiltinFallback: false });

    await expect(loadAppSettings()).resolves.toEqual({
      allowBuiltinFallback: false,
      theme: 'system',
      language: null,
      showTutorialOnStartup: true,
      onboardingCompleted: false
    });
  });

  it('merges partial updates without resetting other settings', async () => {
    await saveAppSettings({ allowBuiltinFallback: false });
    await saveAppSettings({});

    await expect(loadAppSettings()).resolves.toEqual({
      allowBuiltinFallback: false,
      theme: 'system',
      language: null,
      showTutorialOnStartup: true,
      onboardingCompleted: false
    });
  });

  it('uses the default when the stored setting has an invalid type', async () => {
    localStorage.setItem('speakcoach.app_settings.v1', JSON.stringify({
      allowBuiltinFallback: 'false',
      theme: 'sepia'
    }));

    await expect(loadAppSettings()).resolves.toEqual({
      allowBuiltinFallback: false,
      theme: 'system',
      language: null,
      showTutorialOnStartup: true,
      onboardingCompleted: false
    });
  });
});


describe('Appearance preference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each(['system', 'light', 'dark'] as const)('persists the %s theme', async (theme) => {
    await saveAppSettings({ theme });
    await expect(loadAppSettings()).resolves.toMatchObject({ theme });
    expect(localStorage.getItem('speakcoach.theme.preference.v1')).toBe(theme);
  });

  it('sanitizes an unknown stored theme to system', async () => {
    localStorage.setItem('speakcoach.app_settings.v1', JSON.stringify({ theme: 'sepia' }));
    await expect(loadAppSettings()).resolves.toMatchObject({ theme: 'system' });
  });
});
