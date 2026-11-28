import type { ShadowingDifficulty, ShadowingSentence } from '../data/shadowingBank';
import { getTranslationLanguageLabel, renderTranslationLanguageOptions } from './shadowing/translationOptions';
import { escapeHtml } from './shared/html';
import {
  appendShadowingSet,
  getActiveShadowingSet,
  moveShadowingSet,
  selectShadowingSentence,
  type ShadowingSetHistory
} from '../services/shadowingSetHistory';
import {
  audioRecorder,
  type RecognizerAlternative,
  type RecordedUtterance
} from '../services/audioRecorder';
import {
  scoreShadowingOfflineTier3,
  scoreShadowingTier2,
  type ShadowingScoreReport
} from '../services/shadowingScorer';
import { recordLastShadowingAttempt } from '../services/shadowingTelemetry';
import { loadAppSettings, saveAppSettings, type AppSettings } from '../storage/appSettings';
import type { GlobalTierSummary } from '../services/tierManager';
import { clearPreloadedSentenceAudio, playAudioDataUrl, preloadSentenceAudio, speakSentenceWithTierFallback, stopAllTts } from '../services/ttsService';
import { activateShadowingAudioSet } from '../services/shadowingAudioStore';
import type { WordMatchStatus } from '../services/wordAlignment';
import { translateShadowingText, translateShadowingSentenceBatch, askGrammarFollowUp } from '../services/translationService';
import { analyzeWavBase64Vad, type WavVadAnalysisResult } from '../services/wavVadAnalyzer';
import { transcribeWithTier2WhisperOrFallback } from '../services/whisperSttService';
import { getCachedModelWordTimings } from '../services/modelTimingService';
import { generateAiShadowingSentenceBatch } from '../services/shadowingAiGenerator';
import { ShadowingPrefetchScheduler, runShadowingPrefetchBatch } from '../services/shadowingPrefetch';
import { attachScrollRail } from './scrollRail';
import { SHADOWING_LANGUAGES, getShadowingLanguage, countShadowingLanguageUnits, type ShadowingLanguageCode } from '../data/shadowingLanguages';
import { loadShadowingLanguageHistories, saveShadowingLanguageHistories, getShadowingHistoryForLanguage, createShadowingHistoryForLanguage, setShadowingHistoryForLanguage, loadSelectedShadowingLanguage, saveSelectedShadowingLanguage, type ShadowingLanguageHistories } from '../services/shadowingLanguageHistory';

const SX_ICON_PATHS = {
  language: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z',
  translate: 'M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z',
  layers: 'M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z',
  graphic_eq: 'M7 18h2V6H7v12zm4 4h2V2h-2v20zm-8-8h2v-4H3v4zm12 4h2V6h-2v12zm4-8v4h2v-4h-2z',
  auto_awesome: 'M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  chevron_left: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  chevron_right: 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  skip_previous: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
  skip_next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  play_arrow: 'M8 5v14l11-7z',
  stop: 'M6 6h12v12H6z',
  mic: 'M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  expand_more: 'M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z',
  volume_up: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  send: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z',
  slow_motion_video: 'M13.05 9.79L10 7.5v9l3.05-2.29L16 12zM11 4.07V2.05c-2.01.2-3.84 1-5.32 2.21L7.1 5.69c1.11-.86 2.44-1.44 3.9-1.62zM5.69 7.1L4.26 5.68C3.05 7.16 2.25 8.99 2.05 11h2.02c.18-1.46.76-2.79 1.62-3.9zM4.07 13H2.05c.2 2.01 1 3.84 2.21 5.32l1.43-1.43c-.86-1.1-1.44-2.43-1.62-3.89zm1.61 6.74C7.16 20.95 8.99 21.75 11 21.95v-2.02c-1.46-.18-2.79-.76-3.9-1.62l-1.42 1.43zM22 12c0 5.16-3.92 9.42-8.95 9.95v-2.02C16.95 19.44 20 16.07 20 12s-3.05-7.44-6.95-7.93V2.05C18.08 2.58 22 6.84 22 12z'
} as const;
type SxIconName = keyof typeof SX_ICON_PATHS;
/** Inline Material-style glyph; bundled as SVG so the redesigned page needs no icon font or network. */
function sxIcon(name: SxIconName, className = 'sx-icon'): string {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${SX_ICON_PATHS[name]}"/></svg>`;
}
const SX_TURTLE_SVG = '<svg class="sx-icon sx-icon-turtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10.2 6.8C10.2 4.6 10.9 3.2 12 3.2C13.1 3.2 13.8 4.6 13.8 6.8"/><ellipse cx="12" cy="13" rx="5" ry="6.2"/><path d="M12 6.8V19.2"/><path d="M7.3 11H16.7"/><path d="M7.5 15.2H16.5"/><path d="M7.6 9.5L4.4 7.4"/><path d="M16.4 9.5L19.6 7.4"/><path d="M7.8 16.8L4.8 19"/><path d="M16.2 16.8L19.2 19"/><path d="M12 19.2V21.3"/></svg>';
/** Status mark shown inside word chips; the volume glyph is revealed by CSS while the word is playing. */
function sxWordMark(status: WordMatchStatus, loading = false): string {
  const base = loading
    ? '<span class="sh-word-spinner" aria-hidden="true"></span>'
    : status === 'match' ? sxIcon('check', 'sx-icon sx-mark-icon')
      : status === 'mispronounced' ? '<b>!</b>'
        : status === 'missing' ? '<b>−</b>'
          : '<b>+</b>';
  return `<span class="sx-mark" aria-hidden="true"><span class="sx-mark-base">${base}</span>${sxIcon('volume_up', 'sx-icon sx-mark-icon sx-mark-vol')}</span>`;
}
function sxSpeedClass(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-');
}

interface ShadowingState {
  difficulty: ShadowingDifficulty;
  languageCode: ShadowingLanguageCode;
  topicInput: string;
  isGeneratingAi: boolean;
  aiGenerationError: string | null;
  index: number;
  customDrillText: string | null;
  drillWords: string[];
  drillPreviousStatuses: Record<string, { status: WordMatchStatus; accuracyScore: number }>;
  recognizedTranscript: string;
  recognizedConfidence: number;
  recognizedAlternatives: RecognizerAlternative[];
  recognizerError?: string;
  emptyAttemptError: string | null;
  lastRecording: RecordedUtterance | null;
  lastReport: ShadowingScoreReport | null;
  statusMessage: string;
  navigationNotice: string | null;
  activeModelPlayback: 'normal' | 'slow' | null;
  audioActivity: 'idle' | 'playingModel(normal)' | 'playingModel(slow)' | 'playingWord' | 'playingMine(normal)' | 'playingMine(slow)' | 'recording' | 'stopping/scoring';
  translationText: string;
  translationSourceText: string | null;
  translationTargetLanguage: string;
  autoPlayNextShadowing: boolean;
  autoTranslateSentenceSets: boolean;
  explainGrammarInTranslationLanguage: boolean;
  wordPlayback: { index: number; phase: 'loading' | 'playing' } | null;
  translationResult: string;
  grammarResult: string;
  grammarChatMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  grammarChatDraft: string;
  grammarChatBusy: boolean;
  grammarChatError: string | null;
  grammarChatToken: number;
  grammarScrollTop: number;
  grammarChatScrollTop: number;
  autoTranslationError: string | null;
  translationMode: 'translate' | 'grammar';
  translationStatus: string | null;
  translationStatusType: 'info' | 'pass' | 'fail';
  isTranslating: boolean;
  forceSpeechApiNotice: boolean;
  reportDetailsOpen: boolean;
  timingDetailsOpen: boolean;
  transcriptDetailsOpen: boolean;
}

const state: ShadowingState = {
  difficulty: 'easy',
  languageCode: 'en',
  topicInput: '',
  isGeneratingAi: false,
  aiGenerationError: null,
  index: 0,
  customDrillText: null,
  drillWords: [],
  drillPreviousStatuses: {},
  recognizedTranscript: '',
  recognizedConfidence: 0,
  recognizedAlternatives: [],
  recognizerError: undefined,
  emptyAttemptError: null,
  lastRecording: null,
  lastReport: null,
  statusMessage: 'Play the model audio, then record your repetition.',
  navigationNotice: null,
  activeModelPlayback: null,
  audioActivity: 'idle',
  translationText: '',
  translationSourceText: null,
  translationTargetLanguage: 'fa',
  autoPlayNextShadowing: false,
  autoTranslateSentenceSets: false,
  explainGrammarInTranslationLanguage: false,
  wordPlayback: null,
  translationResult: '',
  grammarResult: '',
  grammarChatMessages: [],
  grammarChatDraft: '',
  grammarChatBusy: false,
  grammarChatError: null,
  grammarChatToken: 0,
  grammarScrollTop: 0,
  grammarChatScrollTop: 0,
  autoTranslationError: null,
  translationMode: 'translate',
  translationStatus: null,
  translationStatusType: 'info',
  isTranslating: false,
  forceSpeechApiNotice: false,
  reportDetailsOpen: false,
  timingDetailsOpen: true,
  transcriptDetailsOpen: false
};

let sentenceSetHistory: ShadowingSetHistory | null = null;
let sentenceSetHistoryPromise: Promise<ShadowingSetHistory> | null = null;
let sentenceLanguageHistories: ShadowingLanguageHistories = {};
const SPEECH_API_NOTICE_DISMISSED_KEY = 'speakcoach_speech_api_notice_dismissed_v1';
const AUTOPLAY_NOTICE_DISMISSED_KEY = 'speakcoach_shadowing_autoplay_notice_dismissed_v1';
let autoPlayNoticeDismissedInSession = false;
function isAutoPlayNoticeDismissed(): boolean {
  if (autoPlayNoticeDismissedInSession) return true;
  try { return localStorage.getItem(AUTOPLAY_NOTICE_DISMISSED_KEY) === 'true'; }
  catch { return false; }
}
function dismissAutoPlayNotice(): void {
  autoPlayNoticeDismissedInSession = true;
  try { localStorage.setItem(AUTOPLAY_NOTICE_DISMISSED_KEY, 'true'); } catch { /* Keep it dismissed for this session if storage is unavailable. */ }
}
function isSpeechApiNoticeDismissed(): boolean {
  try { return localStorage.getItem(SPEECH_API_NOTICE_DISMISSED_KEY) === 'true'; }
  catch { return false; }
}
function isSpeechApiRelatedError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? '')).replace(/[_-]+/g, ' ');
  return /\b(api|http|status|401|403|404|408|409|429|5\d\d|network|fetch|timeout|endpoint|provider|model|unsupported|not supported|quota|rate.?limit|connection|service unavailable|cors|recognition service)\b/i.test(message);
}
function reopenSpeechApiNoticeForError(error: unknown): void {
  if (isSpeechApiRelatedError(error)) state.forceSpeechApiNotice = true;
}
async function persistCurrentShadowingHistory(): Promise<void> {
  if (!sentenceSetHistory) return;
  sentenceLanguageHistories = setShadowingHistoryForLanguage(sentenceLanguageHistories, state.languageCode, sentenceSetHistory);
  await saveShadowingLanguageHistories(sentenceLanguageHistories);
}
function ensureSentenceSetHistory(): Promise<ShadowingSetHistory> {
  if (!sentenceSetHistoryPromise) sentenceSetHistoryPromise = (async () => {
    sentenceLanguageHistories = await loadShadowingLanguageHistories();
    const appSettings = await loadAppSettings();
    state.difficulty = appSettings.shadowingDifficulty;
    state.translationTargetLanguage = appSettings.translationTargetLanguage;
    state.autoPlayNextShadowing = appSettings.autoPlayNextShadowing;
    state.autoTranslateSentenceSets = appSettings.autoTranslateSentenceSets;
    state.explainGrammarInTranslationLanguage = appSettings.explainGrammarInTranslationLanguage;
    state.languageCode = await loadSelectedShadowingLanguage();
    const existing = getShadowingHistoryForLanguage(sentenceLanguageHistories, state.languageCode);
    sentenceSetHistory = existing ?? createShadowingHistoryForLanguage(state.languageCode);
    if (!existing) await persistCurrentShadowingHistory();
    return sentenceSetHistory;
  })();
  return sentenceSetHistoryPromise;
}

let shadowingRecordingTimeout: ReturnType<typeof setTimeout> | null = null;
let shadowingModelPlaybackToken = 0;
let shadowingIsStopping = false;
let shadowingPrefetchWindowKey = '';
let shadowingActiveAudioSetId: string | null = null;
let shadowingPrefetchEpoch = 0;
let shadowingTier3FallbackNoticeShown = false;
const shadowingPrefetchScheduler = new ShadowingPrefetchScheduler();
let shadowingPrefetchQueue: Promise<void> = Promise.resolve();
let shadowingViewGeneration = 0;
const shadowingScrollRailCleanups = new WeakMap<HTMLElement, Array<() => void>>();
function clearShadowingScrollRails(container: HTMLElement): void {
  shadowingScrollRailCleanups.get(container)?.forEach(cleanup => cleanup());
  shadowingScrollRailCleanups.delete(container);
}
function registerShadowingScrollRail(container: HTMLElement, cleanup: (() => void) | null): void {
  if (!cleanup) return;
  const cleanups = shadowingScrollRailCleanups.get(container) ?? [];
  cleanups.push(cleanup);
  shadowingScrollRailCleanups.set(container, cleanups);
}
const shadowingTranslationRequests = new Set<string>();
const shadowingTranslationFailures = new Set<string>();
let shadowingSettingsSaveQueue: Promise<void> = Promise.resolve();

