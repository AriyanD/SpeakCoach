import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../src/ui/shared/html';
import { renderTranslationLanguageOptions } from '../src/ui/shadowing/translationOptions';

describe('shared UI helpers', () => {
  it('escapes HTML-sensitive characters in user-controlled text', () => {
    expect(escapeHtml(`<script title="x">&</script>`)).toBe('&lt;script title=&quot;x&quot;&gt;&amp;&lt;/script&gt;');
  });

  it('renders the selected translation language and escapes its label', () => {
    const html = renderTranslationLanguageOptions('fa');
    expect(html).toContain('<option value="fa" selected>Persian (فارسی)</option>');
    expect(html).toContain('<option value="sv" >Swedish (Svenska)</option>');
    expect(html).not.toContain('undefined');
  });
});
