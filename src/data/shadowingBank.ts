export type ShadowingDifficulty = 'easy' | 'medium' | 'hard';

export interface ReferenceWordTiming {
  word: string;
  normalized: string;
  expectedStartMs: number;
  expectedDurationMs: number;
}

export interface ShadowingSentence {
  id: string;
  difficulty: ShadowingDifficulty;
  topic: string;
  text: string;
  phoneticFocus: string;
  expectedTotalDurationMs: number;
}

export const BUILTIN_SHADOWING_SENTENCES: ShadowingSentence[] = [
  // EASY (8 sentences)
  {
    id: 'sh-easy-01',
    difficulty: 'easy',
    topic: 'Daily Routine',
    text: 'I usually start my morning with a cup of hot coffee.',
    phoneticFocus: 'Linking: cup of (/kʌp əv/)',
    expectedTotalDurationMs: 3400
  },
  {
    id: 'sh-easy-02',
    difficulty: 'easy',
    topic: 'Work & Study',
    text: 'She has been studying computer science for three years.',
    phoneticFocus: 'Dental fricative /θ/ in three',
    expectedTotalDurationMs: 3300
  },
  {
    id: 'sh-easy-03',
    difficulty: 'easy',
    topic: 'Hometown',
    text: 'My hometown is famous for its peaceful parks and historic bridges.',
    phoneticFocus: 'Consonant clusters: peaceful, bridges',
    expectedTotalDurationMs: 3900
  },
  {
    id: 'sh-easy-04',
    difficulty: 'easy',
    topic: 'Travel',
    text: 'Taking the train is much more comfortable than driving in heavy traffic.',
    phoneticFocus: 'Word stress on comfortable (/ˈkʌmftəbəl/)',
    expectedTotalDurationMs: 4200
  },
  {
    id: 'sh-easy-05',
    difficulty: 'easy',
    topic: 'Reading',
    text: 'Reading a good book before bed helps me relax after work.',
    phoneticFocus: 'Sentence rhythm and final consonant stops',
    expectedTotalDurationMs: 3800
  },
  {
    id: 'sh-easy-06',
    difficulty: 'easy',
    topic: 'Weather',
    text: 'The weather forecast says it might rain heavily tomorrow afternoon.',
    phoneticFocus: 'Diphthongs in might, rain, tomorrow',
    expectedTotalDurationMs: 3900
  },
  {
    id: 'sh-easy-07',
    difficulty: 'easy',
    topic: 'Food',
    text: 'Cooking fresh meals at home saves money and improves your health.',
    phoneticFocus: 'Voiceless /θ/ in health',
    expectedTotalDurationMs: 4000
  },
  {
    id: 'sh-easy-08',
    difficulty: 'easy',
    topic: 'Hobbies',
    text: 'We spent the whole weekend hiking through the mountain trails.',
    phoneticFocus: 'Vowel contrast: whole vs. through',
    expectedTotalDurationMs: 3700
  },

  // MEDIUM (8 sentences)
  {
    id: 'sh-med-01',
    difficulty: 'medium',
    topic: 'Technology',
    text: 'Artificial intelligence is rapidly transforming how modern businesses communicate with customers.',
    phoneticFocus: 'Multi-syllable stress: artificial, intelligence, communicating',
    expectedTotalDurationMs: 5200
  },
  {
    id: 'sh-med-02',
    difficulty: 'medium',
    topic: 'Environment',
    text: 'Governments should invest more heavily in renewable energy to reduce carbon emissions.',
    phoneticFocus: 'Stress timing: renewable, emissions',
    expectedTotalDurationMs: 5000
  },
  {
    id: 'sh-med-03',
    difficulty: 'medium',
    topic: 'Education',
    text: 'Practical experience is often just as valuable as a formal university qualification.',
    phoneticFocus: 'Weak forms: as a (/əz ə/), qualification stress',
    expectedTotalDurationMs: 5100
  },
  {
    id: 'sh-med-04',
    difficulty: 'medium',
    topic: 'Urban Life',
    text: 'Although living in a metropolitan area offers career opportunities, the cost of housing is high.',
    phoneticFocus: 'Intonation rise on subordinate clause (Although...)',
    expectedTotalDurationMs: 5600
  },
  {
    id: 'sh-med-05',
    difficulty: 'medium',
    topic: 'Health',
    text: 'Maintaining a balanced lifestyle requires both regular physical exercise and sufficient sleep.',
    phoneticFocus: 'Sibilants and clusters in balanced, sufficient',
    expectedTotalDurationMs: 5300
  },
  {
    id: 'sh-med-06',
    difficulty: 'medium',
    topic: 'Media',
    text: 'People nowadays tend to verify breaking news across several independent platforms.',
    phoneticFocus: 'Linking and rhythm in independent platforms',
    expectedTotalDurationMs: 4800
  },
  {
    id: 'sh-med-07',
    difficulty: 'medium',
    topic: 'Culture',
    text: 'Preserving traditional architecture helps younger generations appreciate their cultural heritage.',
    phoneticFocus: 'Stress on architecture (/ˈɑːkɪtektʃər/) and heritage',
    expectedTotalDurationMs: 5400
  },
  {
    id: 'sh-med-08',
    difficulty: 'medium',
    topic: 'Remote Work',
    text: 'Working remotely allows employees greater flexibility, provided they manage their schedules effectively.',
    phoneticFocus: 'Word stress: flexibility, schedules, effectively',
    expectedTotalDurationMs: 5600
  },

  // HARD (8 sentences)
  {
    id: 'sh-hard-01',
    difficulty: 'hard',
    topic: 'Globalization',
    text: 'While economic globalization has undoubtedly accelerated technological innovation, it has simultaneously widened regional inequalities.',
    phoneticFocus: 'Complex polysyllabic rhythm: undoubtedly, simultaneously, inequalities',
    expectedTotalDurationMs: 7200
  },
  {
    id: 'sh-hard-02',
    difficulty: 'hard',
    topic: 'Science & Ethics',
    text: 'Scientific breakthroughs must be accompanied by rigorous ethical frameworks to prevent unintended societal consequences.',
    phoneticFocus: 'Clusters and stress: breakthroughs, rigorous, societal, consequences',
    expectedTotalDurationMs: 6900
  },
  {
    id: 'sh-hard-03',
    difficulty: 'hard',
    topic: 'Public Policy',
    text: 'Sustainable urban infrastructure depends on long-term collaboration between municipal authorities and private enterprises.',
    phoneticFocus: 'Primary stress shifts: sustainable, infrastructure, municipal',
    expectedTotalDurationMs: 6800
  },
  {
    id: 'sh-hard-04',
    difficulty: 'hard',
    topic: 'Psychology',
    text: 'Individuals who consistently step outside their comfort zones tend to demonstrate remarkable psychological resilience.',
    phoneticFocus: 'Connected speech and stress on psychological resilience',
    expectedTotalDurationMs: 6700
  },
  {
    id: 'sh-hard-05',
    difficulty: 'hard',
    topic: 'Economics',
    text: 'Fluctuations in international commodity markets can disproportionately affect developing economies.',
    phoneticFocus: 'Polysyllabic articulation: disproportionately (/ˌdɪsprəˈpɔːʃənətli/)',
    expectedTotalDurationMs: 6300
  },
  {
    id: 'sh-hard-06',
    difficulty: 'hard',
    topic: 'Linguistics',
    text: 'Acquiring native-like prosody requires paying close attention to subtle variations in pitch, rhythm, and syllable duration.',
    phoneticFocus: 'Prosodic phrasing across list items',
    expectedTotalDurationMs: 7100
  },
  {
    id: 'sh-hard-07',
    difficulty: 'hard',
    topic: 'Climate Policy',
    text: 'Without decisive international legislation, biodiversity loss will continue to accelerate at an unprecedented rate.',
    phoneticFocus: 'Stress on biodiversity and unprecedented (/ʌnˈpresɪdentɪd/)',
    expectedTotalDurationMs: 6600
  },
  {
    id: 'sh-hard-08',
    difficulty: 'hard',
    topic: 'Higher Education',
    text: 'Interdisciplinary research encourages scholars to synthesize perspectives from seemingly unrelated academic disciplines.',
    phoneticFocus: 'Articulation of interdisciplinary and synthesize',
    expectedTotalDurationMs: 6800
  }
];

