import type { SpokenWordToken } from './wordAlignment';

export interface FillerOccurrence {
  word: string;
  count: number;
}

export interface LinkerOccurrence {
  linker: string;
  count: number;
}

export interface IeltsAnswerMetrics {
  totalWords: number;
  durationSeconds: number;
  wordsPerMinute: number;
  speechDurationMs: number;
  pauseCount: number; // pauses >= 400ms
  longPauseCount: number; // pauses >= 1000ms
  totalPauseDurationMs: number;
  fillerCount: number;
  fillers: FillerOccurrence[];
  lexicalDiversity: number; // 0.0 - 1.0 (Type-Token Ratio)
  uniqueWordsCount: number;
  linkersCount: number;
  linkers: LinkerOccurrence[];
  repetitionCount: number;
}

export interface IeltsSessionMetricsSummary {
  totalAnswers: number;
  totalWords: number;
  totalDurationSeconds: number;
  overallWpm: number;
  totalPauses: number;
  totalLongPauses: number;
  averagePauseDurationMs: number;
  totalFillers: number;
  topFillers: FillerOccurrence[];
  averageLexicalDiversity: number;
  totalLinkers: number;
  topLinkers: LinkerOccurrence[];
  totalRepetitions: number;
}

const COMMON_FILLERS: string[] = [
  'um',
  'uh',
  'er',
  'ah',
  'like',
  'you know',
  'sort of',
  'kind of',
  'basically',
  'actually',
  'i mean'
];

const DISCOURSE_LINKERS: string[] = [
  'however',
  'furthermore',
  'moreover',
  'therefore',
  'on the other hand',
  'in contrast',
  'as a result',
  'for instance',
  'for example',
  'in my opinion',
  'from my perspective',
  'to be honest',
  'firstly',
  'secondly',
  'finally',
  'consequently',
  'nevertheless',
  'in addition',
  'whereas',
  'although',
  'despite'
];

function cleanWord(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9']/g, '');
}

export function computeAnswerSpeechMetrics(params: {
  transcript: string;
  durationMs: number;
  tokens?: SpokenWordToken[];
}): IeltsAnswerMetrics {
  const cleanTranscript = params.transcript.trim();
  const rawWords = cleanTranscript ? cleanTranscript.split(/\s+/).map(cleanWord).filter((w) => w.length > 0) : [];
  const totalWords = rawWords.length;
  const durationSeconds = Math.max(1, Math.round(params.durationMs / 1000));
  const wordsPerMinute = totalWords > 0 ? Math.round((totalWords / durationSeconds) * 60) : 0;

  // Lexical Diversity (Type-Token Ratio)
  const uniqueSet = new Set(rawWords);
  const uniqueWordsCount = uniqueSet.size;
  const lexicalDiversity = totalWords > 0 ? Number((uniqueWordsCount / totalWords).toFixed(2)) : 0;

  // Fillers detection
  const lowerText = cleanTranscript.toLowerCase();
  const fillerMap = new Map<string, number>();
  let totalFillers = 0;

  for (const filler of COMMON_FILLERS) {
    const regex = new RegExp(`\\b${filler}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches && matches.length > 0) {
      fillerMap.set(filler, matches.length);
      totalFillers += matches.length;
    }
  }

  const fillers: FillerOccurrence[] = Array.from(fillerMap.entries()).map(([word, count]) => ({
    word,
    count
  }));

  // Linkers / Discourse markers detection
  const linkerMap = new Map<string, number>();
  let totalLinkers = 0;

  for (const linker of DISCOURSE_LINKERS) {
    const regex = new RegExp(`\\b${linker}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches && matches.length > 0) {
      linkerMap.set(linker, matches.length);
      totalLinkers += matches.length;
    }
  }

  const linkers: LinkerOccurrence[] = Array.from(linkerMap.entries()).map(([linker, count]) => ({
    linker,
    count
  }));

  // Repetition detection (e.g. "I I went", "the the")
  let repetitionCount = 0;
  for (let i = 1; i < rawWords.length; i++) {
    if (rawWords[i] === rawWords[i - 1] && rawWords[i].length >= 1) {
      repetitionCount++;
    }
  }

  // Pause analysis from tokens (if timestamps are available)
  let pauseCount = 0;
  let longPauseCount = 0;
  let totalPauseDurationMs = 0;
  let speechDurationMs = params.durationMs;

  if (params.tokens && params.tokens.length > 1) {
    let measuredSpeech = 0;
    for (let i = 0; i < params.tokens.length; i++) {
      const cur = params.tokens[i];
      measuredSpeech += Math.max(60, cur.endMs - cur.startMs);
      if (i > 0) {
        const gap = cur.startMs - params.tokens[i - 1].endMs;
        if (gap >= 400) {
          pauseCount++;
          totalPauseDurationMs += gap;
          if (gap >= 1000) {
            longPauseCount++;
          }
        }
      }
    }
    speechDurationMs = measuredSpeech;
  } else if (params.durationMs > 3000 && totalWords > 0) {
    // Estimated pause heuristics when timestamps are not provided
    const estimatedSpeechMs = totalWords * 320;
    const diff = Math.max(0, params.durationMs - estimatedSpeechMs);
    if (diff > 800) {
      pauseCount = Math.min(8, Math.floor(diff / 800));
      longPauseCount = Math.min(3, Math.floor(diff / 1800));
      totalPauseDurationMs = diff;
    }
  }

  return {
    totalWords,
    durationSeconds,
    wordsPerMinute,
    speechDurationMs,
    pauseCount,
    longPauseCount,
    totalPauseDurationMs,
    fillerCount: totalFillers,
    fillers,
    lexicalDiversity,
    uniqueWordsCount,
    linkersCount: totalLinkers,
    linkers,
    repetitionCount
  };
}

