import { buildReferenceWordTimings, type ReferenceWordTiming } from '../data/shadowingBank';
import { getShadowingLanguage } from '../data/shadowingLanguages';

export type WordMatchStatus = 'match' | 'mispronounced' | 'missing' | 'extra';
export type WordSpeedLabel = 'too fast' | 'OK' | 'too slow';

export interface SpokenWordToken {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface AlignedWordResult {
  referenceWord?: string;
  spokenWord?: string;
  status: WordMatchStatus;
  accuracyScore: number; // 0-100
  expectedStartMs?: number;
  expectedDurationMs?: number;
  expectedEndMs?: number;
  expectedShare?: number; // expectedDurationMs / totalExpectedMs
  spokenStartMs?: number;
  spokenEndMs?: number;
  spokenDurationMs?: number;
  spokenShare?: number; // spokenDurationMs / totalSpokenMs
  durationRatio?: number; // spokenDurationMs / expectedDurationMs (absolute)
  relativeDurationRatio?: number; // spokenShare / expectedShare (relative share ratio)
  speedLabel?: WordSpeedLabel; // relative speed label
}

export function computeRelativeWordSpeedLabel(
  relativeDurationRatio?: number
): WordSpeedLabel | undefined {
  if (typeof relativeDurationRatio !== 'number' || relativeDurationRatio <= 0) {
    return undefined;
  }
  if (relativeDurationRatio < 0.50) return 'too fast';
  if (relativeDurationRatio > 1.80) return 'too slow';
  return 'OK';
}

export function computeWordSpeedLabel(
  spokenDurationMs?: number,
  expectedDurationMs?: number,
  totalSpokenMs?: number,
  totalExpectedMs?: number
): WordSpeedLabel | undefined {
  if (
    typeof spokenDurationMs !== 'number' ||
    typeof expectedDurationMs !== 'number' ||
    expectedDurationMs <= 0 ||
    spokenDurationMs <= 0
  ) {
    return undefined;
  }

  // If total durations are provided, compute relative duration share
  if (
    typeof totalSpokenMs === 'number' &&
    typeof totalExpectedMs === 'number' &&
    totalSpokenMs > 0 &&
    totalExpectedMs > 0
  ) {
    const spokenShare = spokenDurationMs / totalSpokenMs;
    const expectedShare = expectedDurationMs / totalExpectedMs;
    const relativeRatio = spokenShare / Math.max(0.001, expectedShare);
    return computeRelativeWordSpeedLabel(relativeRatio);
  }

  // Fallback to absolute comparison
  const ratio = spokenDurationMs / expectedDurationMs;
  if (ratio < 0.55) return 'too fast';
  if (ratio > 1.65) return 'too slow';
  return 'OK';
}

export function tokenizeShadowingText(text: string, languageCode = 'en'): string[] {
  const language = getShadowingLanguage(languageCode);
  const clean = text.normalize('NFKC').trim();
  if (!clean) return [];
  if (language.usesWordSegmentation) {
    return clean.split(/\s+/u).map(token => token.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')).filter(Boolean);
  }
  try {
    const Segmenter = (Intl as unknown as {
      Segmenter?: new (locale?: string, options?: { granularity: string }) => {
        segment(value: string): Iterable<{ segment: string; isWordLike?: boolean }>;
      };
    }).Segmenter;
    if (Segmenter) return Array.from(new Segmenter(language.locale, { granularity: 'word' }).segment(clean))
      .filter(part => part.isWordLike).map(part => part.segment);
  } catch { /* Use a character fallback on older WebViews. */ }
  const characters = Array.from(clean.replace(/[\s\p{P}\p{S}]/gu, ''));
  const chunkSize = language.code === 'ja' ? 3 : 2;
  return Array.from({ length: Math.ceil(characters.length / chunkSize) }, (_, index) =>
    characters.slice(index * chunkSize, (index + 1) * chunkSize).join('')
  );
}

function normalizeForLanguage(raw: string, languageCode = 'en'): string {
  const language = getShadowingLanguage(languageCode);
  const value = raw.normalize('NFKC').toLocaleLowerCase(language.locale);
  return language.usesWordSegmentation
    ? value.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')
    : value.replace(/[\s\p{P}\p{S}]/gu, '');
}

export function computeWordSimilarity(aRaw: string, bRaw: string, languageCode = 'en'): number {
  const a = normalizeForLanguage(aRaw, languageCode);
  const b = normalizeForLanguage(bRaw, languageCode);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left = Array.from(a);
  const right = Array.from(b);
  const m = left.length;
  const n = right.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return Math.max(0, 1 - dp[m][n] / Math.max(m, n));
}

export function buildSpokenTokensFromTranscript(
  transcript: string,
  totalDurationMs: number,
  baseConfidence?: number,
  languageCode = 'en'
): SpokenWordToken[] {
  const rawWords = tokenizeShadowingText(transcript, languageCode)
    .filter((word) => normalizeForLanguage(word, languageCode).length > 0);
  if (rawWords.length === 0) return [];

  const weights = rawWords.map((w) => Math.max(2, Array.from(normalizeForLanguage(w, languageCode)).length));
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  const validConf =
    typeof baseConfidence === 'number' && baseConfidence > 0 && baseConfidence <= 1
      ? baseConfidence
      : undefined;

  let cursor = 0;
  return rawWords.map((word, idx) => {
    const dur = Math.max(110, Math.round((totalDurationMs * weights[idx]) / totalWeight));
    const token: SpokenWordToken = {
      word,
      startMs: cursor,
      endMs: cursor + dur,
      ...(validConf !== undefined ? { confidence: validConf } : {})
    };
    cursor += dur;
    return token;
  });
}

export function alignSpokenWordsToReference(
  referenceText: string,
  spokenTokens: SpokenWordToken[],
  expectedTotalDurationMs = 4000,
  referenceTimingsOverride?: ReferenceWordTiming[],
  languageCode = 'en'
): AlignedWordResult[] {
  const languageTokens = tokenizeShadowingText(referenceText, languageCode);
  const totalWeight = languageTokens.reduce((sum, token) => sum + Math.max(2, Array.from(normalizeForLanguage(token, languageCode)).length), 0) || 1;
  let cursorMs = 0;
  const languageTimings: ReferenceWordTiming[] = languageTokens.map(token => {
    const duration = Math.max(140, Math.round(expectedTotalDurationMs * Math.max(2, Array.from(normalizeForLanguage(token, languageCode)).length) / totalWeight));
    const item = { word: token, normalized: normalizeForLanguage(token, languageCode), expectedStartMs: cursorMs, expectedDurationMs: duration };
    cursorMs += duration;
    return item;
  });
  const refTimings = referenceTimingsOverride?.length ? referenceTimingsOverride : languageCode === 'en' ? buildReferenceWordTimings(referenceText, expectedTotalDurationMs) : languageTimings;
  const m = refTimings.length;
  const n = spokenTokens.length;

  // Dynamic programming needleman-wunsch / edit-distance table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  const back: ('M' | 'D' | 'I')[][] = Array.from({ length: m + 1 }, () =>
    new Array<'M' | 'D' | 'I'>(n + 1).fill('M')
  );

  for (let i = 1; i <= m; i++) {
    dp[i][0] = i * 1.0;
    back[i][0] = 'D';
  }
  for (let j = 1; j <= n; j++) {
    dp[0][j] = j * 1.0;
    back[0][j] = 'I';
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sim = computeWordSimilarity(refTimings[i - 1].normalized, spokenTokens[j - 1].word, languageCode);
      const subCost = sim >= 0.62 ? 1 - sim : 2.5; // Disallow aligning unrelated words
      const costMatch = dp[i - 1][j - 1] + subCost;
      const costDel = dp[i - 1][j] + 1.0;
      const costIns = dp[i][j - 1] + 1.0;

      if (costMatch <= costDel && costMatch <= costIns) {
        dp[i][j] = costMatch;
        back[i][j] = 'M';
      } else if (costDel <= costIns) {
        dp[i][j] = costDel;
        back[i][j] = 'D';
      } else {
        dp[i][j] = costIns;
        back[i][j] = 'I';
      }
    }
  }