function clearShadowingRecordingTimer(): void {
  if (shadowingRecordingTimeout) clearTimeout(shadowingRecordingTimeout);
  shadowingRecordingTimeout = null;
}

function isAudioCaptureBusy(): boolean {
  return audioRecorder.isRecording() || shadowingIsStopping || state.audioActivity === 'recording' || state.audioActivity === 'stopping/scoring';
}
function isAudioPlaybackActive(): boolean {
  return state.audioActivity.startsWith('playing');
}
function setShadowingCaptureControlsDisabled(container: HTMLElement, disabled: boolean): void {
  container.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select').forEach(control => {
    if (control.id === 'sh-stop-score-btn') return;
    control.disabled = disabled;
    control.setAttribute('aria-disabled', String(disabled));
  });
}

function clearAttemptState(): void {
  clearShadowingRecordingTimer();
  state.navigationNotice = null;
  state.recognizedTranscript = '';
  state.recognizedConfidence = 0;
  state.recognizedAlternatives = [];
  state.recognizerError = undefined;
  state.emptyAttemptError = null;
  state.lastRecording = null;
  state.lastReport = null;
}

function renderVadWaveformSection(vad?: WavVadAnalysisResult): string {
  if (!vad || vad.waveformBins.length === 0) return '';

  const barsHtml = vad.waveformBins
    .map((b) => {
      const hPct = Math.max(12, Math.round(b.amplitude * 100));
      return `<div class="vad-bar ${b.state}" data-vad-state="${b.state}" style="height: ${hPct}%" title="${b.startMs}-${b.endMs}ms (${b.state})"></div>`;
    })
    .join('');

  const pausesText =
    vad.midSentencePauses.length > 0
      ? vad.midSentencePauses
          .map((p, idx) => `#${idx + 1}: ${p.durationMs} ms`)
          .join(' · ')
      : 'None detected';
  const seconds = (ms: number): string => `${(ms / 1000).toFixed(2)}s`;

  return `
    <div class="vad-box sx-vad" id="sh-vad-summary">
      <div class="sx-vad-head">
        <span class="sx-vad-title">Waveform &amp; Voice Activity (Approximate)</span>
        <span class="tier-badge offline sx-vad-badge">Approximate VAD</span>
      </div>
      <p class="sx-mono" id="sh-vad-metrics">
        Speech: ${seconds(vad.speechDurationMs)} · Expected: ${seconds(vad.expectedDurationMs)} · Rate: ${Math.round(
          vad.speakingRateRatio * 100
        )}% · Lead: ${vad.leadingSilenceMs}ms · Trail: ${vad.trailingSilenceMs}ms
      </p>
      <p class="sx-pauses ${vad.midSentencePauses.length ? 'has-pauses' : ''}" id="sh-vad-pauses">
        Mid-Sentence Pauses (${vad.midSentencePauses.length}): ${pausesText}
      </p>
      <div class="vad-waveform" id="sh-vad-waveform">
        ${barsHtml}
      </div>
      <div class="sx-legend">
        <span><i class="sx-dot speech" aria-hidden="true"></i>Speech</span>
        <span><i class="sx-dot pause" aria-hidden="true"></i>Pause marker</span>
        <span><i class="sx-dot silence" aria-hidden="true"></i>Leading/Trailing silence</span>
      </div>
    </div>
  `;
}

function renderTranscriptDetailsHtml(altsHtml: string): string {
  return `
      <details class="sh-transcript-details sx-sub" data-sx-details="transcript" ${state.recognizerError || state.transcriptDetailsOpen ? 'open' : ''}>
        <summary><span>Transcript &amp; recognition details</span>${sxIcon('expand_more', 'sx-icon sx-chevron')}</summary>
        <div class="form-field sh-transcript-field sx-sub-body">
          <label class="form-label" for="sh-transcript-input">Recognized speech</label>
          <input
            type="text"
            class="form-input"
            id="sh-transcript-input"
            readonly
            placeholder="Your speech will appear here."
            value="${escapeHtml(state.recognizedTranscript)}"
          />
          <div class="card-subtitle sh-recognizer-meta" id="sh-recognizer-meta">
            Alternatives / Confidence: ${altsHtml}
            ${state.recognizerError ? ` · Recognizer Note: ${escapeHtml(state.recognizerError)}` : ''}
          </div>
        </div>
      </details>`;
}

function renderReportHtml(report: ShadowingScoreReport, hasRecording: boolean, drillMode = false, previousStatuses: Record<string, { status: WordMatchStatus; accuracyScore: number }> = {}, audioBusy = false, playbackActive = false, wordPlayback = false, transcriptDetailsHtml = ''): string {
  const isOfflineMode = report.activeTier.tier === 3 || report.activeTier.label === 'Basic offline';

  const chipsHtml = report.words
    .map((w, wordIndex) => {
      const text =
        w.status === 'extra' ? `+${w.spokenWord}` : w.referenceWord ?? w.spokenWord ?? '';
      const speedBadge =
        !drillMode && !isOfflineMode && w.speedLabel && !(w.status === 'match' && sxSpeedClass(w.speedLabel) === 'ok')
          ? `<span class="speed-tag ${w.speedLabel.replace(' ', '-')}">${w.speedLabel}</span>`
          : '';
      const durationText = !drillMode && !isOfflineMode && w.spokenDurationMs ? ` · ${w.spokenDurationMs}ms` : '';
      const previous = w.referenceWord ? previousStatuses[w.referenceWord] : undefined;
      const rank: Record<WordMatchStatus, number> = { missing: 0, mispronounced: 1, match: 2, extra: -1 };
      const currentQuality = rank[w.status] * 100 + w.accuracyScore;
      const previousQuality = previous ? rank[previous.status] * 100 + previous.accuracyScore : 0;
      const progress = drillMode && previous ? (currentQuality > previousQuality + 5 ? 'Improved' : currentQuality < previousQuality - 5 ? 'Needs work' : 'No change') : '';
      const meta =
        w.status === 'missing'
          ? 'missing'
          : w.status === 'extra'
            ? `extra${durationText}`
            : `${w.accuracyScore}%${durationText}`;
      const replayText = (w.referenceWord ?? w.spokenWord ?? '').trim();
      const activeWord = state.wordPlayback?.index === wordIndex;
      const loading = activeWord && state.wordPlayback?.phase === 'loading';
      return `
        <button type="button" class="word-chip sx-wchip ${w.status} ${activeWord ? 'sh-word-pending' : ''}" data-word-status="${w.status}" data-word-index="${wordIndex}" data-word-replay="${escapeHtml(replayText)}" ${loading ? 'aria-busy="true"' : ''} aria-label="Play pronunciation of ${escapeHtml(replayText)}" ${replayText && !audioBusy && (!playbackActive || (wordPlayback && activeWord)) ? '' : 'disabled'}>
          <span class="sx-wchip-top">${sxWordMark(w.status, loading)}<span class="sx-wchip-word">${escapeHtml(text)}</span></span>
          ${speedBadge}
          <span class="word-chip-meta">${meta}</span>${progress ? `<span class="drill-word-progress">${progress}</span>` : ""}
        </button>
      `;
    })
    .join('');

  const statusLabels: Record<WordMatchStatus, string> = { match: 'Match', mispronounced: 'Mispronounced', missing: 'Missing', extra: 'Extra' };
  const timingSectionHtml = isOfflineMode
    ? `<div class="status-box info sh-offline-timing-disabled" id="sh-offline-timing-disabled">
         ${sxIcon('info')} <span><strong>Word timing &amp; recording replay disabled in System SpeechRecognizer mode:</strong> Android's system SpeechRecognizer returns transcript text only to SpeakCoach in this mode; the OS recognition service controls audio processing and may require network access. Configure an online Whisper STT slot for recording replay and per-word timing.</span>
       </div>`
    : `<div class="timing-bars-list" id="sh-timing-bars">
         ${report.words
           .filter((w) => w.referenceWord)
           .map((w) => {
             const exp = w.expectedDurationMs ?? 300;
             const spk = w.spokenDurationMs ?? 0;
             const ratioPct = Math.min(220, Math.round((spk / Math.max(100, exp)) * 100));
             const barWidth = Math.min(100, Math.round((ratioPct / 180) * 100));
             const speedClass = w.speedLabel ? w.speedLabel.replace(' ', '-') : 'ok';
             const spokenTimes =
               w.spokenStartMs !== undefined
                 ? `Spoken: ${w.spokenStartMs}–${w.spokenEndMs ?? (w.spokenStartMs + spk)} ms (${spk} ms)`
                 : `Spoken: ${spk} ms`;
             const modelTimes = `Ref: ${w.expectedStartMs ?? 0}–${w.expectedEndMs ?? ((w.expectedStartMs ?? 0) + exp)} ms (${exp} ms)`;

             return `
               <div class="timing-row sx-timing-row">
                 <div class="timing-row-head">
                   <span class="sx-t-word"><strong>${escapeHtml(w.referenceWord ?? '')}</strong><span class="sx-t-status ${w.status}">${statusLabels[w.status]}</span></span>
                   ${w.speedLabel ? `<span class="speed-pill ${speedClass}">${w.speedLabel}</span>` : ''}
                 </div>
                 <p class="sx-mono sx-t-times">${spokenTimes} vs ${modelTimes} (${ratioPct}%)</p>
                 <div class="timing-track">
                   <div class="timing-fill ${speedClass}" style="width: ${barWidth}%"></div>
                 </div>
               </div>
             `;
           })
           .join('')}
       </div>`;

  const replayRecBtn = hasRecording
    ? `<button type="button" class="btn btn-secondary" id="sh-replay-my-audio-btn" ${audioBusy || (playbackActive && state.audioActivity !== 'playingMine(normal)') ? 'disabled' : ''}>
         ${sxIcon('play_arrow', 'sx-icon sx-icon-lg')}<span>Replay My Recording</span>
       </button>
       <button type="button" class="btn btn-secondary" id="sh-replay-my-slow-btn" ${audioBusy || (playbackActive && state.audioActivity !== 'playingMine(slow)') ? 'disabled' : ''}>
         ${sxIcon('slow_motion_video', 'sx-icon sx-icon-lg')}<span>My Recording Slow (0.75x)</span>
       </button>`
    : `<button type="button" class="btn btn-secondary" id="sh-replay-my-audio-btn" disabled title="No audio kept in System SpeechRecognizer mode">
         ${sxIcon('play_arrow', 'sx-icon sx-icon-lg')}<span>Replay My Recording (Disabled in Offline Mode)</span>
       </button>`;

  const timingBlock = drillMode ? '' : isOfflineMode
    ? `<div class="sx-sub-plain">${renderVadWaveformSection(report.vadAnalysis)}${timingSectionHtml}</div>`
    : `<details class="sh-timing-details sx-sub" data-sx-details="timing" ${state.timingDetailsOpen ? 'open' : ''}>
         <summary><span>Timing &amp; voice activity details</span>${sxIcon('expand_more', 'sx-icon sx-chevron')}</summary>
         <div class="sx-sub-body">
           ${renderVadWaveformSection(report.vadAnalysis)}
           ${timingSectionHtml}
         </div>
       </details>`;

  return `
    <details class="sx-report" data-sx-details="report" ${state.reportDetailsOpen ? 'open' : ''}>
      <summary class="sx-report-summary">
        <div class="sx-report-summary-copy">
          <h3 class="sx-report-title">Detailed Report</h3>
          <p class="sx-report-sub">Scored via <strong>${escapeHtml(report.activeTier.detailLabel)}</strong> · Overall Pace: <strong>${Math.round(
            report.overallPaceRatio * 100
          )}% (${report.overallPaceLabel})</strong></p>
        </div>
        ${sxIcon('expand_more', 'sx-icon sx-chevron')}
      </summary>
      <div id="sh-score-card" class="sh-score-card sx-report-body">
        ${
          report.approximateNotice
            ? `<div class="status-box info" id="sh-tier3-notice">${escapeHtml(report.approximateNotice)}</div>`
            : ''
        }

        <div class="score-metrics-grid ${drillMode ? 'sh-drill-metrics' : ''}">
          ${drillMode ? `
            <div class="metric-tile metric-tile-overall">
              <div class="metric-value" id="sh-pron-score">${report.pronunciationScore}</div>
              <div class="metric-label">Word match</div>
            </div>
          ` : `
            <div class="metric-tile metric-tile-overall"><div class="metric-value" id="sh-overall-score">${report.overallScore}</div><div class="metric-label">Overall score</div></div>
            <div class="metric-tile"><div class="metric-value" id="sh-pron-score">${report.pronunciationScore}</div><div class="metric-label">${report.activeTier.tier >= 2 ? 'Word match' : 'Pronunciation assessment'}</div></div>
            <div class="metric-tile"><div class="metric-value" id="sh-fluency-score">${report.fluencyScore}</div><div class="metric-label">Fluency${isOfflineMode ? ' (approx.)' : ''}</div></div>
            <div class="metric-tile"><div class="metric-value" id="sh-pace-score">${report.paceScore}</div><div class="metric-label">Pace${isOfflineMode ? ' (approx.)' : ''} (${report.overallPaceLabel})</div></div>
            <div class="metric-tile"><div class="metric-value" id="sh-complete-score">${report.completenessScore}%</div><div class="metric-label">Completeness</div></div>
          `}
        </div>

        <p class="word-replay-help" id="sh-word-replay-help">Tap any word below to hear its pronunciation separately.</p>
        <div class="word-tokens-wrap" id="sh-word-chips">
          ${chipsHtml}
        </div>

        <div class="btn-row sh-report-playback-actions">
          ${replayRecBtn}
        </div>

        ${timingBlock}
        ${transcriptDetailsHtml}
      </div>
    </details>
  `;
}

