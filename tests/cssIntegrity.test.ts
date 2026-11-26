import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesDirectory = resolve(process.cwd(), 'src/styles');
const cssFiles = readdirSync(stylesDirectory).filter(name => name.endsWith('.css'));
const styles = cssFiles.map(name => readFileSync(resolve(stylesDirectory, name), 'utf8')).join('\n');
const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, '');

describe('stylesheet integrity', () => {
  it('does not reference undefined custom properties without a fallback', () => {
    const defined = new Set([...withoutComments.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
    const missing = [...withoutComments.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)]
      .filter(match => match[2] === ')' && !defined.has(match[1]))
      .map(match => match[1]);
    expect([...new Set(missing)]).toEqual([]);
  });
  it('does not leave legacy unscoped grammar and translation rules in the cascade', () => {
    const legacy = new RegExp('^\\s*\\.(?:sh-grammar-(?:scroll|chat|result)|sh-translation-actions|sh-translate-btn)(?=[\\s.#:[>+~,{])', 'm');
    expect(withoutComments.match(legacy)).toBeNull();
  });

  it('does not force left-to-right direction on the translated chat container', () => {
    const chatRule = withoutComments.match(/#sh-translation-card \.sh-grammar-chat-messages\s*\{[^}]*\}/);
    expect(chatRule?.[0]).not.toMatch(/direction\s*:\s*ltr/i);
  });

  it('does not scope Translation & Grammar selectors beneath the Shadowing trainer', () => {
    const badScope = new RegExp('\\.shadowing-main-card\\s+[^,{]*\\.(?:sh-grammar(?:-[\\w-]+)?|sh-translation-actions|sh-translation-controls|sh-translate-btn|sh-scroll-[\\w-]+)', 'g');
    expect(withoutComments.match(badScope)).toBeNull();
    expect(withoutComments).toContain('#sh-translation-card .sh-grammar-button-group');
    expect(withoutComments).not.toContain('var(--bg-secondary)');
  });
});
