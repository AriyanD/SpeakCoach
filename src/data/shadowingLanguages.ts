export type ShadowingLanguageCode =
  | 'en' | 'sv' | 'de' | 'fr' | 'es' | 'it' | 'nl' | 'pt'
  | 'ru' | 'tr' | 'fa' | 'ar' | 'zh' | 'ja' | 'ko';

export interface ShadowingLanguage {
  code: ShadowingLanguageCode;
  locale: string;
  label: string;
  nativeName: string;
  promptName: string;
  usesWordSegmentation: boolean;
}

export const SHADOWING_LANGUAGES: readonly ShadowingLanguage[] = [
  { code: 'en', locale: 'en-US', label: 'English', nativeName: 'English', promptName: 'English', usesWordSegmentation: true },
  { code: 'sv', locale: 'sv-SE', label: 'Swedish', nativeName: 'Svenska', promptName: 'Swedish', usesWordSegmentation: true },
  { code: 'de', locale: 'de-DE', label: 'German', nativeName: 'Deutsch', promptName: 'German', usesWordSegmentation: true },
  { code: 'fr', locale: 'fr-FR', label: 'French', nativeName: 'Français', promptName: 'French', usesWordSegmentation: true },
  { code: 'es', locale: 'es-ES', label: 'Spanish', nativeName: 'Español', promptName: 'Spanish', usesWordSegmentation: true },
  { code: 'it', locale: 'it-IT', label: 'Italian', nativeName: 'Italiano', promptName: 'Italian', usesWordSegmentation: true },
  { code: 'nl', locale: 'nl-NL', label: 'Dutch', nativeName: 'Nederlands', promptName: 'Dutch', usesWordSegmentation: true },
  { code: 'pt', locale: 'pt-PT', label: 'Portuguese', nativeName: 'Português', promptName: 'Portuguese', usesWordSegmentation: true },
  { code: 'ru', locale: 'ru-RU', label: 'Russian', nativeName: 'Русский', promptName: 'Russian', usesWordSegmentation: true },
  { code: 'tr', locale: 'tr-TR', label: 'Turkish', nativeName: 'Türkçe', promptName: 'Turkish', usesWordSegmentation: true },
  { code: 'fa', locale: 'fa-IR', label: 'Persian', nativeName: 'فارسی', promptName: 'Persian', usesWordSegmentation: true },
  { code: 'ar', locale: 'ar-SA', label: 'Arabic', nativeName: 'العربية', promptName: 'Arabic', usesWordSegmentation: true },
  { code: 'zh', locale: 'zh-CN', label: 'Chinese', nativeName: '简体中文', promptName: 'Simplified Chinese', usesWordSegmentation: false },
  { code: 'ja', locale: 'ja-JP', label: 'Japanese', nativeName: '日本語', promptName: 'Japanese', usesWordSegmentation: false },
  { code: 'ko', locale: 'ko-KR', label: 'Korean', nativeName: '한국어', promptName: 'Korean', usesWordSegmentation: true }
] as const;

export const DEFAULT_SHADOWING_LANGUAGE: ShadowingLanguageCode = 'en';

export function getShadowingLanguage(code: string | null | undefined): ShadowingLanguage {
  return SHADOWING_LANGUAGES.find(language => language.code === code) ??
    SHADOWING_LANGUAGES[0];
}

export function countShadowingLanguageUnits(text: string, languageCode: string): number {
  const clean = text.trim();
  if (!clean) return 0;
  const language = getShadowingLanguage(languageCode);
  if (language.usesWordSegmentation) return clean.split(/\s+/u).filter(Boolean).length;

  // Intl.Segmenter performs language-aware word segmentation for scripts that
  // do not consistently separate words with spaces (for example Chinese and Japanese).
  try {
    const Segmenter = (Intl as unknown as {
      Segmenter?: new (locale?: string, options?: { granularity: string }) => {
        segment(value: string): Iterable<{ isWordLike?: boolean }>;
      };
    }).Segmenter;
    if (Segmenter) {
      const segments = new Segmenter(language.locale, { granularity: 'word' }).segment(clean);
      return Array.from(segments).filter(segment => segment.isWordLike).length;
    }
  } catch { /* Older WebViews may not implement Intl.Segmenter. */ }

  // A conservative character-based fallback avoids treating an unspaced
  // sentence as a single word when native segmentation is unavailable.
  const characters = Array.from(clean.replace(/[\s\p{P}\p{S}]/gu, '')).length;
  return Math.max(1, Math.ceil(characters / (language.code === 'ja' ? 2.5 : 2)));
}
