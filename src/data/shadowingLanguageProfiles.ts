import type { ShadowingLanguageCode } from './shadowingLanguages';

export interface ShadowingLanguageProfile {
  register: string;
  orthography: string;
  foci: readonly string[];
}

export const SHADOWING_LANGUAGE_PROFILES: Record<ShadowingLanguageCode, ShadowingLanguageProfile> = {
  en: { register: 'Natural everyday spoken English, neutral register.', orthography: 'Standard spelling; natural contractions.', foci: ['weak forms', 'linking', 'stress timing', 'schwa', 'final consonant clusters', 'th sounds', 'word stress', 'intonation', 'voicing contrasts', 'vowel reduction'] },
  sv: { register: 'Natural spoken standard Swedish.', orthography: 'Standard Swedish spelling.', foci: ['tonal accent 1', 'tonal accent 2', 'vowel length', 'sj sound', 'tj sound', 'retroflex consonants', 'rounded y', 'rounded u', 'word stress', 'consonant clusters'] },
  de: { register: 'Natural spoken Standard German.', orthography: 'Standard German spelling and umlauts.', foci: ['ich-Laut', 'ach-Laut', 'umlauts', 'final devoicing', 'vowel length', 'word stress', 'consonant clusters', 'glottal onset', 'r vocalisation', 'compound stress'] },
  fr: { register: 'Natural spoken metropolitan French.', orthography: 'Standard French spelling and accents.', foci: ['liaison', 'nasal vowels', 'u versus ou', 'mute e', 'rhythm groups', 'enchaînement', 'French r', 'word-final consonants', 'vowel rounding', 'intonation'] },
  es: { register: 'Natural spoken neutral Spanish.', orthography: 'Standard Spanish spelling and accents.', foci: ['tap versus trill r', 'spirant b', 'spirant d', 'spirant g', 'sinalefa', 'diphthongs', 'word stress', 'vowel clarity', 'j sound', 'intonation'] },
  it: { register: 'Natural spoken Italian.', orthography: 'Standard Italian spelling.', foci: ['gemination', 'open e', 'closed e', 'open o', 'closed o', 'syntactic doubling', 'gli', 'gn', 'word stress', 'vowel clarity'] },
  nl: { register: 'Natural spoken standard Dutch.', orthography: 'Standard Dutch spelling.', foci: ['g sound', 'ch sound', 'ui diphthong', 'eu diphthong', 'ij diphthong', 'schwa', 'vowel length', 'final devoicing', 'word stress', 'consonant clusters'] },
  pt: { register: 'Natural spoken Portuguese (pt-PT).', orthography: 'Standard pt-PT spelling.', foci: ['vowel reduction', 'nasal vowels', 'lh sound', 'nh sound', 'coda sibilants', 'open vowels', 'closed vowels', 'word stress', 'diphthongs', 'linking'] },
  ru: { register: 'Natural spoken standard Russian.', orthography: 'Standard Russian spelling; retain ё where needed.', foci: ['vowel reduction', 'palatalisation', 'word stress', 'consonant clusters', 'voicing assimilation', 'soft consonants', 'hard consonants', 'unstressed vowels', 'intonation', 'final devoicing'] },
  tr: { register: 'Natural spoken standard Turkish.', orthography: 'Standard Turkish spelling; dotted/dotless i.', foci: ['vowel harmony', 'dotted i', 'dotless ı', 'ö and ü', 'soft ğ', 'word stress', 'consonant length', 'vowel sequence', 'suffix linking', 'intonation'] },
  fa: { register: 'Natural conversational Persian, clear and widely understood.', orthography: 'Standard Persian spelling with correct ZWNJ.', foci: ['ezafe linking', 'colloquial contractions', 'q versus gh', 'kh sound', 'short vowels', 'long vowels', 'word stress', 'connected speech', 'consonant clusters', 'intonation'] },
  ar: { register: 'Readable spoken Modern Standard Arabic (MSA).', orthography: 'Arabic script; no harakat.', foci: ['emphatic consonants', 'ayn', 'ha', 'ghayn', 'qaf', 'shadda', 'vowel length', 'sun-letter assimilation', 'hamza', 'connected speech'] },
  zh: { register: 'Natural spoken Mandarin Chinese (simplified).', orthography: 'Simplified characters; no pinyin.', foci: ['four lexical tones', 'tone sandhi', 'zh versus z', 'ch versus c', 'sh versus s', 'aspiration', 'neutral tone', 'third-tone change', 'retroflex initials', 'finals'] },
  ja: { register: 'Natural spoken Japanese, neutral polite/casual.', orthography: 'Standard Japanese writing; no furigana/romaji.', foci: ['pitch accent', 'long vowels', 'geminates', 'mora timing', 'devoiced vowels', 'ん mora', 'voicing', 'sentence-final intonation', 'small ゃゅょ', 'rhythm'] },
  ko: { register: 'Natural spoken Korean.', orthography: 'Hangul spelling and spacing.', foci: ['plain consonants', 'tense consonants', 'aspirated consonants', 'batchim linking', 'nasalisation', 'liaison', 'batchim neutralisation', 'vowel contrasts', 'word stress rhythm', 'ending intonation'] }
};
