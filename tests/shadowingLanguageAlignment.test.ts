import { describe, expect, it } from 'vitest';
import {
  buildSpokenTokensFromTranscript,
  computeWordSimilarity,
  tokenizeShadowingText
} from '../src/services/wordAlignment';

describe('language-aware Shadowing alignment', () => {
  it('keeps English whitespace tokenization stable', () => {
    expect(tokenizeShadowingText('Hello, world!', 'en')).toEqual(['Hello', 'world']);
    expect(buildSpokenTokensFromTranscript('Hello, world!', 2000, undefined, 'en')).toHaveLength(2);
  });

  it('tokenizes Chinese and Japanese with Intl.Segmenter when available', () => {
    const chinese = tokenizeShadowingText('我喜欢学习中文。', 'zh');
    const japanese = tokenizeShadowingText('私は日本語を勉強します。', 'ja');
    expect(chinese.length).toBeGreaterThan(1);
    expect(japanese.length).toBeGreaterThan(1);
  });

  it('compares non-Latin words without stripping their letters', () => {
    expect(computeWordSimilarity('こんにちは', 'こんにちは', 'ja')).toBe(1);
    expect(computeWordSimilarity('سلام', 'سلام', 'fa')).toBe(1);
    expect(computeWordSimilarity('你好', '你好', 'zh')).toBe(1);
  });

  it('creates timestamp tokens for unspaced scripts', () => {
    const tokens = buildSpokenTokensFromTranscript('你好世界', 1600, undefined, 'zh');
    expect(tokens.length).toBeGreaterThan(1);
    expect(tokens[0].startMs).toBe(0);
    expect(tokens[tokens.length - 1].endMs).toBeGreaterThan(0);
  });
});