export function aggregateIeltsSessionMetrics(
  metricsList: IeltsAnswerMetrics[]
): IeltsSessionMetricsSummary {
  if (metricsList.length === 0) {
    return {
      totalAnswers: 0,
      totalWords: 0,
      totalDurationSeconds: 0,
      overallWpm: 0,
      totalPauses: 0,
      totalLongPauses: 0,
      averagePauseDurationMs: 0,
      totalFillers: 0,
      topFillers: [],
      averageLexicalDiversity: 0,
      totalLinkers: 0,
      topLinkers: [],
      totalRepetitions: 0
    };
  }

  const totalWords = metricsList.reduce((acc, m) => acc + m.totalWords, 0);
  const totalDurationSeconds = metricsList.reduce((acc, m) => acc + m.durationSeconds, 0);
  const totalPauses = metricsList.reduce((acc, m) => acc + m.pauseCount, 0);
  const totalLongPauses = metricsList.reduce((acc, m) => acc + m.longPauseCount, 0);
  const totalPauseDurationMs = metricsList.reduce((acc, m) => acc + m.totalPauseDurationMs, 0);
  const totalFillers = metricsList.reduce((acc, m) => acc + m.fillerCount, 0);
  const totalLinkers = metricsList.reduce((acc, m) => acc + m.linkersCount, 0);
  const totalRepetitions = metricsList.reduce((acc, m) => acc + m.repetitionCount, 0);

  const overallWpm =
    totalDurationSeconds > 0 ? Math.round((totalWords / totalDurationSeconds) * 60) : 0;
  const averagePauseDurationMs =
    totalPauses > 0 ? Math.round(totalPauseDurationMs / totalPauses) : 0;
  const averageLexicalDiversity = Number(
    (metricsList.reduce((acc, m) => acc + m.lexicalDiversity, 0) / metricsList.length).toFixed(2)
  );

  // Combine top fillers
  const fillerMap = new Map<string, number>();
  for (const m of metricsList) {
    for (const f of m.fillers) {
      fillerMap.set(f.word, (fillerMap.get(f.word) ?? 0) + f.count);
    }
  }
  const topFillers = Array.from(fillerMap.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);

  // Combine top linkers
  const linkerMap = new Map<string, number>();
  for (const m of metricsList) {
    for (const l of m.linkers) {
      linkerMap.set(l.linker, (linkerMap.get(l.linker) ?? 0) + l.count);
    }
  }
  const topLinkers = Array.from(linkerMap.entries())
    .map(([linker, count]) => ({ linker, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalAnswers: metricsList.length,
    totalWords,
    totalDurationSeconds,
    overallWpm,
    totalPauses,
    totalLongPauses,
    averagePauseDurationMs,
    totalFillers,
    topFillers,
    averageLexicalDiversity,
    totalLinkers,
    topLinkers,
    totalRepetitions
  };
}