export function normalizeWord(raw: string): string {
  return raw.normalize('NFKC')
    .replace(/[’‘ʼ´`]/gu, "'")
    .replace(/[‐‑‒–—―−]/gu, '-')
    .replace(/[٠-٩۰-۹]/gu, digit => {
      const arabic = '٠١٢٣٤٥٦٧٨٩'.indexOf(digit);
      return String(arabic >= 0 ? arabic : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit));
    })
    .toLocaleLowerCase()
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')
    .trim();
}

export function tokenizeSentenceWords(text: string): { display: string; normalized: string }[] {
  return text
    .trim()
    .split(/\s+/)
    .map((display) => ({
      display,
      normalized: normalizeWord(display)
    }))
    .filter((w) => w.normalized.length > 0);
}

export function buildReferenceWordTimings(
  text: string,
  totalDurationMs = 4000
): ReferenceWordTiming[] {
  const tokens = tokenizeSentenceWords(text);
  if (tokens.length === 0) return [];

  const weights = tokens.map((t) => Math.max(2, t.normalized.length));
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);

  let cursorMs = 0;
  return tokens.map((token, idx) => {
    const share = weights[idx] / totalWeight;
    const duration = Math.max(140, Math.round(totalDurationMs * share));
    const entry: ReferenceWordTiming = {
      word: token.display,
      normalized: token.normalized,
      expectedStartMs: cursorMs,
      expectedDurationMs: duration
    };
    cursorMs += duration;
    return entry;
  });
}

export function getShadowingSentencesByDifficulty(
  difficulty?: ShadowingDifficulty
): ShadowingSentence[] {
  if (!difficulty) return BUILTIN_SHADOWING_SENTENCES;
  return BUILTIN_SHADOWING_SENTENCES.filter((s) => s.difficulty === difficulty);
}
