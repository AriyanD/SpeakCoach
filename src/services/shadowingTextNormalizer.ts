export interface ParsedNumberRun { consumed: number; candidates: string[]; value: string; }

const DIGIT_MAP: Record<string, string> = {
  '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
  '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'
};
const NUMBER_WORDS: Record<string, number> = {
  zero:0, oh:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9,
  ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16,
  seventeen:17, eighteen:18, nineteen:19, twenty:20, thirty:30, forty:40, fifty:50,
  sixty:60, seventy:70, eighty:80, ninety:90,
  first:1, second:2, third:3, fourth:4, fifth:5, sixth:6, seventh:7, eighth:8,
  ninth:9, tenth:10, eleventh:11, twelfth:12, thirteenth:13, fourteenth:14,
  fifteenth:15, sixteenth:16, seventeenth:17, eighteenth:18, nineteenth:19,
  twentieth:20, thirtieth:30
};
export function canonicalizeShadowingText(value: string, locale = 'en'): string {
  return value.normalize('NFKC')
    .replace(/[’‘ʼ´`]/gu, "'")
    .replace(/[‐‑‒–—―−]/gu, '-')
    .replace(/[٠-٩۰-۹]/gu, digit => DIGIT_MAP[digit] ?? digit)
    .toLocaleLowerCase(locale);
}
export function splitShadowingCompound(value: string): string[] {
  return canonicalizeShadowingText(value).split(/[-/]/u).filter(Boolean);
}
function parseCardinal(words: string[]): number | null {
  let total = 0, group = 0, seen = false;
  for (const word of words) {
    if (word === 'and') continue;
    if (word === 'a' || word === 'an') { group += 1; seen = true; continue; }
    const n = NUMBER_WORDS[word];
    if (n !== undefined) { group += n; seen = true; continue; }
    if (word === 'hundred') { group = Math.max(1, group) * 100; seen = true; continue; }
    if (word === 'thousand' || word === 'million') {
      total += Math.max(1, group) * (word === 'thousand' ? 1000 : 1000000);
      group = 0; seen = true; continue;
    }
    return null;
  }
  return seen ? total + group : null;
}
export function parseEnglishNumberRun(words: string[], start = 0): ParsedNumberRun | null {
  const expanded: string[] = [];
  let consumed = 0;
  for (const original of words.slice(start, start + 8)) {
    const canonical = canonicalizeShadowingText(original).replace(/^[^\p{L}\p{N}.]+|[^\p{L}\p{N}.]+$/gu, '');
    const parts = canonical.split('-').filter(Boolean);
    const valid = parts.length > 0 && parts.every(part => NUMBER_WORDS[part] !== undefined ||
      ['hundred','thousand','million','and','point','a','an'].includes(part));
    if (!valid) break;
    expanded.push(...parts);
    consumed++;
  }
  if (!consumed) return null;
  const pointAt = expanded.indexOf('point');
  let value: string | null;
  if (pointAt >= 0) {
    const whole = parseCardinal(expanded.slice(0, pointAt)) ?? 0;
    const decimals = expanded.slice(pointAt + 1).map(word => NUMBER_WORDS[word]);
    if (!decimals.length || decimals.some(number => number === undefined || number > 9)) return null;
    value = String(whole) + '.' + decimals.join('');
  } else {
    const parsed = parseCardinal(expanded);
    value = parsed === null ? null : String(parsed);
  }
  if (value === null) return null;
  const values = new Set([value]);
  if (expanded.length >= 2 && expanded.length <= 3) {
    const first = NUMBER_WORDS[expanded[0]], tail = parseCardinal(expanded.slice(1));
    const yearLikeBoundary = consumed === expanded.length || (consumed === 2 && canonicalizeShadowingText(words[start + 1] ?? '').includes('-'));
    if (yearLikeBoundary && first !== undefined && first >= 10 && first <= 99 && tail !== null && tail >= 20 && tail < 100) values.add(String(first * 100 + tail));
  }
  return { consumed, value, candidates: [...values] };
}

export function parseEnglishClockRun(words: string[], start = 0): { consumed: number; value: string } | null {
  const hour = parseCardinal([canonicalizeShadowingText(words[start] ?? '')]);
  if (hour === null || hour < 1 || hour > 12) return null;
  const minuteWord = canonicalizeShadowingText(words[start + 1] ?? '');
  const minute = parseCardinal([minuteWord]);
  if (minuteWord !== 'oh' && minuteWord !== 'zero' && minute !== null && minute >= 0 && minute <= 59) {
    return { consumed: 2, value: `time:${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
  }
  if (minuteWord === 'oh' || minuteWord === 'zero') {
    const unit = parseCardinal([canonicalizeShadowingText(words[start + 2] ?? '')]);
    if (unit !== null && unit >= 0 && unit <= 9) {
      return { consumed: 3, value: `time:${String(hour).padStart(2, '0')}:0${unit}` };
    }
  }
  return null;
}

export function normalizeShadowingToken(value: string, locale = 'en'): string {
  return canonicalizeShadowingText(value, locale).replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
}
