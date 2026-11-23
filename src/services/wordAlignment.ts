import { buildReferenceWordTimings, type ReferenceWordTiming } from '../data/shadowingBank';
import { getShadowingLanguage } from '../data/shadowingLanguages';
import { canonicalizeShadowingText, normalizeShadowingToken, parseEnglishClockRun, parseEnglishNumberRun, splitShadowingCompound } from './shadowingTextNormalizer';

export type WordMatchStatus = 'match' | 'mispronounced' | 'missing' | 'extra';
export type WordSpeedLabel = 'too fast' | 'OK' | 'too slow';

export interface SpokenWordToken {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  normalizedWord?: string;
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
    return clean.split(/\s+/u).map(token => languageCode === 'en'
      ? token.replace(/^[^\p{L}\p{N}$£€']+|[^\p{L}\p{N}%$£€']+$/gu, '')
      : token.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')).filter(Boolean);
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
  const value = canonicalizeShadowingText(raw, language.locale);
  return language.usesWordSegmentation
    ? (languageCode === 'en' ? value.replace(/[-/]/gu, '').replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '') : value.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ''))
    : value.replace(/[\s\p{P}\p{S}]/gu, '');
}

export function computeWordSimilarity(aRaw: string, bRaw: string, languageCode = 'en'): number {
  const a = normalizeForLanguage(aRaw, languageCode);
  const b = normalizeForLanguage(bRaw, languageCode);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.startsWith('time:') || b.startsWith('time:')) return 0;
  if (a.startsWith('num:') || b.startsWith('num:')) {
    if (!a.startsWith('num:') || !b.startsWith('num:')) return 0;
    const leftValues = a.slice(4).split('|');
    const rightValues = b.slice(4).split('|');
    return leftValues.some(value => rightValues.includes(value)) ? 1 : 0;
  }
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


function referenceComparable(raw: string, languageCode: string): string {
  const value = canonicalizeShadowingText(raw, getShadowingLanguage(languageCode).locale);
  if (languageCode !== 'en') return normalizeForLanguage(value, languageCode);
  const clock = value.match(/^(\d{1,2}):(\d{2})(am|pm)?$/u);
  if (clock) { let hour = Number(clock[1]); const minute = Number(clock[2]); if (minute > 59 || hour > 23) return value; if (clock[3] === 'pm' && hour < 12) hour += 12; if (clock[3] === 'am' && hour === 12) hour = 0; return `time:${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`; }
  const currency = value.match(/^([$£€])([\d,]+(?:\.\d+)?)$/u);
  if (currency) return `num:${currency[2].replace(/,/g, '')} ${currency[1] === '$' ? 'dollar' : currency[1] === '£' ? 'pound' : 'euro'}`;
  const percent = value.match(/^([\d,]+(?:\.\d+)?)%$/u);
  if (percent) return `num:${percent[1].replace(/,/g, '')} percent`;
  const ordinal = value.match(/^(\d+)(?:st|nd|rd|th)$/u);
  if (ordinal) return `num:${ordinal[1]}`;
  if (/^\d[\d,]*(?:\.\d+)?$/u.test(value)) return `num:${value.replace(/,/g, '')}`;
  const parts = splitShadowingCompound(value);
  const parsed = parseEnglishNumberRun(parts);
  if (parsed && parsed.consumed === parts.length) return `num:${parsed.candidates.join('|')}`;
  return normalizeForLanguage(value, languageCode);
}
function cleanNumericForAlignment(value: string): string { return value.replace(/,/g, ''); }
function findReferenceNumberPhrase(referenceWords: string[], candidates: string[]): string[] | null {
  for (let index = 0; index < referenceWords.length; index++) {
    const raw = canonicalizeShadowingText(referenceWords[index]);
    const digits = raw.match(/^(\d[\d,]*(?:\.\d+)?)(%|)?$/u);
    if (digits && candidates.includes(digits[1].replace(/,/g, ''))) {
      let count = 1;
      const next = (referenceWords[index + count] ?? '').toLocaleLowerCase('en').replace(/[^a-z]/g, '');
      if (!digits[2] && ['percent','percentage','dollar','dollars','pound','pounds','euro','euros'].includes(next)) count++;
      if (count > 1) return referenceWords.slice(index, index + count);
    }
    const run = parseEnglishNumberRun(referenceWords, index);
    if (!run || !run.candidates.some(value => candidates.includes(value))) continue;
    let count = run.consumed;
    const next = (referenceWords[index + count] ?? '').toLocaleLowerCase('en').replace(/[^a-z]/g, '');
    if (['percent','percentage','dollar','dollars','pound','pounds','euro','euros'].includes(next)) count++;
    if (count > 1) return referenceWords.slice(index, index + count);
  }
  return null;
}
function distributeSpokenNumber(tokenStart: number, tokenEnd: number, words: string[], confidence?: number, displayText = ''): SpokenWordToken[] {
  const weights = words.map(word => Math.max(1, word.length)), total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = tokenStart;
  return words.map((word, index) => {
    const end = index === words.length - 1 ? tokenEnd : cursor + (tokenEnd - tokenStart) * weights[index] / total;
    const item = { word: index === 0 && displayText ? displayText : index === 0 ? word : '', normalizedWord: referenceComparable(word, 'en'), startMs: cursor, endMs: end, confidence };
    cursor = end;
    return item;
  });
}