export function renderShadowingView(
  container: HTMLElement,
  summary: GlobalTierSummary
): () => void {
  const viewGeneration = ++shadowingViewGeneration;
  if (!sentenceSetHistory) {
    container.innerHTML = '<div class="shadowing-page shadowing-main-card"><p class="card-subtitle" role="status">Preparing your offline sentence library…</p></div>';
    void ensureSentenceSetHistory().then(history => {
      sentenceSetHistory = history;
      if (viewGeneration === shadowingViewGeneration) renderShadowingView(container, summary);
    }).catch(error => {
      if (viewGeneration !== shadowingViewGeneration) return;
      sentenceSetHistoryPromise = null;
      container.innerHTML = '<div class="shadowing-page shadowing-main-card"><div class="status-box fail" role="alert">Could not load the sentence library. Please restart the app and try again.</div></div>';
      console.error('[SpeakCoach] Shadowing history initialization failed.', error);
    });
    return () => { shadowingViewGeneration++; stopAllTts(); shadowingPrefetchWindowKey = ''; shadowingPrefetchScheduler.reset(); };
  }
  const activeHistory = sentenceSetHistory[state.difficulty];
  const activeSet = activeHistory.sets.length ? getActiveShadowingSet(sentenceSetHistory, state.difficulty) : undefined;
  state.index = activeHistory.activeSentenceIndex;
  const sentence: ShadowingSentence | undefined = activeSet?.sentences[state.index];
  const hasSentence = !!sentence;
  const targetText = state.customDrillText ?? sentence?.text ?? '';
  const translationSource = state.customDrillText ?? sentence?.text ?? '';
  if (state.translationSourceText !== translationSource) {
    state.translationSourceText = translationSource;
    state.translationText = translationSource;
    state.translationResult = '';
    state.grammarResult = '';
    state.grammarChatMessages = [];
    state.grammarChatDraft = '';
    state.grammarChatBusy = false;
    state.grammarChatError = null;
    state.grammarChatToken++;
    state.translationStatus = null;
    state.translationStatusType = 'info';
    state.autoTranslationError = null;
    state.grammarScrollTop = 0;
    state.grammarChatScrollTop = 0;
  }
  const persistShadowingSettings = (settings: Partial<AppSettings> = {}): Promise<AppSettings> => {
    const snapshot = {
      ...settings,
      autoPlayNextShadowing: state.autoPlayNextShadowing,
      autoTranslateSentenceSets: state.autoTranslateSentenceSets,
      explainGrammarInTranslationLanguage: state.explainGrammarInTranslationLanguage
    };
    const save = shadowingSettingsSaveQueue.then(() => saveAppSettings(snapshot));
    shadowingSettingsSaveQueue = save.then(() => undefined, () => undefined);
    return save;
  };
  const targetExpectedDurationMs = state.customDrillText
    ? Math.max(1200, countShadowingLanguageUnits(state.customDrillText, state.languageCode) * 480)
    : sentence?.expectedTotalDurationMs ?? 3500;
  const selectedLanguage = getShadowingLanguage(state.languageCode);
  const activeAudioSetId = activeSet ? `${state.languageCode}:${state.difficulty}:${activeSet.id}` : null;
  const audioSetContextPromise = activeAudioSetId
    ? activateShadowingAudioSet(activeAudioSetId, { createdAt: activeSet?.createdAt }).then(generation => ({ setId: activeAudioSetId, generation }))
    : Promise.resolve(null);
  // Stable identity is the persisted sentence-set ID, not view lifecycle or the first sentence.
  const prefetchWindowKey = `${activeAudioSetId ?? 'none'}:${state.customDrillText ?? ''}`;
  if (activeAudioSetId !== shadowingActiveAudioSetId) {
    shadowingActiveAudioSetId = activeAudioSetId;
    clearPreloadedSentenceAudio(); // Clear RAM-only entries only on a real active-set change.
  }
  if (prefetchWindowKey !== shadowingPrefetchWindowKey) {
    shadowingPrefetchWindowKey = prefetchWindowKey;
    shadowingPrefetchEpoch++;
    shadowingPrefetchScheduler.reset(0);
  }
  const enqueueShadowingPrefetch = (indices: number[]): void => {
    if (!activeSet || !indices.length) return;
    const queue = indices.map(index => activeSet.sentences[index]).filter((item): item is ShadowingSentence => Boolean(item));
    if (!queue.length) return;
    const queuedEpoch = shadowingPrefetchEpoch;
    shadowingPrefetchQueue = shadowingPrefetchQueue.then(async () => {
      if (queuedEpoch !== shadowingPrefetchEpoch) return;
      const context = await audioSetContextPromise;
      if (!context) return;
      const completed = await runShadowingPrefetchBatch(queue, async (item) => {
        if (queuedEpoch !== shadowingPrefetchEpoch) return false;
        const settings = await loadAppSettings();
        if (!settings.prefetchShadowingAudio) return false;
        return preloadSentenceAudio(item.text, {
          locale: selectedLanguage.locale,
          shadowingSetAudio: { ...context, kind: 'sentence' }
        });
      });
      if (queuedEpoch !== shadowingPrefetchEpoch) return;
      shadowingPrefetchScheduler.completeBatch(completed);
      // If the learner crossed the next position threshold while this serial
      // batch was running, release the next window now instead of waiting for
      // another practice score or user action.
      if (completed === queue.length && queuedEpoch === shadowingPrefetchEpoch) {
        const followUp = shadowingPrefetchScheduler.reachPosition(state.index, activeSet.sentences.length);
        if (followUp.length) enqueueShadowingPrefetch(followUp);
      }
    });
  };
  const startShadowingPrefetch = (): void => {
    if (!activeSet || state.customDrillText) return;
    void loadAppSettings().then(settings => {
      if (prefetchWindowKey !== shadowingPrefetchWindowKey || !settings.prefetchShadowingAudio) return;
      enqueueShadowingPrefetch(shadowingPrefetchScheduler.reachPosition(state.index, activeSet.sentences.length));
    }).catch(() => {
      // Fail closed: do not spend provider quota when the preference cannot be read.
    });
  };
  // The navigation belongs to the same app root as this view. Avoid a global
  // lookup, which can update another mounted app instance (or a stale test root).
  const ieltsNavButton = container.parentElement?.querySelector<HTMLButtonElement>('#nav-ielts') ?? null;
  if (ieltsNavButton) {
    // IELTS remains available regardless of the selected Shadowing language.
    ieltsNavButton.disabled = false;
    ieltsNavButton.title = 'IELTS practice';
    ieltsNavButton.removeAttribute('aria-disabled');
  }

  const isRec = audioRecorder.isRecording();
  const isStopping = shadowingIsStopping;
  const isCaptureBusy = isAudioCaptureBusy();
  const isPlaybackActive = isAudioPlaybackActive();
  const isWordPlayback = state.audioActivity === 'playingWord';
  const scoringTier = summary.slots.pronunciation_scoring;
  const ttsTier = summary.slots.voice_tts;
  const hasLanguageSentenceSet = activeHistory.sets.length > 0;

  const altsHtml =
    state.recognizedAlternatives.length > 0
      ? state.recognizedAlternatives
          .map((a) => `"${escapeHtml(a.transcript)}" (${Math.round(a.confidence * 100)}%)`)
          .join(' · ')
      : state.recognizedTranscript
        ? `"${escapeHtml(state.recognizedTranscript)}" (${Math.round(
            state.recognizedConfidence * 100
          )}%)`
        : 'None yet (starts empty on every attempt)';

  const drillMode = Boolean(state.customDrillText);
  const drillWords = state.lastReport?.words.filter(word => word.referenceWord) ?? [];
  const drillCorrect = drillWords.filter(word => word.status === 'match').length;
  const weakReferenceWords = [...new Set(state.lastReport?.words.filter(word => word.referenceWord && word.status !== 'match').map(word => word.referenceWord!) ?? [])];
  const remainingDrillWords = [...new Set(drillWords.filter(word => word.status !== 'match').map(word => word.referenceWord!).filter(Boolean))];
  const weakActionHtml = state.lastReport ? (drillMode
    ? remainingDrillWords.length
      ? `<div class="sh-retry-weak-actions"><button type="button" class="btn btn-primary" id="sh-retry-weak-btn" ${isCaptureBusy || isPlaybackActive ? 'disabled' : ''}>${sxIcon('mic')}<span>Retry remaining weak words</span> (<span>${remainingDrillWords.length}</span>)</button></div>`
      : '<p class="sh-drill-success" role="status">All target words matched.</p>'
    : weakReferenceWords.length
      ? `<div class="sh-retry-weak-actions"><button type="button" class="btn btn-primary" id="sh-retry-weak-btn" ${isCaptureBusy || isPlaybackActive ? 'disabled' : ''}>${sxIcon('mic')}<span>${weakReferenceWords.length === 1 ? 'Practice weak word' : 'Retry weak words'}</span> ${weakReferenceWords.length === 1 ? '' : `(<span>${weakReferenceWords.length}</span>)`}</button></div>`
      : '') : '';
  const resultStripHtml = state.lastReport ? `
    <div class="sh-result-strip sx-quick" role="group" aria-label="Latest recording result">
      <div class="sx-quick-head">
        <div class="sh-result-strip-score" role="status" aria-live="polite">
          ${drillMode ? `<strong>Correct words</strong><span id="sh-drill-correct-count">${drillCorrect} / ${drillWords.length}</span>` : `<strong>Score ${state.lastReport.overallScore}</strong><span>${state.lastReport.completenessScore}% complete · ${escapeHtml(state.lastReport.overallPaceLabel)} pace${state.lastReport.activeTier.tier >= 3 ? ' (approx.)' : ''}</span>`}
        </div>
        <span class="tier-badge ${state.lastReport.activeTier.label === 'Online AI' ? 'online' : 'offline'} sx-badge"><span class="tier-dot"></span>${escapeHtml(state.lastReport.activeTier.label)}</span>
      </div>
      <div class="sh-result-strip-words">${state.lastReport.words.map((word, wordIndex) => { const replayWord = (word.referenceWord || word.spokenWord || '').trim(); const activeWord = state.wordPlayback?.index === wordIndex; const loading = activeWord && state.wordPlayback?.phase === 'loading'; return `<button type="button" class="sh-result-chip ${word.status} ${activeWord ? 'sh-word-pending' : ''}" data-word-index="${wordIndex}" data-word-replay="${escapeHtml(replayWord)}" ${loading ? 'aria-busy="true"' : ''} aria-label="Play pronunciation of ${escapeHtml(replayWord)}" ${replayWord && !isCaptureBusy && (!isPlaybackActive || (isWordPlayback && activeWord)) ? '' : 'disabled'}>${sxWordMark(word.status, loading)}<span class="sx-chip-word">${escapeHtml(replayWord)}</span></button>`; }).join('')}</div>
      ${weakActionHtml}
      <p class="sh-result-replay-help">${drillMode ? 'Each chip shows the latest result for that target word.' : 'Tap a word to hear it. For more details and practice with difficult words, see Detailed Report below.'}</p>
      <!--SX_REPORT-->
    </div>` : '';
  const focusedControlId = container.contains(document.activeElement) ? (document.activeElement as HTMLElement | null)?.id : undefined;
  const focusedSelectionStart = document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement ? document.activeElement.selectionStart : null;
  const focusedSelectionEnd = document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement ? document.activeElement.selectionEnd : null;
  clearShadowingScrollRails(container);
  const setPosition = activeSet ? activeHistory.sets.findIndex(set => set.id === activeSet.id) + 1 : 0;
  const setTotal = activeHistory.sets.length;
  const transcriptDetailsHtml = renderTranscriptDetailsHtml(altsHtml);
  const reportHtml = state.lastReport
    ? renderReportHtml(state.lastReport, Boolean(state.lastRecording?.wavBase64), drillMode, state.drillPreviousStatuses, isCaptureBusy, isPlaybackActive, isWordPlayback, transcriptDetailsHtml)
    : '';
  const autoTranslationHtml = state.autoTranslateSentenceSets && hasSentence && !state.customDrillText
    ? `<div class="sh-auto-translation-card sx-translated" id="sh-auto-translation-card" dir="auto">${escapeHtml(sentence?.translations?.[state.translationTargetLanguage] ?? (state.autoTranslationError ?? 'Translating this sentence…'))}${!sentence?.translations?.[state.translationTargetLanguage] && state.autoTranslationError ? ' <button type="button" class="btn btn-secondary" id="sh-auto-translation-retry">Retry</button>' : ''}</div>`
    : '';
  const resultDetailsHtml = state.lastReport ? '' : `<section class="sh-result-details sx-result-details">${transcriptDetailsHtml}</section>`;
  const quickResultHtml = state.lastReport ? resultStripHtml.replace('<!--SX_REPORT-->', `<section class="sh-result-details sx-result-details">${reportHtml}</section>`) : '';
  container.innerHTML = `
    <div class="shadowing-page shadowing-main-card sx-page">
      <h1 class="sr-only shadowing-page-title">Shadowing Trainer</h1>
      ${ttsTier.reason ? `<p class="sh-provider-notice sx-notice sx-notice-info" role="status">Voice: <strong>${escapeHtml(ttsTier.label)}</strong> · ${escapeHtml(ttsTier.reason)}</p>` : ''}
      <div class="sh-language-picker-field sx-field">
        <label class="sh-language-picker-label" for="sh-language-select">${sxIcon('language')}<span>Practice language</span></label>
        <select class="form-select sh-language-select" id="sh-language-select" aria-label="Shadowing practice language" ${isCaptureBusy || state.isGeneratingAi ? "disabled" : ""}>
          ${SHADOWING_LANGUAGES.map(language => `<option value="${language.code}" ${language.code === state.languageCode ? 'selected' : ''}>${escapeHtml(language.nativeName)} — ${escapeHtml(language.label)}</option>`).join('')}
        </select>
      </div>
      <div class="sh-language-picker-field sx-field">
        <label class="sh-language-picker-label" for="sh-translation-language-global">${sxIcon('translate')}<span>Translation language</span></label>
        <select class="form-select sh-language-select" id="sh-translation-language-global" aria-label="Translation language" ${isCaptureBusy || state.isGeneratingAi ? 'disabled' : ''}>${renderTranslationLanguageOptions(state.translationTargetLanguage)}</select>
      </div>
      <section class="sh-sentence-set-details sx-card" aria-labelledby="sh-sentence-set-title">
        <div class="sh-sentence-set-heading section-heading sx-card-head">${sxIcon('layers', 'sx-icon sx-head-icon')}<h2 id="sh-sentence-set-title">Sentence Set</h2></div>
        <div class="pill-tabs shadowing-difficulty-tabs sx-tabs" role="group" aria-label="Sentence difficulty">
          <button type="button" class="pill-btn ${state.difficulty === 'easy' ? 'active' : ''}" data-diff="easy" aria-pressed="${state.difficulty === 'easy'}" ${isRec || isStopping ? 'disabled' : ''}>Easy</button>
          <button type="button" class="pill-btn ${state.difficulty === 'medium' ? 'active' : ''}" data-diff="medium" aria-pressed="${state.difficulty === 'medium'}" ${isRec || isStopping ? 'disabled' : ''}>Medium</button>
          <button type="button" class="pill-btn ${state.difficulty === 'hard' ? 'active' : ''}" data-diff="hard" aria-pressed="${state.difficulty === 'hard'}" ${isRec || isStopping ? 'disabled' : ''}>Hard</button>
          ${state.languageCode === 'en' ? `<button type="button" class="pill-btn ${state.difficulty === 'ielts' ? 'active' : ''}" data-diff="ielts" aria-pressed="${state.difficulty === 'ielts'}" ${isRec || isStopping ? 'disabled' : ''}>IELTS</button>` : ''}
        </div>

        <div class="sh-sentence-set-controls sx-set-controls">
          <div class="form-field sh-topic-field sx-topic">
            <label class="form-label" for="sh-topic-input">Topic (optional)</label>
            <input type="text" class="form-input sh-topic-input" id="sh-topic-input" maxlength="100" placeholder="e.g. Urban architecture or job interviews" value="${escapeHtml(state.topicInput)}" />
          </div>
          <div class="btn-row sh-generate-actions sx-actions">
            <button type="button" class="btn btn-primary sx-generate" id="sh-generate-ai-btn" title="Get new sentence set" ${state.isGeneratingAi || isRec || isStopping ? 'disabled' : ''} aria-busy="${state.isGeneratingAi}">
              ${state.isGeneratingAi ? '<span class="ielts-loading-spinner" aria-hidden="true"></span><span>Generating…</span>' : `${sxIcon('auto_awesome')}<span>New set</span>`}
            </button>
            <button type="button" class="btn btn-secondary sh-translation-toggle sx-square-btn ${state.autoTranslateSentenceSets ? 'is-on' : 'is-off'}" id="sh-auto-translate-toggle" aria-label="Translate new sentence sets automatically" title="Translate new sentence sets automatically" aria-pressed="${state.autoTranslateSentenceSets}" ${isRec || isStopping || state.isGeneratingAi ? 'disabled' : ''}>${sxIcon('translate', 'sx-icon sx-icon-lg')}</button>
            <div class="sh-history-controls sx-stepper" role="group" aria-label="Sentence set history">
              <span class="sh-history-caption sr-only">Set</span>
              <span id="sh-history-position" class="card-subtitle sh-history-position sx-stepper-badge">${setPosition}/${setTotal}</span>
              <div class="sh-history-arrows sx-stepper-arrows">
                <button type="button" class="btn btn-secondary sh-history-arrow" id="sh-history-prev-btn" aria-label="Older sentence set" title="Older sentence set" ${isRec || isStopping ? 'disabled' : ''} ${!activeSet || setPosition <= 1 ? 'disabled' : ''}>${sxIcon('chevron_left', 'sx-icon sx-icon-xl')}</button>
                <button type="button" class="btn btn-secondary sh-history-arrow" id="sh-history-next-btn" aria-label="Newer sentence set" title="Newer sentence set" ${isRec || isStopping ? 'disabled' : ''}>${sxIcon('chevron_right', 'sx-icon sx-icon-xl')}</button>
              </div>
            </div>
          </div>
          ${state.navigationNotice ? `<div class="sx-notice sx-notice-warn" role="status" aria-live="polite">${sxIcon('info')}<p>${escapeHtml(state.navigationNotice)}</p></div>` : ''}
          ${state.aiGenerationError ? `<div class="status-box fail ai-generation-error" id="sh-ai-generation-error" role="alert"><p>Could not generate a new sentence set. Check your connection and Question &amp; Sentence Generator API settings, then try again.</p><details><summary>Technical details</summary><p>${escapeHtml(state.aiGenerationError)}</p></details></div>` : ''}
        </div>
      </section>

      ${!hasLanguageSentenceSet ? `<div class="status-box info sh-empty-language-history sx-notice sx-notice-info" role="status"><p>There are no saved ${escapeHtml(selectedLanguage.label)} sentences yet. Generate a sentence set in this language to begin. Your English sentence history remains separate.</p> <button type="button" class="btn btn-primary" id="sh-empty-generate-btn">Generate now</button></div>` : ''}

      ${scoringTier.tier === 3 ? `<details class="offline-quality-notice shadowing-offline-notice" aria-label="Offline pronunciation accuracy notice">
        <summary><strong>Pronunciation accuracy notice</strong><span class="offline-quality-learn-more">Learn more</span></summary>
        <p>Offline feedback uses the device or browser speech recognizer and approximate word/timing checks. It is still useful for practising repetition, fluency and matching the target sentence, but it is not a precise pronunciation score. For more dependable transcription and word-level timing, connect and test an online speech-to-text provider in Slot 2 (for example, Groq Whisper when available for your account). This improves the information available to the practice feedback, but true phoneme-level pronunciation assessment requires a dedicated pronunciation-assessment service.</p>
      </details>` : ''}

      <section class="sx-card sx-exercise" aria-labelledby="sh-exercise-title">
        <div class="sh-sentence-set-heading section-heading sh-exercise-heading sx-card-head">${sxIcon('graphic_eq', 'sx-icon sx-head-icon')}<h2 id="sh-exercise-title">Exercise</h2></div>
        <div class="sx-ex-meta sh-ai-sentence-count">${state.customDrillText ? '<span class="sx-ex-topic">Weak-word drill</span>' : `<span class="sh-topic-caption sx-ex-topic" dir="auto">${escapeHtml(sentence?.topic ?? 'Offline practice')}</span><span class="sh-sentence-count sx-ex-count">${hasLanguageSentenceSet ? `${state.index + 1} / ${activeSet?.sentences.length ?? 0}` : 'No sentence set yet'}</span>`}</div>
        <p class="sh-focus-copy sx-focus">${
          state.customDrillText
            ? 'Weak-word practice is active — choose Full Sentence to return.'
            : `Focus: ${escapeHtml(sentence?.phoneticFocus ?? 'Generate a sentence to see its pronunciation focus')}`
        }</p>
        <div class="sentence-box sx-sentence" id="sh-target-text">${escapeHtml(targetText)}</div>

        <div class="btn-row sh-player-controls sx-player" role="group" aria-label="Sentence playback controls">
          <button type="button" class="btn btn-secondary sh-player-icon-btn sx-square-btn" id="sh-prev-btn" aria-label="Previous sentence" ${isCaptureBusy ? 'disabled' : ''} title="Previous sentence">${sxIcon('skip_previous', 'sx-icon sx-icon-xl')}</button>
          <button type="button" class="btn btn-primary sh-player-icon-btn sh-play-main-btn model-play-btn sx-play ${state.activeModelPlayback ? 'is-playing' : ''}" id="sh-play-normal-btn" ${hasSentence && (!isCaptureBusy || state.activeModelPlayback !== null) && (!isPlaybackActive || state.activeModelPlayback !== null) ? '' : 'disabled'} aria-label="${state.activeModelPlayback ? 'Stop model playback' : 'Play model at normal speed'}" title="${state.activeModelPlayback ? 'Stop playback' : 'Play model at normal speed'}" aria-busy="${Boolean(state.activeModelPlayback)}">
            ${state.activeModelPlayback ? sxIcon('stop', 'sx-icon sx-icon-xl') : sxIcon('play_arrow', 'sx-icon sx-icon-xl')}
          </button>
          <button type="button" class="btn btn-secondary sh-player-icon-btn sx-square-btn" id="sh-next-btn" aria-label="Next sentence" ${isCaptureBusy ? 'disabled' : ''} title="Next sentence">${sxIcon('skip_next', 'sx-icon sx-icon-xl')}</button>
          <button type="button" class="btn btn-secondary sh-player-icon-btn sh-slow-btn model-play-btn sx-square-btn ${state.activeModelPlayback === 'slow' ? 'is-playing' : ''}" id="sh-play-slow-btn" ${hasSentence && (!state.activeModelPlayback || state.activeModelPlayback === 'slow') && !isCaptureBusy && (!isPlaybackActive || state.audioActivity === 'playingModel(slow)') ? '' : 'disabled'} aria-label="Slow playback at 0.72 speed" title="Slow playback (0.72×)" aria-busy="${state.activeModelPlayback === 'slow'}">
            ${state.activeModelPlayback === 'slow' ? '<span class="model-play-spinner" aria-hidden="true"></span>' : SX_TURTLE_SVG}
          </button>
          <button type="button" class="btn btn-secondary sh-player-icon-btn sh-autoplay-toggle sx-square-btn" id="sh-autoplay-next-btn" aria-label="Auto-play" title="Auto-play" aria-pressed="${state.autoPlayNextShadowing}" ${isCaptureBusy || isStopping ? "disabled" : ""}>
            <svg class="icon-on sx-autoplay-svg" viewBox="0 0 24 24" aria-hidden="true" ${state.autoPlayNextShadowing ? "" : "style=\"display:none\""}>
              <rect x="2" y="6.5" width="20" height="11" rx="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
              <circle cx="16.5" cy="12" r="4" fill="currentColor"/>
              <path d="M15.4 10.3 18.2 12l-2.8 1.7z" fill="var(--on-accent)"/>
            </svg>
            <svg class="icon-off sx-autoplay-svg" viewBox="0 0 24 24" aria-hidden="true" ${state.autoPlayNextShadowing ? "style=\"display:none\"" : ""}>
              <rect x="2" y="6.5" width="20" height="11" rx="5.5" fill="none" stroke="currentColor" stroke-width="1.8" opacity=".6"/>
              <circle cx="7.5" cy="12" r="4" fill="currentColor" opacity=".6"/>
            </svg>
          </button>
        </div>
        ${!isAutoPlayNoticeDismissed() ? "<p class='sh-autoplay-notice sx-tip' id='sh-autoplay-notice' role='note'>When Auto-play is on, the next sentence plays automatically as soon as you move to it. Tap the Auto-play button to dismiss this tip.</p>" : ''}
        ${state.customDrillText ? `<div class="sh-drill-exit-actions"><button type="button" class="btn btn-secondary" id="sh-exit-drill-btn">Full Sentence</button></div>` : ''}

        <div class="btn-row sh-record-controls sx-record-row">
          <button type="button" class="btn btn-record sh-record-action sx-record ${isRec ? 'is-recording' : ''} ${isStopping ? 'is-stopping' : ''}" id="sh-record-btn" ${hasSentence && !isStopping && !isPlaybackActive ? '' : 'disabled'} aria-label="${isStopping ? 'Finishing recording' : isRec ? 'Stop recording and score repetition' : 'Start recording repetition'}" aria-pressed="${isRec ? 'true' : 'false'}">
            ${isStopping ? 'Wait…' : isRec ? '<span class="recording-led" aria-hidden="true"></span> Stop &amp; Score <span class="recording-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>' : `${sxIcon('mic', 'sx-icon sx-icon-lg')}<span>Record Repetition</span>`}
          </button>
          <button type="button" class="sh-record-action" id="sh-stop-score-btn" hidden aria-hidden="true" tabindex="-1" aria-label="Finish recording and score repetition"></button>
        </div>

        ${
          state.emptyAttemptError
            ? `<div class="status-box fail" id="sh-empty-error" role="alert">${escapeHtml(
                state.emptyAttemptError
              )}</div>`
            : `<div class="status-box info sx-status" id="sh-status-msg" role="status" aria-live="polite">${escapeHtml(state.statusMessage)}</div>`
        }

        ${quickResultHtml}
        ${resultDetailsHtml}
      </section>
    </div>

    <section class="card sh-translation-card sx-card" id="sh-translation-card" aria-labelledby="sh-translation-title">
      <div class="card-header sx-card-head">
        ${sxIcon('translate', 'sx-icon sx-head-icon')}<h2 class="card-title" id="sh-translation-title">Translation &amp; Grammar</h2>
      </div>
      ${autoTranslationHtml}
      <div class="form-field sx-source">
        <label class="form-label" for="sh-translation-input">Text to translate</label>
        <textarea class="form-input sh-translation-input" id="sh-translation-input" rows="2" maxlength="4000" placeholder="Edit the sentence or enter a single word, then translate or explore its grammar." ${state.isTranslating ? 'disabled' : ''}>${escapeHtml(state.translationText)}</textarea>
      </div>
      <div class="sh-translation-controls">
        <div class="sh-translation-actions">
          <button type="button" class="btn btn-secondary sh-translate-btn" id="sh-translate-btn" ${state.isTranslating ? 'disabled' : ''}>Translate</button>
          <div class="sh-grammar-button-group" role="group" aria-label="Grammar explanation options">
            <button type="button" class="btn btn-secondary sh-grammar-btn" id="sh-grammar-btn" ${state.isTranslating ? 'disabled' : ''}>Explain Grammar</button>
            <button type="button" class="sh-grammar-language-toggle ${state.explainGrammarInTranslationLanguage ? 'is-on' : 'is-off'}" id="sh-grammar-language-toggle" aria-label="Include translation in grammar explanation" title="Show translation" aria-pressed="${state.explainGrammarInTranslationLanguage}" ${state.isTranslating ? 'disabled' : ''}>${sxIcon('translate', 'sx-icon sx-icon-lg')}</button>
          </div>
        </div>
      </div>
      ${state.translationResult ? `<div class="sh-translation-result sx-result" id="sh-translation-result"><div class="form-label sr-only">Translation</div><p dir="auto">${escapeHtml(state.translationResult)}</p></div>` : ''}
      ${state.grammarResult ? `<div class="sh-translation-result sh-grammar-result sx-result" id="sh-grammar-result"><div class="form-label sr-only">Grammar explanation</div><div class="sh-scroll-field sh-grammar-scroll-shell"><div class="sh-grammar-scroll-body sh-scroll-body" id="sh-grammar-scroll-body" dir="auto">${escapeHtml(state.grammarResult).replace(/\n/g, "<br>")}</div><div class="sh-scroll-rail"><button type="button" class="sh-scroll-arrow is-up" id="sh-grammar-scroll-up" aria-label="Scroll grammar explanation up" title="Scroll up"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button><div class="sh-scroll-track" id="sh-grammar-scroll-track" role="scrollbar" aria-label="Grammar explanation scroll position" aria-controls="sh-grammar-scroll-body" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><div class="sh-scroll-thumb" id="sh-grammar-scroll-thumb"></div></div><button type="button" class="sh-scroll-arrow is-down" id="sh-grammar-scroll-down" aria-label="Scroll grammar explanation down" title="Scroll down"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg></button></div></div></div>
      <div class="sh-grammar-chat" id="sh-grammar-chat"><div class="sh-grammar-chat-heading sr-only"><strong>Ask a follow-up</strong><span>Continue the conversation about this explanation</span></div><div class="sh-scroll-field sh-grammar-chat-scroll-field"><div class="sh-grammar-chat-messages sh-scroll-body" id="sh-grammar-chat-messages" role="log" aria-live="polite" aria-relevant="additions">${state.grammarChatMessages.map(message => `<div class="sh-grammar-chat-message ${message.role}" dir="auto">${escapeHtml(message.content)}</div>`).join('')}${state.grammarChatBusy ? '<div class="sh-grammar-chat-thinking" role="status" aria-label="AI is responding"><span></span><span></span><span></span></div>' : ''}${state.grammarChatError ? `<div class="status-box fail" role="alert">${escapeHtml(state.grammarChatError)}</div>` : ''}</div><div class="sh-scroll-rail"><button type="button" class="sh-scroll-arrow is-up" id="sh-grammar-chat-scroll-up" aria-label="Scroll follow-up messages up" title="Scroll up"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button><div class="sh-scroll-track" id="sh-grammar-chat-scroll-track" role="scrollbar" aria-label="Follow-up messages scroll position" aria-controls="sh-grammar-chat-messages" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><div class="sh-scroll-thumb"></div></div><button type="button" class="sh-scroll-arrow is-down" id="sh-grammar-chat-scroll-down" aria-label="Scroll follow-up messages down" title="Scroll down"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg></button></div></div><div class="sh-grammar-chat-compose"><textarea class="form-input" id="sh-grammar-chat-input" aria-label="Ask a follow-up question" rows="1" maxlength="500" placeholder="Ask a follow-up question…" ${state.grammarChatBusy ? 'disabled' : ''}>${escapeHtml(state.grammarChatDraft)}</textarea><button type="button" class="sh-grammar-chat-send" id="sh-grammar-chat-send" aria-label="Send message" title="Send message" ${state.grammarChatBusy || !state.grammarChatDraft.trim() ? 'disabled' : ''}>${sxIcon('send', 'sx-icon sx-icon-lg')}</button></div></div>` : ''}
      ${state.translationStatus ? `<div class="status-box ${state.translationStatusType}" id="sh-translation-status" role="status" aria-live="polite">${escapeHtml(state.translationStatus)}</div>` : ''}
    </section>
      <details class="offline-quality-notice sh-api-capability-notice" id="sh-api-capability-notice" aria-label="Speech API capability notice" ${state.forceSpeechApiNotice ? '' : 'hidden'} ${state.forceSpeechApiNotice ? 'open' : ''}>
        <summary><strong>Speech API compatibility &amp; troubleshooting</strong></summary>
        <strong>Important: speech APIs have separate capabilities</strong>
        <p>Text-to-speech (TTS: text → audio) and speech-to-text (STT: audio → text) are independent services. An API configured for one does not automatically provide the other. If your selected API/model does not offer text-to-speech or speech-to-text, that missing capability is a limitation of the selected API—not a Shadowing bug, and SpeakCoach cannot add it. API 2 is only a backup/rotation account; it may use the same provider, model, or endpoint as API 1, so it is not necessarily a different capability or an independent fallback. If playback or transcription fails, check the selected provider, exact model name, endpoint path, and whether that API actually supports the required audio operation. A successful connection test alone may not prove both directions work.</p>
        <p>For custom OpenAI-compatible APIs, enter the exact model name supported by your gateway. The suggested model list is only a convenience, not a restriction. Your gateway must expose the matching <code>/audio/speech</code> or <code>/audio/transcriptions</code> endpoint.</p>
        <div class="btn-row"><button type="button" class="btn btn-primary" id="sh-api-open-settings-btn">Open API Settings</button><button type="button" class="btn btn-secondary sh-api-notice-dismiss" id="sh-api-notice-dismiss-btn">I understand</button></div>
      </details>
      <button type="button" class="btn btn-secondary sh-api-notice-toggle" id="sh-api-notice-toggle-btn" aria-controls="sh-api-capability-notice">ⓘ Troubleshooting</button>
  `;

  const grammarChatScrollOnRender = container.querySelector<HTMLElement>('#sh-grammar-chat-messages');
  if (grammarChatScrollOnRender) grammarChatScrollOnRender.scrollTop = state.grammarChatScrollTop;
  const grammarScrollOnRender = container.querySelector<HTMLElement>('#sh-grammar-scroll-body');
  if (grammarScrollOnRender) grammarScrollOnRender.scrollTop = state.grammarScrollTop;
  const grammarScrollField = container.querySelector<HTMLElement>('.sh-grammar-scroll-shell');
  if (grammarScrollField) {
    const rail = attachScrollRail(grammarScrollField, { root: container, observeMutations: true, onScroll: top => { state.grammarScrollTop = top; } });
    registerShadowingScrollRail(container, rail ? () => rail.destroy() : null);
  }
  const grammarChatScrollField = container.querySelector<HTMLElement>('.sh-grammar-chat-scroll-field');
  if (grammarChatScrollField) {
    const rail = attachScrollRail(grammarChatScrollField, { root: container, observeMutations: true, onScroll: top => { state.grammarChatScrollTop = top; } });
    registerShadowingScrollRail(container, rail ? () => rail.destroy() : null);
  }
  if (state.autoTranslateSentenceSets && sentence && activeSet && !state.customDrillText && !sentence.translations?.[state.translationTargetLanguage]) {
    const requestLanguageCode = state.languageCode;
    const requestDifficulty = state.difficulty;
    const requestTargetCode = state.translationTargetLanguage;
    const historyForRequest = sentenceSetHistory;
    const requestSetId = activeSet.id;
    const requestKey = `${requestSetId}:${sentence.id}:${requestTargetCode}`;
    if (!shadowingTranslationRequests.has(requestKey) && !shadowingTranslationFailures.has(requestKey)) {
      shadowingTranslationRequests.add(requestKey);
      const targetLanguage = getTranslationLanguageLabel(requestTargetCode);
      void translateShadowingText(sentence.text, targetLanguage).then(async result => {
        const savedSet = historyForRequest?.[requestDifficulty].sets.find(set => set.id === requestSetId);
        const savedSentence = savedSet?.sentences.find(item => item.id === sentence.id);
        if (savedSentence && historyForRequest) {
          savedSentence.translations = { ...(savedSentence.translations ?? {}), [requestTargetCode]: result.text };
          sentenceLanguageHistories = setShadowingHistoryForLanguage(sentenceLanguageHistories, requestLanguageCode, historyForRequest);
          await saveShadowingLanguageHistories(sentenceLanguageHistories);
          if (state.languageCode === requestLanguageCode && state.difficulty === requestDifficulty && state.translationTargetLanguage === requestTargetCode && container.isConnected) { state.autoTranslationError = null; renderShadowingView(container, summary); }
        }
      }).catch(error => {
        shadowingTranslationFailures.add(requestKey);
        if (state.languageCode === requestLanguageCode && state.difficulty === requestDifficulty && state.translationTargetLanguage === requestTargetCode && container.isConnected) { state.autoTranslationError = `Translation unavailable: ${error instanceof Error ? error.message : String(error)}`; renderShadowingView(container, summary); }
      }).finally(() => shadowingTranslationRequests.delete(requestKey));
    }
  }
  container.querySelectorAll<HTMLDetailsElement>('details[data-sx-details]').forEach(details => {
    details.addEventListener('toggle', () => {
      const key = details.dataset.sxDetails;
      if (key === 'report') state.reportDetailsOpen = details.open;
      else if (key === 'timing') state.timingDetailsOpen = details.open;
      else if (key === 'transcript') state.transcriptDetailsOpen = details.open;
    });
  });
  container.querySelector<HTMLButtonElement>('#sh-auto-translation-retry')?.addEventListener('click', () => {
    if (!activeSet || !sentence) return;
    shadowingTranslationFailures.delete(`${activeSet.id}:${sentence.id}:${state.translationTargetLanguage}`);
    state.autoTranslationError = null;
    renderShadowingView(container, summary);
  });
  if (focusedControlId) {
    const focusedControl = Array.from(container.querySelectorAll<HTMLElement>('[id]')).find(element => element.id === focusedControlId);
    focusedControl?.focus();
    if ((focusedControl instanceof HTMLTextAreaElement || focusedControl instanceof HTMLInputElement) && focusedSelectionStart !== null && focusedSelectionEnd !== null) {
      focusedControl.setSelectionRange(focusedSelectionStart, focusedSelectionEnd);
    }
  }
  if (isCaptureBusy) {
    container.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select').forEach(control => {
      if (control.id === 'sh-stop-score-btn' || (control.id === 'sh-record-btn' && isRec && !isStopping)) return;
      control.disabled = true;
      control.setAttribute('aria-disabled', 'true');
    });
  }

  if (isSpeechApiNoticeDismissed() && !state.forceSpeechApiNotice) {
    const notice = container.querySelector<HTMLDetailsElement>('.sh-api-capability-notice');
    if (notice) { notice.hidden = true; notice.open = false; }
    container.querySelector<HTMLButtonElement>('#sh-api-notice-toggle-btn')?.remove();
  }

  container.querySelector<HTMLButtonElement>('#sh-empty-generate-btn')?.addEventListener('click', () => {
    container.querySelector<HTMLButtonElement>('#sh-generate-ai-btn')?.click();
  });
    container.querySelector<HTMLButtonElement>('#sh-api-notice-toggle-btn')?.addEventListener('click', () => {
    const notice = container.querySelector<HTMLDetailsElement>('.sh-api-capability-notice');
    if (notice) { notice.hidden = false; notice.open = !notice.open; }
  });
    container.querySelector<HTMLButtonElement>('#sh-api-open-settings-btn')?.addEventListener('click', () => {
    window.dispatchEvent(new Event('speakcoach:open-settings'));
  });
  container.querySelector<HTMLDetailsElement>('.sh-api-capability-notice')?.querySelector<HTMLButtonElement>('#sh-api-notice-dismiss-btn')?.addEventListener('click', () => {
    try { localStorage.setItem(SPEECH_API_NOTICE_DISMISSED_KEY, 'true'); } catch { /* Dismiss for this render even if storage is unavailable. */ }
    state.forceSpeechApiNotice = false;
    container.querySelector('.sh-api-capability-notice')?.setAttribute('hidden', '');
    container.querySelector<HTMLButtonElement>('#sh-api-notice-toggle-btn')?.remove();
  });

  container.querySelector<HTMLSelectElement>('#sh-language-select')?.addEventListener('change', async event => {
    if (isAudioCaptureBusy() || isAudioPlaybackActive() || state.isGeneratingAi) return;
    const nextCode = (event.target as HTMLSelectElement).value as ShadowingLanguageCode;
    if (!SHADOWING_LANGUAGES.some(language => language.code === nextCode) || nextCode === state.languageCode) return;
    await persistCurrentShadowingHistory();
    state.languageCode = nextCode;
    if (nextCode !== 'en' && state.difficulty === 'ielts') { state.difficulty = 'easy'; await persistShadowingSettings({ shadowingDifficulty: 'easy' }); }
    await saveSelectedShadowingLanguage(nextCode);
    const nextHistory = getShadowingHistoryForLanguage(sentenceLanguageHistories, nextCode);
    sentenceSetHistory = nextHistory ?? createShadowingHistoryForLanguage(nextCode);
    if (!nextHistory) await persistCurrentShadowingHistory();
    state.index = sentenceSetHistory[state.difficulty].activeSentenceIndex;
    state.customDrillText = null;
    state.aiGenerationError = null;
    clearAttemptState();
    stopAllTts();
    renderShadowingView(container, summary);
  });

  container.querySelector<HTMLTextAreaElement>('#sh-translation-input')?.addEventListener('input', event => {
    state.translationText = (event.target as HTMLTextAreaElement).value;
    state.translationSourceText = state.translationText;
    state.translationResult = '';
    state.grammarResult = '';
    state.grammarChatMessages = [];
    state.grammarChatDraft = '';
    state.grammarChatBusy = false;
    state.grammarChatError = null;
    state.grammarChatToken++;
    state.grammarScrollTop = 0;
    state.grammarChatScrollTop = 0;
    state.translationStatus = null;
    container.querySelector('#sh-translation-result')?.remove();
    container.querySelector('#sh-grammar-result')?.remove();
    container.querySelector('#sh-translation-status')?.remove();
  });
  container.querySelector<HTMLSelectElement>('#sh-translation-language-global')?.addEventListener('change', event => {
    state.translationTargetLanguage = (event.target as HTMLSelectElement).value;
    void persistShadowingSettings({ translationTargetLanguage: state.translationTargetLanguage }).catch(error => {
      console.warn('[SpeakCoach] Could not save translation language preference.', error);
    });
    state.translationResult = '';
    state.translationStatus = null;
    state.autoTranslationError = null;
    state.grammarResult = '';
    state.grammarChatMessages = [];
    state.grammarChatDraft = '';
    state.grammarChatError = null;
    state.grammarChatToken++;
    renderShadowingView(container, summary);
  });
  container.querySelector<HTMLButtonElement>('#sh-autoplay-next-btn')?.addEventListener('click', () => {
    dismissAutoPlayNotice();
    state.autoPlayNextShadowing = !state.autoPlayNextShadowing;
    void persistShadowingSettings();
    renderShadowingView(container, summary);
  });
  container.querySelector<HTMLButtonElement>('#sh-auto-translate-toggle')?.addEventListener('click', () => {
    state.autoTranslateSentenceSets = !state.autoTranslateSentenceSets;
    void persistShadowingSettings();
    renderShadowingView(container, summary);
  });
  container.querySelector<HTMLButtonElement>('#sh-grammar-language-toggle')?.addEventListener('click', () => {
    state.explainGrammarInTranslationLanguage = !state.explainGrammarInTranslationLanguage;
    void persistShadowingSettings();
    renderShadowingView(container, summary);
  });
  const runTranslationAction = async (mode: 'translate' | 'grammar'): Promise<void> => {
    if (state.isTranslating) return;
    const textToTranslate = state.translationText.trim();
    const requestTargetLanguage = state.translationTargetLanguage;
    if (!textToTranslate) {
      state.translationStatus = 'Enter a word or sentence to translate.';
      state.translationStatusType = 'fail';
      renderShadowingView(container, summary);
      return;
    }
    state.isTranslating = true;
    state.translationMode = mode;
    state.translationResult = '';
    state.grammarResult = '';
    state.translationStatus = mode === 'grammar' ? 'Explaining grammar with the configured Translation API…' : 'Translating with the configured Translation API…';
    state.translationStatusType = 'info';
    renderShadowingView(container, summary);
    try {
      const targetLanguage = mode === 'grammar' && !state.explainGrammarInTranslationLanguage
        ? selectedLanguage.label
        : getTranslationLanguageLabel(requestTargetLanguage);
      const result = await translateShadowingText(textToTranslate, targetLanguage, undefined, mode);
      if (state.translationText.trim() === textToTranslate && state.translationTargetLanguage === requestTargetLanguage) {
        if (mode === 'grammar') {
          state.grammarScrollTop = 0;
          state.grammarResult = result.text;
          state.grammarChatMessages = [];
          state.grammarChatDraft = '';
          state.grammarChatError = null;
          state.grammarChatToken++;
        } else state.translationResult = result.text;
        state.translationStatus = `${mode === 'grammar' ? 'Grammar explanation' : 'Translation'} complete via ${result.providerName} (${result.account === 'secondary' ? 'API 2' : 'API 1'}).`;
        state.translationStatusType = 'pass';
      }
    } catch (error) {
      if (state.translationText.trim() === textToTranslate && state.translationTargetLanguage === requestTargetLanguage) {
        state.translationStatus = `Translation failed: ${error instanceof Error ? error.message : String(error)}`;
        state.translationStatusType = 'fail';
      }
    } finally {
      state.isTranslating = false;
      renderShadowingView(container, summary);
    }
  };
  container.querySelector<HTMLButtonElement>('#sh-translate-btn')?.addEventListener('click', () => { void runTranslationAction('translate'); });
  container.querySelector<HTMLButtonElement>('#sh-grammar-btn')?.addEventListener('click', () => { void runTranslationAction('grammar'); });
  const grammarChatInput = container.querySelector<HTMLTextAreaElement>('#sh-grammar-chat-input');
  const resizeGrammarChatInput = (): void => {
    if (!grammarChatInput) return;
    grammarChatInput.style.height = 'auto';
    grammarChatInput.style.height = `${Math.min(grammarChatInput.scrollHeight, 144)}px`;
  };
  resizeGrammarChatInput();
  grammarChatInput?.addEventListener('input', () => {
    state.grammarChatDraft = grammarChatInput.value.slice(0, 500);
    const send = container.querySelector<HTMLButtonElement>('#sh-grammar-chat-send');
    if (send) send.disabled = state.grammarChatBusy || !state.grammarChatDraft.trim();
    resizeGrammarChatInput();
  });
  grammarChatInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); container.querySelector<HTMLButtonElement>('#sh-grammar-chat-send')?.click(); }
  });
  const sendGrammarFollowUp = async (): Promise<void> => {
    const question = state.grammarChatDraft.trim();
    if (!question || state.grammarChatBusy || !state.grammarResult) return;
    const sentenceText = state.translationSourceText ?? state.translationText;
    const explanation = state.grammarResult;
    const explanationLanguage = state.explainGrammarInTranslationLanguage
      ? (getTranslationLanguageLabel(state.translationTargetLanguage))
      : selectedLanguage.label;
    state.grammarChatMessages = [...state.grammarChatMessages, { role: 'user', content: question }];
    state.grammarChatDraft = '';
    state.grammarChatBusy = true;
    state.grammarChatError = null;
    const requestToken = ++state.grammarChatToken;
    const messages = container.querySelector<HTMLElement>('#sh-grammar-chat-messages');
    messages?.querySelectorAll('[role="alert"]').forEach(node => node.remove());
    const input = container.querySelector<HTMLTextAreaElement>('#sh-grammar-chat-input');
    const send = container.querySelector<HTMLButtonElement>('#sh-grammar-chat-send');
    const appendMessage = (role: 'user' | 'assistant', content: string): void => {
      const bubble = document.createElement('div');
      bubble.className = `sh-grammar-chat-message ${role}`;
      bubble.dir = 'auto';
      bubble.textContent = content;
      messages?.appendChild(bubble);
    };
    appendMessage('user', question);
    const thinking = document.createElement('div');
    thinking.className = 'sh-grammar-chat-thinking';
    thinking.setAttribute('role', 'status');
    thinking.innerHTML = '<span></span><span></span><span></span>';
    messages?.appendChild(thinking);
    if (messages) { messages.scrollTop = messages.scrollHeight; state.grammarChatScrollTop = messages.scrollTop; }
    if (input) { input.value = ''; input.disabled = true; }
    if (send) send.disabled = true;
    try {
      const result = await askGrammarFollowUp({ sentence: sentenceText, practiceLanguage: selectedLanguage.label, explanationLanguage, explanation, history: state.grammarChatMessages.slice(-6), question });
      if (requestToken !== state.grammarChatToken || state.translationSourceText !== sentenceText) return;
      state.grammarChatMessages = [...state.grammarChatMessages, { role: 'assistant', content: result.text }];
      appendMessage('assistant', result.text);
    } catch (error) {
      if (requestToken !== state.grammarChatToken || state.translationSourceText !== sentenceText) return;
      state.grammarChatDraft = question;
      state.grammarChatError = `Could not send the follow-up: ${error instanceof Error ? error.message : String(error)}`;
      const errorNode = document.createElement('div');
      errorNode.className = 'status-box fail';
      errorNode.setAttribute('role', 'alert');
      errorNode.textContent = state.grammarChatError;
      messages?.appendChild(errorNode);
      state.grammarChatDraft = question;
      if (input) {
        input.value = question;
        input.disabled = false;
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 144)}px`;
      }
    } finally {
      if (requestToken === state.grammarChatToken) {
        state.grammarChatBusy = false;
        thinking.remove();
        if (input) input.disabled = false;
        if (send) send.disabled = !state.grammarChatDraft.trim();
        if (messages) { messages.scrollTop = messages.scrollHeight; state.grammarChatScrollTop = messages.scrollTop; }
        input?.focus();
      }
    }
  };
  container.querySelector<HTMLButtonElement>('#sh-grammar-chat-send')?.addEventListener('click', () => { void sendGrammarFollowUp(); });
  container.querySelectorAll<HTMLButtonElement>('[data-word-replay]').forEach(button => {
    button.addEventListener('click', async () => {
      const word = button.dataset.wordReplay?.trim();
      const wordIndex = Number(button.dataset.wordIndex ?? -1);
      if (!word) return;
      state.navigationNotice = null;
      if (state.audioActivity === 'playingWord') { shadowingModelPlaybackToken++; stopAllTts(); state.audioActivity = 'idle'; state.wordPlayback = null; state.statusMessage = 'Word playback stopped.'; renderShadowingView(container, summary); return; }
      if (isAudioCaptureBusy() || isAudioPlaybackActive() || button.disabled) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      const wordPlaybackToken = ++shadowingModelPlaybackToken;
      state.activeModelPlayback = null;
      stopAllTts();
      state.audioActivity = 'playingWord';
      state.wordPlayback = { index: wordIndex, phase: 'loading' };
      renderShadowingView(container, summary);
      try {
        const audioContext = await audioSetContextPromise;
        if (wordPlaybackToken !== shadowingModelPlaybackToken || state.audioActivity !== 'playingWord') return;
        const result = await speakSentenceWithTierFallback(word, {
          locale: selectedLanguage.locale,
          shadowingSetAudio: audioContext ? { ...audioContext, kind: 'extra' } : undefined,
          onPlaybackStart: () => {
            if (wordPlaybackToken !== shadowingModelPlaybackToken) return;
            state.wordPlayback = { index: wordIndex, phase: 'playing' };
            container.querySelectorAll<HTMLElement>(`[data-word-index=\"${wordIndex}\"]`).forEach(chip => { chip.classList.remove('sh-word-pending'); chip.classList.add('sh-word-playing'); chip.removeAttribute('aria-busy'); chip.querySelector('.sh-word-spinner')?.remove(); });
          }
        });
        state.statusMessage = `Played “${word}” via ${result.activeTier.detailLabel}.`;
      } catch (error) {
        reopenSpeechApiNoticeForError(error);
        console.error('[Shadowing] Word playback failed.', error);
      state.statusMessage = 'Audio playback failed. Check Voice / TTS settings and open Troubleshooting for help.';
      } finally {
        if (wordPlaybackToken === shadowingModelPlaybackToken && state.audioActivity === 'playingWord') {
          state.audioActivity = 'idle';
          state.wordPlayback = null;
          renderShadowingView(container, summary);
        }
      }
    });
  });

    container.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (isAudioCaptureBusy() || isAudioPlaybackActive()) return;
      const requestedDifficulty = (btn.dataset.diff as ShadowingDifficulty) || 'easy';
      if (requestedDifficulty === 'ielts' && state.languageCode !== 'en') return;
      state.difficulty = requestedDifficulty;
      void persistShadowingSettings({ shadowingDifficulty: state.difficulty }).catch(error => {
        console.warn('[SpeakCoach] Could not save Shadowing difficulty preference.', error);
      });
      state.index = sentenceSetHistory?.[state.difficulty].activeSentenceIndex ?? 0;
      state.customDrillText = null;
      state.aiGenerationError = null;
      clearAttemptState();
      renderShadowingView(container, summary);
    });
  });

  container.querySelector<HTMLInputElement>('#sh-topic-input')?.addEventListener('input', event => {
    state.topicInput = (event.target as HTMLInputElement).value;
  });

  container.querySelector<HTMLButtonElement>('#sh-generate-ai-btn')?.addEventListener('click', async () => {
    if (state.isGeneratingAi || isAudioCaptureBusy() || isAudioPlaybackActive()) return;
    state.isGeneratingAi = true;
    state.aiGenerationError = null;
    state.statusMessage = '';
    state.statusMessage = 'Generating 20 new practice sentences...';
    renderShadowingView(container, summary);
    try {
      const generated = await generateAiShadowingSentenceBatch(state.difficulty, 20, state.topicInput.trim(), undefined, state.languageCode);
      sentenceSetHistory = appendShadowingSet(sentenceSetHistory!, state.difficulty, generated);
      await persistCurrentShadowingHistory();
      if (state.autoTranslateSentenceSets) {
        const historyForBatch = sentenceSetHistory!;
        const languageForBatch = state.languageCode;
        const difficultyForBatch = state.difficulty;
        const targetCodeForBatch = state.translationTargetLanguage;
        const savedSetForBatch = getActiveShadowingSet(historyForBatch, difficultyForBatch);
        const setIdForBatch = savedSetForBatch.id;
        const batchKeys = savedSetForBatch.sentences.map(item => `${setIdForBatch}:${item.id}:${targetCodeForBatch}`);
        batchKeys.forEach(key => shadowingTranslationRequests.add(key));
        const targetLanguage = getTranslationLanguageLabel(targetCodeForBatch);
        void translateShadowingSentenceBatch(savedSetForBatch.sentences.map(item => item.text), targetLanguage).then(async translations => {
          const savedSet = historyForBatch[difficultyForBatch].sets.find(set => set.id === setIdForBatch);
          if (!savedSet) return;
          savedSet.sentences = savedSet.sentences.map((item, index) => ({ ...item, translations: { ...(item.translations ?? {}), [targetCodeForBatch]: translations[index] } }));
          sentenceLanguageHistories = setShadowingHistoryForLanguage(sentenceLanguageHistories, languageForBatch, historyForBatch);
          await saveShadowingLanguageHistories(sentenceLanguageHistories);
          if (state.languageCode === languageForBatch && state.difficulty === difficultyForBatch && state.translationTargetLanguage === targetCodeForBatch && sentenceSetHistory?.[difficultyForBatch].activeSetId === setIdForBatch && container.isConnected) { state.autoTranslationError = null; renderShadowingView(container, summary); }
        }).catch(error => {
          batchKeys.forEach(key => shadowingTranslationFailures.add(key));
          if (state.languageCode === languageForBatch && state.difficulty === difficultyForBatch && state.translationTargetLanguage === targetCodeForBatch && sentenceSetHistory?.[difficultyForBatch].activeSetId === setIdForBatch && container.isConnected) {
            state.autoTranslationError = 'Translation unavailable. Use Retry to translate this sentence separately.';
            state.statusMessage = `Sentences saved. Translation failed: ${error instanceof Error ? error.message : String(error)}`;
            renderShadowingView(container, summary);
          }
        }).finally(() => batchKeys.forEach(key => shadowingTranslationRequests.delete(key)));
      }
      state.index = 0;
      state.customDrillText = null;
      clearAttemptState();
      state.statusMessage = `Added a new set of 20 sentences by ${generated[0]?.providerName ?? 'AI'} to your history.`;
      state.aiGenerationError = null;
    } catch (error) {
      state.aiGenerationError = `AI sentence set generation failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error('[Shadowing] AI sentence-set generation failed.', error);
      state.statusMessage = 'The current sentence set was kept. Correct the issue above and try again.';
    } finally {
      state.isGeneratingAi = false;
      renderShadowingView(container, summary);
    }
  });

  container.querySelector<HTMLButtonElement>('#sh-history-prev-btn')?.addEventListener('click', async () => {
    if (!sentenceSetHistory || isAudioCaptureBusy() || isAudioPlaybackActive()) return;
    state.navigationNotice = null;
    sentenceSetHistory = moveShadowingSet(sentenceSetHistory, state.difficulty, -1);
    state.index = 0;
    state.customDrillText = null;
    state.aiGenerationError = null;
    clearAttemptState();
    await persistCurrentShadowingHistory();
    renderShadowingView(container, summary);
  });

  container.querySelector<HTMLButtonElement>('#sh-history-next-btn')?.addEventListener('click', async () => {
    if (!sentenceSetHistory || isAudioCaptureBusy() || isAudioPlaybackActive()) return;
    const entry = sentenceSetHistory[state.difficulty];
    const currentSetIndex = entry.sets.findIndex(set => set.id === entry.activeSetId);
    if (currentSetIndex >= entry.sets.length - 1) {
      state.navigationNotice = "You've reached the end of your generated sets. Generate a new set to continue.";
      renderShadowingView(container, summary);
      const generate = container.querySelector<HTMLButtonElement>('#sh-generate-ai-btn');
      generate?.classList.add('sh-attention');
      generate?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      window.setTimeout(() => generate?.classList.remove('sh-attention'), 2000);
      return;
    }
    state.navigationNotice = null;
    sentenceSetHistory = moveShadowingSet(sentenceSetHistory, state.difficulty, 1);
    state.index = 0;
    state.customDrillText = null;
    state.aiGenerationError = null;
    clearAttemptState();
    await persistCurrentShadowingHistory();
    renderShadowingView(container, summary);
  });

  container.querySelector<HTMLButtonElement>('#sh-prev-btn')?.addEventListener('click', async () => {
    if (isAudioCaptureBusy() || isAudioPlaybackActive()) return;
    state.navigationNotice = null;
    state.index = Math.max(0, state.index - 1);
    if (sentenceSetHistory) {
      sentenceSetHistory = selectShadowingSentence(sentenceSetHistory, state.difficulty, state.index);
      await persistCurrentShadowingHistory();
    }
    state.customDrillText = null;
    state.drillWords = [];
    state.drillPreviousStatuses = {};
    clearAttemptState();
    renderShadowingView(container, summary);
  });

  container.querySelector<HTMLButtonElement>('#sh-next-btn')?.addEventListener('click', async () => {
    if (isAudioCaptureBusy() || isAudioPlaybackActive()) return;
    if (!state.customDrillText && state.index >= (activeSet?.sentences.length ?? 0) - 1) {
      const entry = sentenceSetHistory?.[state.difficulty];
      const currentSetIndex = entry?.sets.findIndex(set => set.id === entry.activeSetId) ?? -1;
      if (entry && currentSetIndex >= 0 && currentSetIndex < entry.sets.length - 1) {
        sentenceSetHistory = moveShadowingSet(sentenceSetHistory!, state.difficulty, 1);
        state.statusMessage = `Moved to Set ${currentSetIndex + 2} of ${entry.sets.length}.`;
        state.index = 0;
        state.customDrillText = null;
        state.drillWords = [];
        state.drillPreviousStatuses = {};
        clearAttemptState();
        await persistCurrentShadowingHistory();
        startShadowingPrefetch();
        renderShadowingView(container, summary);
        if (state.autoPlayNextShadowing) window.setTimeout(() => { if (state.autoPlayNextShadowing && container.isConnected) container.querySelector<HTMLButtonElement>('#sh-play-normal-btn')?.click(); }, 0);
        const markers = container.querySelectorAll('#sh-history-position, .sh-sentence-set-summary');
        markers.forEach(marker => marker.classList.add('sh-set-flash'));
        window.setTimeout(() => markers.forEach(marker => marker.classList.remove('sh-set-flash')), 1200);
        return;
      }
      state.navigationNotice = "You've reached the end of your generated sets. Generate a new set to continue.";
      renderShadowingView(container, summary);
      const generate = container.querySelector<HTMLButtonElement>('#sh-generate-ai-btn');
      generate?.classList.add('sh-attention');
      generate?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      window.setTimeout(() => generate?.classList.remove('sh-attention'), 2000);
      return;
    }
    state.navigationNotice = null;
    state.index = Math.min(Math.max(0, (activeSet?.sentences.length ?? 1) - 1), state.index + 1);
    if (sentenceSetHistory) {
      sentenceSetHistory = selectShadowingSentence(sentenceSetHistory, state.difficulty, state.index);
      await persistCurrentShadowingHistory();
    }
    state.customDrillText = null;
    state.drillWords = [];
    state.drillPreviousStatuses = {};
    clearAttemptState();
    startShadowingPrefetch();
    renderShadowingView(container, summary);
    if (state.autoPlayNextShadowing) window.setTimeout(() => container.querySelector<HTMLButtonElement>('#sh-play-normal-btn')?.click(), 0);
  });

  container.querySelector<HTMLButtonElement>('#sh-exit-drill-btn')?.addEventListener('click', () => {
    if (isAudioCaptureBusy() || isAudioPlaybackActive()) return;
    state.customDrillText = null;
    state.drillWords = [];
    state.drillPreviousStatuses = {};
    clearAttemptState();
    startShadowingPrefetch();
    renderShadowingView(container, summary);
  });

  const playModelAudio = async (mode: 'normal' | 'slow'): Promise<void> => {
    if (isAudioCaptureBusy() || isAudioPlaybackActive()) return;
    state.navigationNotice = null;
    const playbackToken = ++shadowingModelPlaybackToken;
    state.activeModelPlayback = mode;
    state.audioActivity = mode === 'normal' ? 'playingModel(normal)' : 'playingModel(slow)';
    state.statusMessage = 'Generating audio…';
    renderShadowingView(container, summary);
    try {
      const rate = mode === 'normal' ? 1.0 : 0.72;
      const audioContext = await audioSetContextPromise;
      if (playbackToken !== shadowingModelPlaybackToken) return;
      const res = await speakSentenceWithTierFallback(targetText, {
        rate,
        locale: selectedLanguage.locale,
        shadowingSetAudio: audioContext ? { ...audioContext, kind: state.customDrillText || rate !== 1 ? 'extra' : 'sentence' } : undefined,
        onPlaybackStart: () => {
          if (playbackToken !== shadowingModelPlaybackToken) return;
          state.statusMessage = mode === 'normal' ? 'Playing model audio at normal speed…' : 'Playing model audio slowly…';
          renderShadowingView(container, summary);
          if (mode === 'normal') startShadowingPrefetch();
        }
      });
      if (playbackToken !== shadowingModelPlaybackToken) return;
      const offlineVoiceNote = res.activeTier.tier >= 3
        ? shadowingTier3FallbackNoticeShown
          ? ''
          : ` The basic offline system voice is being used. ${res.activeTier.reason ?? 'The online voice is not currently available.'} Open Settings → Voice/TTS to re-test the provider or configure API 2.`
        : res.activeTier.reason ? ` Notice: ${res.activeTier.reason}` : '';
      if (res.activeTier.tier >= 3) shadowingTier3FallbackNoticeShown = true;
      const playbackTierLabel = res.activeTier.tier >= 3 ? 'Basic offline' : res.activeTier.detailLabel;
      if (res.storageWarning) console.warn('[Shadowing] Audio played but could not be retained for offline replay.', res.storageWarning);
      state.statusMessage = mode === 'normal'
        ? `Played model audio via ${playbackTierLabel}${res.fromCache ? ' [Cached]' : ''}.${offlineVoiceNote}`
        : `Played slow model audio (0.72x) via ${playbackTierLabel}.${offlineVoiceNote}`;
    } catch (error) {
      if (playbackToken !== shadowingModelPlaybackToken) return;
      reopenSpeechApiNoticeForError(error);
      console.error('[Shadowing] Model playback failed.', error);
      state.statusMessage = 'Audio playback failed. Check Voice / TTS settings and open Troubleshooting for help.';
    } finally {
      if (playbackToken === shadowingModelPlaybackToken) {
        state.activeModelPlayback = null;
        state.audioActivity = 'idle';
        startShadowingPrefetch(); // Retry any batch deferred by user-initiated synthesis.
        renderShadowingView(container, summary);
      }
    }
  };

  container.querySelector<HTMLButtonElement>('#sh-play-normal-btn')?.addEventListener('click', () => {
    if (state.activeModelPlayback !== null) {
      shadowingModelPlaybackToken++;
      stopAllTts();
      state.activeModelPlayback = null;
      state.audioActivity = 'idle';
      state.statusMessage = 'Model playback stopped.';
      renderShadowingView(container, summary);
      return;
    }
    if (isAudioCaptureBusy() || isAudioPlaybackActive()) return;
    void playModelAudio('normal');
  });

  container.querySelector<HTMLButtonElement>('#sh-play-slow-btn')?.addEventListener('click', () => {
    state.navigationNotice = null;
    if (state.activeModelPlayback === 'slow') {
      shadowingModelPlaybackToken++;
      stopAllTts();
      state.activeModelPlayback = null;
      state.audioActivity = 'idle';
      state.statusMessage = 'Model playback stopped.';
      renderShadowingView(container, summary);
      return;
    }
    if (isAudioCaptureBusy() || isAudioPlaybackActive()) return;
    void playModelAudio('slow');
  });

  // Shadowing always uses its own pronunciation-scoring slot. Never borrow
  // the IELTS transcription API: the two features have independent providers,
  // keys, verification and fallback/rotation.
  const resolveShadowingSttSlotId = (): 'pronunciation_scoring' => 'pronunciation_scoring';

  container.querySelector<HTMLButtonElement>('#sh-record-btn')?.addEventListener('click', async () => {
    if (audioRecorder.isRecording()) {
      container.querySelector<HTMLButtonElement>('#sh-stop-score-btn')?.click();
      return;
    }
    if (isAudioCaptureBusy() || isAudioPlaybackActive()) return;
    const recordButton = container.querySelector<HTMLButtonElement>('#sh-record-btn');
    if (recordButton) recordButton.disabled = true;
    // User has begun a practice attempt; opportunistic audio prefetch may start now.
    startShadowingPrefetch();
    // Always reset transcript & previous report to EMPTY on every new recording attempt
    clearAttemptState();
    state.audioActivity = 'recording';
    const sttSlotId = resolveShadowingSttSlotId();
    const sttTier = summary.slots[sttSlotId];
    const isOnlineStt = sttTier.tier <= 2 && sttTier.label === 'Online AI';

    try {
      await audioRecorder.start(selectedLanguage.locale, { useOfflineRecognizer: !isOnlineStt, preferOffline: !isOnlineStt });
      if (viewGeneration !== shadowingViewGeneration) {
        if (audioRecorder.isRecording()) await audioRecorder.stop();
        state.audioActivity = 'idle';
        return;
      }
      clearShadowingRecordingTimer();
      // A 30-second ceiling comfortably covers long practice sentences while preventing runaway recording.
      // Trigger the same stop-and-score flow the user would invoke manually.
      shadowingRecordingTimeout = setTimeout(() => {
        shadowingRecordingTimeout = null;
        container.querySelector<HTMLButtonElement>('#sh-stop-score-btn')?.click();
      }, 30_000);
      state.statusMessage = isOnlineStt
        ? 'Recording 16 kHz WAV (Online STT mode)... Speak clearly, then tap "Stop & Score". Recording stops automatically after 30 seconds.'
        : 'Listening via device/browser speech recognition. The browser may use its own network speech service; SpeakCoach does not upload raw audio in this mode. Recording stops automatically after 30 seconds.';
    } catch (err) {
      state.audioActivity = 'idle';
      if (viewGeneration !== shadowingViewGeneration) return;
      console.error('[Shadowing] Microphone could not start.', err);
      state.statusMessage = 'Microphone could not start. Check microphone permission and try again.';
    }
    if (viewGeneration !== shadowingViewGeneration) return;
    renderShadowingView(container, summary);
  });

  container.querySelector<HTMLButtonElement>('#sh-stop-score-btn')?.addEventListener('click', async () => {
    if (shadowingIsStopping) return;
    shadowingIsStopping = true;
    state.audioActivity = 'stopping/scoring';
    setShadowingCaptureControlsDisabled(container, true);
    clearShadowingRecordingTimer();
    const visibleStopButton = container.querySelector<HTMLButtonElement>('#sh-record-btn');
    if (visibleStopButton) {
      visibleStopButton.disabled = true;
      visibleStopButton.classList.add('is-stopping');
      visibleStopButton.textContent = 'Wait…';
      visibleStopButton.setAttribute('aria-label', 'Finishing recording');
    }
    const rec = await audioRecorder.stop().catch((error) => {
      if (viewGeneration === shadowingViewGeneration) {
        shadowingIsStopping = false;
        state.audioActivity = 'idle';
        console.error('[Shadowing] Recording could not be stopped.', error);
        state.statusMessage = 'Recording could not be stopped. Please try again.';
        renderShadowingView(container, summary);
      }
      return null;
    });
    if (!rec || viewGeneration !== shadowingViewGeneration) {
      shadowingIsStopping = false;
      state.audioActivity = 'idle';
      if (viewGeneration === shadowingViewGeneration) renderShadowingView(container, summary);
      return;
    }
    state.lastRecording = rec;

    // Resolve the configured online speech provider (Azure, Whisper or Gemini), with API 2 and offline fallbacks.
    const sttSlotId = resolveShadowingSttSlotId();

    const sttOutcome = await transcribeWithTier2WhisperOrFallback({
      slotId: sttSlotId,
      wavBase64: rec.wavBase64,
      durationMs: rec.durationMs,
      offlineTranscript: rec.offlineTranscript,
      offlineConfidence: rec.offlineConfidence,
      referenceText: targetText,
      languageCode: state.languageCode,
      languageLocale: selectedLanguage.locale
    }).catch((error) => {
      if (viewGeneration === shadowingViewGeneration) {
        console.error('[Shadowing] Speech transcription failed.', error);
        state.statusMessage = 'Speech could not be transcribed. Check API Settings and try recording again. If the problem continues, open Diagnostics for technical information.';
      }
      return null;
    });
    if (!sttOutcome || viewGeneration !== shadowingViewGeneration) {
      shadowingIsStopping = false;
      state.audioActivity = 'idle';
      if (viewGeneration === shadowingViewGeneration) renderShadowingView(container, summary);
      return;
    }

    const rawRecognized = sttOutcome.transcript.trim();

    state.recognizedTranscript = rawRecognized;
    state.recognizedConfidence = rec.offlineConfidence;
    state.recognizedAlternatives = rec.offlineAlternatives;
    state.recognizerError = sttOutcome.error ?? rec.recognizerError;
    if (rec.recognizerError && isSpeechApiRelatedError(rec.recognizerError)) {
      reopenSpeechApiNoticeForError(rec.recognizerError);
    }

    // Never fall back to reference text! If recognizer returned empty/null/error, DO NOT score.
    if (!rawRecognized) {
      state.lastReport = null;
      state.emptyAttemptError = state.customDrillText
        ? 'No words were recognized for this weak-word drill. Your previous results are kept; retry when ready.'
        : 'No speech was recognized. Check microphone access and speech API settings, then record again.';

      await recordLastShadowingAttempt({
        referenceText: targetText,
        rawRecognizerText: '',
        recognizerConfidence: 0,
        recognizerAlternatives: [],
        recognizerError: rec.recognizerError,
        sttWordTimestamps: [],
        sttActiveTierLabel: sttOutcome.activeTier.detailLabel,
        report: null
      });
      await import('./DiagnosticsView').then(({ clearDiagnosticsCache }) => clearDiagnosticsCache());
      shadowingIsStopping = false;
      state.audioActivity = 'idle';
      renderShadowingView(container, summary);
      return;
    }

    state.emptyAttemptError = null;
    const vadAnalysis = rec.wavBase64
      ? analyzeWavBase64Vad(rec.wavBase64, targetExpectedDurationMs)
      : undefined;
    const modelTimings = state.languageCode === 'en' ? (await getCachedModelWordTimings(targetText)) ?? undefined : undefined;

    if (sttOutcome.activeTier.tier <= 2 && sttOutcome.words.length > 0) {
      state.lastReport = scoreShadowingTier2({
        referenceText: targetText,
        spokenTranscript: rawRecognized,
        spokenTokens: sttOutcome.words,
        spokenDurationMs: rec.durationMs,
        expectedDurationMs: targetExpectedDurationMs,
        activeTierOverride: sttOutcome.activeTier,
        vadAnalysis,
        referenceTimingsOverride: modelTimings,
        languageCode: state.languageCode
      });
    } else {
      state.lastReport = scoreShadowingOfflineTier3({
        referenceText: targetText,
        spokenTranscript: rawRecognized,
        spokenDurationMs: rec.durationMs,
        expectedDurationMs: targetExpectedDurationMs,
        confidence: rec.offlineConfidence,
        spokenTokensOverride: sttOutcome.words.length > 0 ? sttOutcome.words : undefined,
        activeTierOverride: scoringTier,
        vadAnalysis,
        referenceTimingsOverride: modelTimings,
        languageCode: state.languageCode
      });
    }

    await recordLastShadowingAttempt({
      referenceText: targetText,
      rawRecognizerText: rawRecognized,
      recognizerConfidence: rec.offlineConfidence,
      recognizerAlternatives: rec.offlineAlternatives,
      recognizerError: rec.recognizerError,
      sttWordTimestamps: sttOutcome.words,
      sttActiveTierLabel: sttOutcome.activeTier.detailLabel,
      report: state.lastReport
    });
    await import('./DiagnosticsView').then(({ clearDiagnosticsCache }) => clearDiagnosticsCache());

    state.statusMessage = `${sttOutcome.error ? `${sttOutcome.error} ` : ''}Scored recognizer output ("${rawRecognized}") against reference.`;
    shadowingIsStopping = false;
    state.audioActivity = 'idle';
    startShadowingPrefetch();
    renderShadowingView(container, summary);
  });

  const playMyRecording = async (mode: 'normal' | 'slow'): Promise<void> => {
    const activity = mode === 'normal' ? 'playingMine(normal)' : 'playingMine(slow)';
    state.navigationNotice = null;
    if (state.audioActivity === activity) {
      stopAllTts();
      state.audioActivity = 'idle';
      state.statusMessage = 'Recording playback stopped.';
      renderShadowingView(container, summary);
      return;
    }
    if (!state.lastRecording || isAudioCaptureBusy() || isAudioPlaybackActive()) return;
    state.audioActivity = activity;
    renderShadowingView(container, summary);
    try {
      await playAudioDataUrl(state.lastRecording.wavDataUrl, mode === 'normal' ? 1.0 : 0.75);
    } finally {
      if (state.audioActivity === activity) {
        state.audioActivity = 'idle';
        renderShadowingView(container, summary);
      }
    }
  };
  container.querySelector<HTMLButtonElement>('#sh-replay-my-audio-btn')?.addEventListener('click', () => { void playMyRecording('normal'); });
  container.querySelector<HTMLButtonElement>('#sh-replay-my-slow-btn')?.addEventListener('click', () => { void playMyRecording('slow'); });

  container.querySelector<HTMLButtonElement>('#sh-retry-weak-btn')?.addEventListener('click', () => {
    if (!state.lastReport || isAudioCaptureBusy() || isAudioPlaybackActive()) return;
    const words = [...new Set(state.lastReport.words.filter(word => word.referenceWord && word.status !== 'match').map(word => word.referenceWord!))];
    if (!words.length) return;
    state.drillPreviousStatuses = Object.fromEntries(state.lastReport.words.filter(word => word.referenceWord).map(word => [word.referenceWord!, { status: word.status, accuracyScore: word.accuracyScore }]));
    state.drillWords = words;
    state.customDrillText = words.join(' ');
    clearAttemptState();
    state.statusMessage = 'Focused Weak-Word Drill ready! Listen and repeat only your weak words.';
    renderShadowingView(container, summary);
  });

  // Release any position window reached from a saved starting position or a re-render.
  // The scheduler and in-flight map make this idempotent.
  void startShadowingPrefetch();

  // The main router invokes this when leaving Shadowing. Invalidate pending
  // async recording/scoring work before stopping native capture and playback.
  return () => {
    state.grammarChatToken++;
    state.grammarChatBusy = false;
    state.wordPlayback = null;
    shadowingViewGeneration++;
    clearShadowingRecordingTimer();
    shadowingModelPlaybackToken++;
    state.activeModelPlayback = null;
    state.audioActivity = 'idle';
    stopAllTts();
    shadowingPrefetchEpoch++;
    shadowingPrefetchWindowKey = '';
    shadowingPrefetchScheduler.reset();
    shadowingIsStopping = false;
    if (audioRecorder.isRecording()) {
      void audioRecorder.stop().catch((error) => {
        console.warn('[SpeakCoach] Could not stop Shadowing recording during navigation cleanup.', error);
      });
    }
  };
}

export async function pauseShadowingRecordingForBackground(): Promise<void> {
  clearShadowingRecordingTimer();
  const wasScoring = state.audioActivity === 'stopping/scoring';
  if (!wasScoring) shadowingIsStopping = false;
  shadowingModelPlaybackToken++;
  const wasPlayingAudio = isAudioPlaybackActive();
  state.activeModelPlayback = null;
  if (!wasScoring) state.audioActivity = 'idle';
  const wasRecording = audioRecorder.isRecording();
  if (wasScoring) return;
  if (!wasRecording && !wasPlayingAudio) return;
  stopAllTts();

  try {
    if (wasRecording) await audioRecorder.stop();
    state.statusMessage = wasPlayingAudio
      ? 'Audio playback stopped because SpeakCoach moved to the background. Play it again when you return.'
      : 'Recording stopped because SpeakCoach moved to the background. Start a new recording when you return.';
  } catch (error) {
    state.statusMessage = `Audio was interrupted in the background. Please try again. ${error instanceof Error ? error.message : ''}`.trim();
  }
}

export function resetShadowingViewState(): void {
  state.forceSpeechApiNotice = false;
  shadowingModelPlaybackToken++;
  stopAllTts();
  state.activeModelPlayback = null;
  state.audioActivity = 'idle';
  shadowingIsStopping = false;
  state.isGeneratingAi = false;
  state.aiGenerationError = null;
  clearShadowingRecordingTimer();
  state.index = sentenceSetHistory?.[state.difficulty].activeSentenceIndex ?? 0;
  state.topicInput = '';
  state.customDrillText = null;
  state.drillWords = [];
  state.drillPreviousStatuses = {};
  state.translationSourceText = null;
  state.translationText = '';
  state.translationResult = '';
  state.translationStatus = null;
  state.wordPlayback = null;
  state.isTranslating = false;
  clearAttemptState();
}
