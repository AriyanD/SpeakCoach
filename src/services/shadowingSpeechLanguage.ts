const AZURE_PRONUNCIATION_LOCALES = new Set([
  'ar-EG', 'ar-SA', 'ca-ES', 'zh-HK', 'zh-CN', 'zh-TW', 'da-DK', 'nl-NL',
  'en-AU', 'en-CA', 'en-IN', 'en-GB', 'en-US', 'fi-FI', 'fr-CA', 'fr-FR',
  'de-DE', 'hi-IN', 'it-IT', 'ja-JP', 'ko-KR', 'ms-MY', 'nb-NO', 'pl-PL',
  'pt-BR', 'pt-PT', 'ru-RU', 'es-MX', 'es-ES', 'sv-SE', 'ta-IN', 'th-TH', 'vi-VN'
]);

const ELEVENLABS_MULTILINGUAL_LANGUAGES = new Set([
  'en', 'ja', 'zh', 'de', 'hi', 'fr', 'ko', 'pt', 'it', 'es', 'id', 'nl',
  'tr', 'fil', 'pl', 'sv', 'bg', 'ro', 'ar', 'cs', 'el', 'fi', 'hr', 'ms',
  'sk', 'da', 'ta', 'uk', 'ru'
]);

export function normalizeSpeechLocale(locale: string | null | undefined, fallback = 'en-US'): string {
  const candidate = (locale ?? '').trim();
  return /^[a-z]{2,3}-[A-Z]{2,4}$/i.test(candidate) ? candidate : fallback;
}

export function isAzurePronunciationLocaleSupported(locale: string): boolean {
  return AZURE_PRONUNCIATION_LOCALES.has(locale);
}

export function getElevenLabsLanguageCode(locale: string): string | null {
  const code = locale.split('-')[0]?.toLowerCase() ?? '';
  return ELEVENLABS_MULTILINGUAL_LANGUAGES.has(code) ? code : null;
}

export function toWhisperLanguageCode(locale: string): string {
  return normalizeSpeechLocale(locale).split('-')[0].toLowerCase();
}