function prepareSpokenTokens(tokens: SpokenWordToken[], referenceWords: string[], languageCode: string): SpokenWordToken[] {
  const normalizePhrase = (phrase: SpokenWordToken[]): SpokenWordToken[] => phrase.map(token => ({ ...token, normalizedWord: referenceComparable(token.word, languageCode) }));
  if (languageCode !== 'en') return tokens.map(token => ({ ...token, normalizedWord: canonicalizeShadowingText(token.word, getShadowingLanguage(languageCode).locale) }));
  const refs = referenceWords.map(word => referenceComparable(word, languageCode));
  const timeRefs = new Set(refs.filter(ref => ref.startsWith('time:')));
  const output: SpokenWordToken[] = [];
  for (let i = 0; i < tokens.length;) {
    const current = tokens[i], raw = canonicalizeShadowingText(current.word);
    const clock = raw.match(/^\d{1,2}:\d{2}(?:am|pm)?$/u);
    if (clock) { output.push({ ...current, normalizedWord: referenceComparable(raw, languageCode) }); i++; continue; }
    const currency = raw.match(/^([$£€])([\d,]+(?:\.\d+)?)$/u);
    if (currency) {
      const value = cleanNumericForAlignment(currency[2]);
      const phrase = findReferenceNumberPhrase(referenceWords, [value]);
      if (phrase) output.push(...distributeSpokenNumber(current.startMs, current.endMs, phrase, current.confidence, current.word));
      else output.push({ ...current, normalizedWord: referenceComparable(raw, languageCode) });
      i++; continue;
    }
    const percent = raw.match(/^([\d,]+(?:\.\d+)?)%$/u);
    if (percent) {
      const value = cleanNumericForAlignment(percent[1]), phrase = findReferenceNumberPhrase(referenceWords, [value]);
      if (phrase) output.push(...distributeSpokenNumber(current.startMs, current.endMs, phrase, current.confidence, current.word));
      else output.push({ ...current, normalizedWord: referenceComparable(raw, languageCode) });
      i++; continue;
    }
    const ordinal = raw.match(/^(\d+)(?:st|nd|rd|th)$/u);
    if (ordinal || /^\d[\d,]*(?:\.\d+)?$/u.test(raw)) {
      const value = ordinal?.[1] ?? cleanNumericForAlignment(raw);
      let phrase = findReferenceNumberPhrase(referenceWords, [value]);
      const nextUnit = (tokens[i + 1]?.word ?? '').toLocaleLowerCase('en').replace(/[^a-z]/g, '');
      const phraseUnit = phrase?.[phrase.length - 1]?.toLocaleLowerCase('en').replace(/[^a-z]/g, '');
      if (phraseUnit && ['percent','percentage','dollar','dollars','pound','pounds','euro','euros'].includes(phraseUnit) && phraseUnit !== nextUnit) phrase = null;
      if (phrase) {
        const end = phraseUnit && phraseUnit === nextUnit ? tokens[i + 1].endMs : current.endMs;
        output.push(...distributeSpokenNumber(current.startMs, end, phrase, current.confidence, current.word)));
        if (phraseUnit && phraseUnit === nextUnit) { i += 2; continue; }
      } else {
        let combined = '';
        if (['percent','percentage'].includes(nextUnit)) combined = `num:${value} percent`;
        else if (['dollar','dollars','pound','pounds','euro','euros'].includes(nextUnit)) combined = `num:${value} ${nextUnit.replace(/s$/, '')}`;
        if (combined && refs.includes(combined)) {
          output.push({ word: current.word + ' ' + tokens[i + 1].word, normalizedWord: combined, startMs: current.startMs, endMs: tokens[i + 1].endMs });
          i += 2; continue;
        }
        output.push({ ...current, normalizedWord: referenceComparable(raw, languageCode) });
      }      i++; continue;
    }
    const clockRun = parseEnglishClockRun(tokens.map(token => token.word), i);
    if (clockRun && timeRefs.has(clockRun.value)) { const last=tokens[i+clockRun.consumed-1]; output.push({ word:tokens.slice(i,i+clockRun.consumed).map(token=>token.word).join(' '),normalizedWord:clockRun.value,startMs:current.startMs,endMs:last.endMs,confidence:Math.min(...tokens.slice(i,i+clockRun.consumed).map(token=>token.confidence??1)) }); i+=clockRun.consumed; continue; }
    const run = parseEnglishNumberRun(tokens.map(token => token.word), i);
    if (run) {
      let phrase = findReferenceNumberPhrase(referenceWords, run.candidates);
      if (phrase) {
        let consumed = run.consumed;
        const nextUnit = (tokens[i + consumed]?.word ?? '').toLocaleLowerCase('en').replace(/[^a-z]/g, '');
        const phraseUnit = phrase[phrase.length - 1]?.toLocaleLowerCase('en').replace(/[^a-z]/g, '');
        if (phraseUnit && ['percent','percentage','dollar','dollars','pound','pounds','euro','euros'].includes(phraseUnit) && phraseUnit !== nextUnit) phrase = null;
        if (phrase) {
          if (phraseUnit && phraseUnit === nextUnit) consumed++;
          const last = tokens[i + consumed - 1];
          const exactPhrase = consumed === phrase.length && tokens.slice(i, i + consumed).every((token, index) =>
            normalizeShadowingToken(token.word) === normalizeShadowingToken(phrase![index]));
          if (exactPhrase) output.push(...normalizePhrase(tokens.slice(i, i + consumed)));
          else output.push(...distributeSpokenNumber(current.startMs, last.endMs, phrase,
            Math.min(...tokens.slice(i, i + consumed).map(token => token.confidence ?? 1)), tokens.slice(i, i + consumed).map(token => token.word).join(' ')));
          i += consumed; continue;
        }
      }
      let consumed = run.consumed;
      let value = `num:${run.candidates.join('|')}`;
      const nextUnit = tokens[i + consumed]?.word.toLocaleLowerCase('en').replace(/[^a-z]/g, '');
      const combined = ['percent','percentage'].includes(nextUnit ?? '') ? value + ' percent'
        : ['dollar','dollars','pound','pounds','euro','euros'].includes(nextUnit ?? '') ? value + ' ' + nextUnit.replace(/s$/, '') : '';
      if (combined && refs.includes(combined)) { value = combined; consumed++; }
      const last = tokens[i + consumed - 1];
      output.push({ word: tokens.slice(i, i + consumed).map(token => token.word).join(' '), normalizedWord: value, startMs: current.startMs, endMs: last.endMs,
        confidence: Math.min(...tokens.slice(i, i + consumed).map(token => token.confidence ?? 1)) });
      i += consumed; continue;
    }
    // Reconcile open/closed compounds only against a known reference token.
    let merged = false;
    for (let count = 2; count <= Math.min(3, tokens.length - i); count++) {
      const joined = tokens.slice(i, i + count).map(token => normalizeShadowingToken(token.word)).join('');
      const match = refs.some(ref => !ref.startsWith('num:') && normalizeForLanguage(ref, languageCode) === joined);
      if (match) {
        const last = tokens[i + count - 1];
        output.push({ word: tokens.slice(i, i + count).map(token => token.word).join('-'), startMs: current.startMs, endMs: last.endMs });
        i += count; merged = true; break;
      }
    }
    if (merged) continue;
    output.push({ ...current });
    i++;
  }
  return output;
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
  const rawRefTimings = referenceTimingsOverride?.length === languageTokens.length ? referenceTimingsOverride : languageCode === 'en' ? buildReferenceWordTimings(referenceText, expectedTotalDurationMs) : languageTimings;
  const refTimings = rawRefTimings.map((timing, index) => ({ ...timing, normalized: referenceComparable(languageTokens[index], languageCode) }));
  const preparedSpokenTokens = prepareSpokenTokens(spokenTokens, languageTokens, languageCode);
  const m = refTimings.length;
  const n = preparedSpokenTokens.length;

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
      const sim = computeWordSimilarity(refTimings[i - 1].normalized, preparedSpokenTokens[j - 1].normalizedWord ?? preparedSpokenTokens[j - 1].word, languageCode);
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
      const spk = preparedSpokenTokens[j - 1];
      const sim = computeWordSimilarity(ref.normalized, spk.normalizedWord ?? spk.word, languageCode);
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
      const spk = preparedSpokenTokens[j - 1];
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
    (preparedSpokenTokens.length > 0 ? preparedSpokenTokens[preparedSpokenTokens.length - 1].endMs - preparedSpokenTokens[0].startMs : 1);

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
