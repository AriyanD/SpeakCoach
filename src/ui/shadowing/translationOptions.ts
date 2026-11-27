import { escapeHtml } from '../shared/html';

const TRANSLATION_LANGUAGES = [
  { code: 'fa', label: 'Persian (فارسی)' },
  { code: 'ar', label: 'Arabic (العربية)' },
  { code: 'de', label: 'German (Deutsch)' },
  { code: 'es', label: 'Spanish (Español)' },
  { code: 'fr', label: 'French (Français)' },
  { code: 'it', label: 'Italian (Italiano)' },
  { code: 'nl', label: 'Dutch (Nederlands)' },
  { code: 'pt', label: 'Portuguese (Português)' },
  { code: 'ru', label: 'Russian (Русский)' },
  { code: 'sv', label: 'Swedish (Svenska)' },
  { code: 'tr', label: 'Turkish (Türkçe)' },
  { code: 'zh', label: 'Chinese (简体中文)' },
  { code: 'ja', label: 'Japanese (日本語)' },
  { code: 'ko', label: 'Korean (한국어)' }
];

export function renderTranslationLanguageOptions(selected: string): string {
  return TRANSLATION_LANGUAGES.map(language =>
    `<option value="${language.code}" ${language.code === selected ? 'selected' : ''}>${escapeHtml(language.label)}</option>`
  ).join('');
}