  const aligned: AlignedWordResult[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    const op = back[i][j];
    if (i > 0 && j > 0 && op === 'M') {
      const ref = refTimings[i - 1];
      const spk = spokenTokens[j - 1];
      const sim = computeWordSimilarity(ref.normalized, spk.word, languageCode);
      const hasRealConf =
        typeof spk.confidence === 'number' && spk.confidence > 0 && spk.confidence <= 1;
      const spokenDur = Math.max(80, spk.endMs - spk.startMs);
      const ratio = Number((spokenDur / Math.max(100, ref.expectedDurationMs)).toFixed(2));

      const isMatch = hasRealConf ? sim >= 0.88 && spk.confidence! >= 0.65 : sim >= 0.88;
      const rawAcc = hasRealConf
        ? isMatch
          ? Math.round(sim * 75 + spk.confidence! * 25)
          : Math.round(sim * 55 + spk.confidence! * 15)
        : isMatch
          ? Math.round(sim * 100)
          : Math.round(sim * 70);

      aligned.push({
        referenceWord: ref.word,
        spokenWord: spk.word,
        status: isMatch ? 'match' : 'mispronounced',
        accuracyScore: Math.max(15, Math.min(100, rawAcc)),
        expectedStartMs: ref.expectedStartMs,
        expectedDurationMs: ref.expectedDurationMs,
        expectedEndMs: ref.expectedStartMs + ref.expectedDurationMs,
        spokenStartMs: spk.startMs,
        spokenEndMs: spk.endMs,
        spokenDurationMs: spokenDur,
        durationRatio: ratio
      });
      i--;
      j--;
    } else if (i > 0 && (j === 0 || op === 'D')) {
      const ref = refTimings[i - 1];
      aligned.push({
        referenceWord: ref.word,
        status: 'missing',
        accuracyScore: 0,
        expectedStartMs: ref.expectedStartMs,
        expectedDurationMs: ref.expectedDurationMs,
        expectedEndMs: ref.expectedStartMs + ref.expectedDurationMs
      });
      i--;
    } else {
      const spk = spokenTokens[j - 1];
      const spokenDur = Math.max(80, spk.endMs - spk.startMs);
      aligned.push({
        spokenWord: spk.word,
        status: 'extra',
        accuracyScore: 0,
        spokenStartMs: spk.startMs,
        spokenEndMs: spk.endMs,
        spokenDurationMs: spokenDur
      });
      j--;
    }
  }

  const results = aligned.reverse();

  // Compute total speech durations for relative share calculation
  const totalExpectedMs =
    refTimings.reduce((sum, r) => sum + r.expectedDurationMs, 0) || expectedTotalDurationMs;
  const matchedWords = results.filter((w) => w.spokenDurationMs && w.referenceWord);
  const totalSpokenMs =
    matchedWords.reduce((sum, w) => sum + (w.spokenDurationMs ?? 0), 0) ||
    (spokenTokens.length > 0 ? spokenTokens[spokenTokens.length - 1].endMs - spokenTokens[0].startMs : 1);

  for (const w of results) {
    if (w.spokenDurationMs && w.expectedDurationMs) {
      const spokenShare = Number((w.spokenDurationMs / Math.max(1, totalSpokenMs)).toFixed(3));
      const expectedShare = Number((w.expectedDurationMs / Math.max(1, totalExpectedMs)).toFixed(3));
      const relRatio = Number((spokenShare / Math.max(0.001, expectedShare)).toFixed(2));
      w.spokenShare = spokenShare;
      w.expectedShare = expectedShare;
      w.relativeDurationRatio = relRatio;
      w.speedLabel = computeRelativeWordSpeedLabel(relRatio);
    }
  }

  return results;
}
