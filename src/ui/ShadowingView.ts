import {
  getShadowingSentencesByDifficulty,
  type ShadowingDifficulty,
  type ShadowingSentence
} from '../data/shadowingBank';
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
import type { GlobalTierSummary } from '../services/tierManager';
import { playAudioDataUrl, speakSentenceWithTierFallback, stopAllTts } from '../services/ttsService';
import { translateShadowingText } from '../services/translationService';
import { analyzeWavBase64Vad, type WavVadAnalysisResult } from '../services/wavVadAnalyzer';
import { transcribeWithTier2WhisperOrFallback } from '../services/whisperSttService';
import { getCachedModelWordTimings } from '../services/modelTimingService';
import { generateAiShadowingSentenceBatch, type GeneratedShadowingSentence } from '../services/shadowingAiGenerator';
import { clearDiagnosticsCache } from './DiagnosticsView';

const SHADOWING_ACTIVE_SET_KEY = 'speakcoach_shadowing_active_set_v1';

interface ShadowingState {
  difficulty: ShadowingDifficulty;
  sourceMode: 'bank' | 'ai';
  aiSentence: GeneratedShadowingSentence | null;
  aiSentenceQueue: GeneratedShadowingSentence[];
  topicInput: string;
  isGeneratingAi: boolean;
  aiGenerationError: string | null;
  index: number;
  customDrillText: string | null;
  recognizedTranscript: string;
  recognizedConfidence: number;
  recognizedAlternatives: RecognizerAlternative[];
  recognizerError?: string;
  emptyAttemptError: string | null;
  lastRecording: RecordedUtterance | null;
  lastReport: ShadowingScoreReport | null;
  statusMessage: string;
  activeModelPlayback: 'normal' | 'slow' | null;
  translationText: string;
  translationSourceText: string | null;
  translationTargetLanguage: string;
  translationResult: string;
  translationStatus: string | null;
  translationStatusType: 'info' | 'pass' | 'fail';
  isTranslating: boolean;
}

const state: ShadowingState = {
  difficulty: 'easy',
  sourceMode: 'bank',
  aiSentence: null,
  aiSentenceQueue: loadSavedAiSentenceQueue(),
  topicInput: '',
  isGeneratingAi: false,
  aiGenerationError: null,
  index: 0,
  customDrillText: null,
  recognizedTranscript: '',
  recognizedConfidence: 0,
  recognizedAlternatives: [],
  recognizerError: undefined,
  emptyAttemptError: null,
  lastRecording: null,
  lastReport: null,
  statusMessage: 'Tap "Play Model 1.0x" to listen, then "Record Repetition" to repeat aloud.',
  activeModelPlayback: null,
  translationText: '',
  translationSourceText: null,
  translationTargetLanguage: 'fa',
  translationResult: '',
  translationStatus: null,
  translationStatusType: 'info',
  isTranslating: false,
};

const SHADOWING_RANDOM_TOPICS = ['Everyday communication', 'Travel and culture', 'Work and careers', 'Learning and education', 'Sustainable living', 'Technology in daily life', 'Friendship and relationships', 'Health and routines', 'Cities and communities', 'Nature and the environment'];

const TRANSLATION_LANGUAGES = [
  { code: 'fa', label: 'Persian (فارسی)' },
  { code: 'ar', label: 'Arabic (العربية)' },
  { code: 'de', label: 'German (Deutsch)' },
  { code: 'es', label: 'Spanish (Español)' },
  { code: 'fr', label: 'French (Français)' },
  { code: 'it', label: 'Italian (Italiano)' },
  { code: 'nl', label: 'Dutch (Nederlands)' },
  { code: 'pt', label: 'Portuguese (Português)' },
  { code: 'ru', label: 'Russian (Русский)' },
  { code: 'sv', label: 'Swedish (Svenska)' },
  { code: 'tr', label: 'Turkish (Türkçe)' },
  { code: 'zh', label: 'Chinese (简体中文)' },
  { code: 'ja', label: 'Japanese (日本語)' },
  { code: 'ko', label: 'Korean (한국어)' }
];

function renderTranslationLanguageOptions(selected: string): string {
  return TRANSLATION_LANGUAGES.map(language =>
    `<option value="${language.code}" ${language.code === selected ? 'selected' : ''}>${escapeHtml(language.label)}</option>`
  ).join('');
}

function loadSavedAiSentenceQueue(): GeneratedShadowingSentence[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SHADOWING_ACTIVE_SET_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.text === 'string' && typeof item.topic === 'string').slice(0, 20) : [];
  } catch { return []; }
}

function saveAiSentenceQueue(queue: GeneratedShadowingSentence[]): void {
  try { localStorage.setItem(SHADOWING_ACTIVE_SET_KEY, JSON.stringify(queue.slice(0, 20))); } catch { /* best effort */ }
}

let shadowingRecordingTimeout: ReturnType<typeof setTimeout> | null = null;
let shadowingModelPlaybackToken = 0;

function clearShadowingRecordingTimer(): void {
  if (shadowingRecordingTimeout) clearTimeout(shadowingRecordingTimeout);
  shadowingRecordingTimeout = null;
}

function clearAttemptState(): void {
  clearShadowingRecordingTimer();
  state.recognizedTranscript = '';
  state.recognizedConfidence = 0;
  state.recognizedAlternatives = [];
  state.recognizerError = undefined;
  state.emptyAttemptError = null;
  state.lastRecording = null;
  state.lastReport = null;
}

function getCurrentSentence(): ShadowingSentence {
  const list = getShadowingSentencesByDifficulty(state.difficulty);
  const safeIndex = ((state.index % list.length) + list.length) % list.length;
  return list[safeIndex];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
          .map((p, idx) => `#${idx + 1}: ${p.durationMs} ms (@${p.startMs}–${p.endMs} ms)`)
          .join(' · ')
      : 'None detected';

  return `
    <div class="vad-box" id="sh-vad-summary">
      <div class="card-header vad-report-header">
        <span class="slot-summary-title"><svg class="sh-inline-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h3l2-6 4 12 3-9 2 3h4"/></svg> Waveform &amp; Voice Activity (Approximate)</span>
        <span class="tier-badge offline">Approximate VAD</span>
      </div>
      <div class="card-subtitle" id="sh-vad-metrics">
        Speech: <strong>${vad.speechDurationMs} ms</strong> (Expected: ${vad.expectedDurationMs} ms · Rate: ${Math.round(
          vad.speakingRateRatio * 100
        )}% ${vad.speakingRateLabel}) ·
        Leading Silence: <strong>${vad.leadingSilenceMs} ms</strong> ·
        Trailing Silence: <strong>${vad.trailingSilenceMs} ms</strong>
      </div>
      <div class="card-subtitle vad-pauses" id="sh-vad-pauses">
        Mid-Sentence Pauses (${vad.midSentencePauses.length}): <strong>${pausesText}</strong>
      </div>
      <div class="vad-waveform" id="sh-vad-waveform">
        ${barsHtml}
      </div>
      <div class="card-subtitle vad-legend">
        Legend: <span class="vad-legend-speech">■ Speech</span> ·
        <span class="vad-legend-pause">■ Pause Marker</span> ·
        <span class="vad-legend-silence">■ Leading/Trailing Silence</span>
      </div>
    </div>
  `;
}

function renderReportHtml(report: ShadowingScoreReport, hasRecording: boolean): string {
  const isOfflineMode = report.activeTier.tier === 3 || report.activeTier.label === 'Basic offline';

  const chipsHtml = report.words
    .map((w) => {
      const text =
        w.status === 'extra' ? `+${w.spokenWord}` : w.referenceWord ?? w.spokenWord ?? '';
      const statusMark = w.status === 'match' ? '✓' : w.status === 'mispronounced' ? '!' : w.status === 'missing' ? '−' : '+';
      const speedBadge =
        !isOfflineMode && w.speedLabel
          ? `<span class="speed-tag ${w.speedLabel.replace(' ', '-')}">${w.speedLabel}</span>`
          : '';
      const durationText = !isOfflineMode && w.spokenDurationMs ? ` · ${w.spokenDurationMs}ms` : '';
      const meta =
        w.status === 'missing'
          ? 'missing'
          : w.status === 'extra'
            ? `extra${durationText}`
            : `${w.accuracyScore}%${durationText}`;
      const replayText = (w.referenceWord ?? w.spokenWord ?? '').trim();
      return `
        <button type="button" class="word-chip ${w.status}" data-word-status="${w.status}" data-word-replay="${escapeHtml(replayText)}" aria-label="Play pronunciation of ${escapeHtml(replayText)}" ${replayText ? '' : 'disabled'}>
          <span class="word-chip-status" aria-hidden="true">${statusMark}</span>
          <span>${escapeHtml(text)}</span>
          ${speedBadge}
          <span class="word-chip-meta">${meta}</span>
        </button>
      `;
    })
    .join('');

  const timingSectionHtml = isOfflineMode
    ? `<div class="status-box info sh-offline-timing-disabled" id="sh-offline-timing-disabled">
         <svg class="sh-inline-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></svg> <strong>Word timing &amp; recording replay disabled in System SpeechRecognizer mode:</strong> Android's system SpeechRecognizer returns transcript text only to SpeakCoach in this mode; the OS recognition service controls audio processing and may require network access. Configure an online Whisper STT slot for recording replay and per-word timing.
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
             const speedText = w.speedLabel ? ` · Speed: ${w.speedLabel}` : '';
             const spokenTimes =
               w.spokenStartMs !== undefined
                 ? `Spoken: ${w.spokenStartMs}–${w.spokenEndMs ?? (w.spokenStartMs + spk)} ms (${spk} ms)`
                 : `Spoken: ${spk} ms`;
             const modelTimes = `Ref: ${w.expectedStartMs ?? 0}–${w.expectedEndMs ?? ((w.expectedStartMs ?? 0) + exp)} ms (${exp} ms)`;

             return `
               <div class="timing-row">
                 <div class="timing-row-head">
                   <span>
                     <strong>${escapeHtml(w.referenceWord ?? '')}</strong> (${w.status})
                     ${w.speedLabel ? `<span class="speed-pill ${speedClass}">${w.speedLabel}</span>` : ''}
                   </span>
                   <span>${spokenTimes} vs ${modelTimes} (${ratioPct}%)${speedText}</span>
                 </div>
                 <div class="timing-track">
                   <div class="timing-fill ${speedClass}" style="width: ${barWidth}%"></div>
                 </div>
               </div>
             `;
           })
           .join('')}
       </div>`;

  const weakDrillBtn =
    report.weakWords.length > 0
      ? `<button type="button" class="btn btn-primary" id="sh-retry-weak-btn">
           <svg class="sh-inline-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg> Retry Weak Words (${report.weakWords.length})
         </button>`
      : '';

  const replayRecBtn = hasRecording
    ? `<button type="button" class="btn btn-secondary" id="sh-replay-my-audio-btn">
         <svg class="sh-inline-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg> Replay My Recording
       </button>
       <button type="button" class="btn btn-secondary" id="sh-replay-my-slow-btn">
         <svg class="sh-inline-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> My Recording Slow (0.75x)
       </button>`
    : `<button type="button" class="btn btn-secondary" id="sh-replay-my-audio-btn" disabled title="No audio kept in System SpeechRecognizer mode">
         <svg class="sh-inline-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Zm13-1 4 6m0-6-4 6"/></svg> Replay My Recording (Disabled in Offline Mode)
       </button>`;

  return `
    <section class="card" id="sh-score-card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Shadowing Score Report</h2>
          <p class="card-subtitle">
            Scored via <strong>${escapeHtml(report.activeTier.detailLabel)}</strong> · Overall Pace: <strong>${Math.round(
              report.overallPaceRatio * 100
            )}% (${report.overallPaceLabel})</strong>
          </p>
        </div>
        <span class="tier-badge ${report.activeTier.label === 'Online AI' ? 'online' : 'offline'}">
          <span class="tier-dot"></span>
          ${report.activeTier.label}
        </span>
      </div>

      ${
        report.approximateNotice
          ? `<div class="status-box info" id="sh-tier3-notice">${escapeHtml(report.approximateNotice)}</div>`
          : ''
      }

      <div class="score-metrics-grid">
        <div class="metric-tile">
          <div class="metric-value" id="sh-overall-score">${report.overallScore}</div>
          <div class="metric-label">Overall</div>
        </div>
        <div class="metric-tile">
          <div class="metric-value" id="sh-pron-score">${report.pronunciationScore}</div>
          <div class="metric-label">${report.activeTier.tier >= 2 ? 'Word match' : 'Pronunciation assessment'}</div>
        </div>
        <div class="metric-tile">
          <div class="metric-value" id="sh-fluency-score">${report.fluencyScore}</div>
          <div class="metric-label">Fluency</div>
        </div>
        <div class="metric-tile">
          <div class="metric-value" id="sh-pace-score">${report.paceScore}</div>
          <div class="metric-label">Pace (${report.overallPaceLabel})</div>
        </div>
        <div class="metric-tile">
          <div class="metric-value" id="sh-complete-score">${report.completenessScore}%</div>
          <div class="metric-label">Completeness</div>
        </div>
      </div>

      ${weakDrillBtn ? `<div class="sh-weak-drill">${weakDrillBtn}</div>` : ''}

      <div class="word-tokens-wrap" id="sh-word-chips">
        ${chipsHtml}
      </div>

      <div class="btn-row sh-report-playback-actions">
        ${replayRecBtn}
      </div>

      ${isOfflineMode
        ? `${renderVadWaveformSection(report.vadAnalysis)}${timingSectionHtml}`
        : `<details class="sh-timing-details">
            <summary>Timing &amp; voice activity details</summary>
            ${renderVadWaveformSection(report.vadAnalysis)}
            ${timingSectionHtml}
          </details>`}
    </section>
  `;
}

export function renderShadowingView(
  container: HTMLElement,
  summary: GlobalTierSummary
): void {
  const sentence = state.sourceMode === 'ai' ? (state.aiSentenceQueue[state.index] ?? state.aiSentence) : getCurrentSentence();
  const list = getShadowingSentencesByDifficulty(state.difficulty);
  const hasSentence = !!sentence;
  const targetText = state.customDrillText ?? sentence?.text ?? 'Generate an AI sentence to begin shadowing.';
  const translationSource = state.customDrillText ?? sentence?.text ?? '';
  if (state.translationSourceText !== translationSource) {
    state.translationSourceText = translationSource;
    state.translationText = translationSource;
    state.translationResult = '';
    state.translationStatus = null;
    state.translationStatusType = 'info';
  }
  const targetExpectedDurationMs = state.customDrillText
    ? Math.max(1200, state.customDrillText.split(/\s+/).length * 480)
    : sentence?.expectedTotalDurationMs ?? 3500;

  const isRec = audioRecorder.isRecording();
  const scoringTier = summary.slots.pronunciation_scoring;
  const ttsTier = summary.slots.voice_tts;

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

  container.innerHTML = `
    <section class="card shadowing-main-card">
      <div class="card-header shadowing-main-header">
        <div>
          <h1 class="card-title shadowing-page-title"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v3m-4 0h8"/></svg>Shadowing Trainer</h1>
          <p class="card-subtitle">
            Voice: <strong>${ttsTier.label}</strong> · Practise pronunciation at your own pace
          </p>
        </div>
        <span class="tier-badge ${scoringTier.label === 'Online AI' ? 'online' : 'offline'}">
          <span class="tier-dot"></span>
          ${scoringTier.label}
        </span>
      </div>

      ${scoringTier.tier === 3 ? `<details class="offline-quality-notice shadowing-offline-notice" aria-label="Offline pronunciation accuracy notice">
        <summary><strong>Pronunciation accuracy notice</strong><span class="offline-quality-learn-more">Learn more</span></summary>
        <p>Offline feedback uses Android's system SpeechRecognizer and approximate word/timing checks. It is still useful for practising repetition, fluency and matching the target sentence, but it is not a precise pronunciation score. For more dependable transcription and word-level timing, connect and test an online speech-to-text provider in Slot 2 (for example, Groq Whisper when available for your account). This improves the information available to the practice feedback, but true phoneme-level pronunciation assessment requires a dedicated pronunciation-assessment service.</p>
      </details>` : ''}
      <div class="sentence-source-switch" aria-label="Sentence source">
        <button type="button" class="sentence-source-card ${state.sourceMode === 'bank' ? 'active' : ''}" data-source="bank">
          <span class="source-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z"/><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20M8 7h8M8 10h6"/></svg></span><span class="source-copy"><strong>Sentence Library</strong><small>Preloaded practice sentences</small></span><span class="source-check">${state.sourceMode === 'bank' ? '✓' : ''}</span>
        </button>
        <button type="button" class="sentence-source-card ${state.sourceMode === 'ai' ? 'active' : ''}" data-source="ai">
          <span class="source-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/></svg></span><span class="source-copy"><strong>AI Sentences</strong><small>Generate a new sentence on demand</small></span><span class="source-check">${state.sourceMode === 'ai' ? '✓' : ''}</span>
        </button>
      </div>

      <div class="pill-tabs shadowing-difficulty-tabs" aria-label="Sentence difficulty">
        <button type="button" class="pill-btn ${state.difficulty === 'easy' ? 'active' : ''}" data-diff="easy">Easy</button>
        <button type="button" class="pill-btn ${state.difficulty === 'medium' ? 'active' : ''}" data-diff="medium">Medium</button>
        <button type="button" class="pill-btn ${state.difficulty === 'hard' ? 'active' : ''}" data-diff="hard">Hard</button>
      </div>

      ${state.sourceMode === 'ai' ? `
        <div class="ai-sentence-panel">
          <div class="ai-sentence-panel-copy">
            <strong>Generate a new sentence set</strong>
            <span>Each request creates 20 sentences. Next and Previous move through this set without extra API calls.</span>
          </div>
          <div class="form-field sh-topic-field">
            <label class="form-label" for="sh-topic-input">Optional topic</label>
            <div class="btn-row sh-topic-input-row">
              <input type="text" class="form-input sh-topic-input" id="sh-topic-input" maxlength="100" placeholder="Leave blank for fully random topics." value="${escapeHtml(state.topicInput)}" />
              <button type="button" class="btn btn-secondary" id="sh-random-topic-btn">Random topic</button>
            </div>
          </div>
          <div class="btn-row sh-generate-actions">
            <button type="button" class="btn btn-primary" id="sh-generate-ai-btn" ${state.isGeneratingAi ? 'disabled' : ''}>
              ${state.isGeneratingAi ? 'Generating sentence set…' : 'Get new sentence set'}
            </button>
          </div>
          ${state.aiSentenceQueue.length ? `<p class="card-subtitle sh-ai-sentence-count">Sentence ${Math.min(state.index + 1, state.aiSentenceQueue.length)} of ${state.aiSentenceQueue.length}</p>` : ''}
          ${state.aiGenerationError ? `<div class="status-box fail ai-generation-error" id="sh-ai-generation-error" role="alert">${escapeHtml(state.aiGenerationError)}</div>` : ''}
        </div>
      ` : ''}

      ${!state.customDrillText ? `<div class="card-subtitle shadowing-topic-label">Topic: <strong>${escapeHtml(sentence?.topic ?? 'AI sentence')}</strong></div>` : ''}
      <div class="sentence-box" id="sh-target-text">${escapeHtml(targetText)}</div>
      <p class="card-subtitle sh-focus-copy">
        ${
          state.customDrillText
            ? 'Weak-word practice is active — choose Full Sentence to return.'
            : `Focus: ${escapeHtml(sentence?.phoneticFocus ?? 'Generate a sentence to see its pronunciation focus')}${state.sourceMode === 'ai' ? '' : ` · ${(state.index % list.length) + 1}/${list.length}`}`
        }
      </p>

      <div class="btn-row sh-player-controls" aria-label="Sentence playback controls">
        <button type="button" class="btn btn-secondary sh-player-icon-btn" id="sh-prev-btn" aria-label="Previous sentence" title="Previous sentence">←</button>
        <button type="button" class="btn btn-primary sh-player-icon-btn sh-play-main-btn model-play-btn ${state.activeModelPlayback === 'normal' ? 'is-playing' : ''}" id="sh-play-normal-btn" ${hasSentence && !state.activeModelPlayback ? '' : 'disabled'} aria-label="Play model at normal speed" title="Play model at normal speed" aria-busy="${state.activeModelPlayback === 'normal'}">
          ${state.activeModelPlayback === 'normal' ? '<span class="model-play-spinner" aria-hidden="true"></span>' : '<svg class="sh-inline-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>'}
        </button>
        <button type="button" class="btn btn-secondary sh-player-icon-btn" id="sh-next-btn" aria-label="Next sentence" title="Next sentence">→</button>
        <button type="button" class="btn btn-secondary sh-player-icon-btn sh-slow-btn model-play-btn ${state.activeModelPlayback === 'slow' ? 'is-playing' : ''}" id="sh-play-slow-btn" ${hasSentence && !state.activeModelPlayback ? '' : 'disabled'} aria-label="Slow playback at 0.72 speed" title="Slow playback (0.72×)" aria-busy="${state.activeModelPlayback === 'slow'}">
          ${state.activeModelPlayback === 'slow' ? '<span class="model-play-spinner" aria-hidden="true"></span>' : '<span aria-hidden="true">0.72×</span>'}
        </button>
        ${
          state.customDrillText
            ? `<button type="button" class="btn btn-secondary" id="sh-exit-drill-btn">Full Sentence</button>`
            : ''
        }
      </div>

      <div class="form-field sh-transcript-field">
        <label class="form-label" for="sh-transcript-input">
          Recognized speech:
        </label>
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

      <div class="btn-row sh-record-controls">
        <button type="button" class="btn btn-primary sh-record-action" id="sh-record-btn" ${isRec ? 'hidden' : ''} ${hasSentence ? '' : 'disabled'} aria-label="Start recording repetition">
          ${isRec ? '<span class="recording-led"></span> Recording...' : 'Record Repetition'}
        </button>
        <button type="button" class="btn btn-primary sh-record-action" id="sh-stop-score-btn" ${!isRec ? 'hidden' : ''} ${hasSentence ? '' : 'disabled'} aria-label="Stop recording and score repetition">
          <span class="recording-led" aria-hidden="true"></span> Stop &amp; Score
        </button>
      </div>

      ${
        state.emptyAttemptError
          ? `<div class="status-box fail" id="sh-empty-error" role="alert">${escapeHtml(
              state.emptyAttemptError
            )} (Score: 0)</div>`
          : `<div class="status-box info" id="sh-status-msg" role="status" aria-live="polite">${escapeHtml(state.statusMessage)}</div>`
      }
    </section>

    ${state.lastReport ? renderReportHtml(state.lastReport, Boolean(state.lastRecording?.wavBase64)) : ''}
    <section class="card sh-translation-card" id="sh-translation-card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Translation</h2>
          <p class="card-subtitle">Edit the sentence or enter a single word, choose a language, then translate.</p>
        </div>
      </div>
      <div class="form-field">
        <label class="form-label" for="sh-translation-input">Text to translate</label>
        <textarea class="form-input sh-translation-input" id="sh-translation-input" rows="3" maxlength="4000" placeholder="Your sentence or word will appear here." ${state.isTranslating ? 'disabled' : ''}>${escapeHtml(state.translationText)}</textarea>
      </div>
      <div class="sh-translation-controls">
        <div class="form-field sh-translation-language-field">
          <label class="form-label" for="sh-translation-language">Translate into</label>
          <select class="form-select" id="sh-translation-language" ${state.isTranslating ? 'disabled' : ''}>${renderTranslationLanguageOptions(state.translationTargetLanguage)}</select>
        </div>
        <button type="button" class="btn btn-primary sh-translate-btn" id="sh-translate-btn" ${state.isTranslating ? 'disabled' : ''}>
          ${state.isTranslating ? 'Translating…' : 'Translate'}
        </button>
      </div>
      ${state.translationResult ? `<div class="sh-translation-result" id="sh-translation-result"><div class="form-label">Translation</div><p dir="auto">${escapeHtml(state.translationResult)}</p></div>` : ''}
      ${state.translationStatus ? `<div class="status-box ${state.translationStatusType}" id="sh-translation-status" role="status" aria-live="polite">${escapeHtml(state.translationStatus)}</div>` : ''}
    </section>
  `;

  container.querySelector<HTMLTextAreaElement>('#sh-translation-input')?.addEventListener('input', event => {
    state.translationText = (event.target as HTMLTextAreaElement).value;
    state.translationResult = '';
    state.translationStatus = null;
    container.querySelector('#sh-translation-result')?.remove();
    container.querySelector('#sh-translation-status')?.remove();
  });
  container.querySelector<HTMLSelectElement>('#sh-translation-language')?.addEventListener('change', event => {
    state.translationTargetLanguage = (event.target as HTMLSelectElement).value;
    state.translationResult = '';
    state.translationStatus = null;
    container.querySelector('#sh-translation-result')?.remove();
    container.querySelector('#sh-translation-status')?.remove();
  });
  container.querySelector<HTMLButtonElement>('#sh-translate-btn')?.addEventListener('click', async () => {
    if (state.isTranslating) return;
    const textToTranslate = state.translationText.trim();
    if (!textToTranslate) {
      state.translationStatus = 'Enter a word or sentence to translate.';
      state.translationStatusType = 'fail';
      renderShadowingView(container, summary);
      return;
    }
    state.isTranslating = true;
    state.translationResult = '';
    state.translationStatus = 'Translating with the configured Translation API…';
    state.translationStatusType = 'info';
    renderShadowingView(container, summary);
    try {
      const targetLanguage = TRANSLATION_LANGUAGES.find(language => language.code === state.translationTargetLanguage)?.label ?? state.translationTargetLanguage;
      const result = await translateShadowingText(textToTranslate, targetLanguage);
      state.translationResult = result.text;
      state.translationStatus = `Translation complete via ${result.providerName} (${result.account === 'secondary' ? 'API 2' : 'API 1'}).`;
      state.translationStatusType = 'pass';
    } catch (error) {
      state.translationStatus = `Translation failed: ${error instanceof Error ? error.message : String(error)}`;
      state.translationStatusType = 'fail';
    } finally {
      state.isTranslating = false;
      renderShadowingView(container, summary);
    }
  });

  container.querySelectorAll<HTMLButtonElement>('[data-word-replay]').forEach(button => {
    button.addEventListener('click', async () => {
      const word = button.dataset.wordReplay?.trim();
      if (!word || button.disabled) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      shadowingModelPlaybackToken++;
      state.activeModelPlayback = null;
      stopAllTts();
      try {
        const result = await speakSentenceWithTierFallback(word);
        state.statusMessage = `Played “${word}” via ${result.activeTier.detailLabel}.`;
      } catch (error) {
        state.statusMessage = `Could not play “${word}”: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        if (button.isConnected) {
          button.disabled = false;
          button.removeAttribute('aria-busy');
        }
        const status = container.querySelector<HTMLElement>('#sh-status-msg');
        if (status) status.textContent = state.statusMessage;
      }
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sourceMode = btn.dataset.source === 'ai' ? 'ai' : 'bank';
      state.index = 0;
      state.aiGenerationError = null;
      state.customDrillText = null;
      clearAttemptState();
      renderShadowingView(container, summary);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.difficulty = (btn.dataset.diff as ShadowingDifficulty) || 'easy';
      state.index = 0;
      state.customDrillText = null;
      if (state.sourceMode === 'ai') { state.aiSentence = null; state.aiSentenceQueue = []; saveAiSentenceQueue([]); }
      state.aiGenerationError = null;
      clearAttemptState();
      renderShadowingView(container, summary);
    });
  });

  container.querySelector<HTMLInputElement>('#sh-topic-input')?.addEventListener('input', event => {
    state.topicInput = (event.target as HTMLInputElement).value;
  });

  container.querySelector<HTMLButtonElement>('#sh-random-topic-btn')?.addEventListener('click', () => {
    const choices = SHADOWING_RANDOM_TOPICS.filter(topic => topic !== state.topicInput);
    state.topicInput = choices[Math.floor(Math.random() * choices.length)] ?? SHADOWING_RANDOM_TOPICS[0];
    const input = container.querySelector<HTMLInputElement>('#sh-topic-input');
    if (input) input.value = state.topicInput;
  });

  container.querySelector<HTMLButtonElement>('#sh-generate-ai-btn')?.addEventListener('click', async () => {
    if (state.isGeneratingAi) return;
    state.isGeneratingAi = true;
    state.aiGenerationError = null;
    state.statusMessage = 'Generating 20 new practice sentences...';
    renderShadowingView(container, summary);
    try {
      const generated = await generateAiShadowingSentenceBatch(state.difficulty, 20, state.topicInput.trim());
      state.aiSentenceQueue = generated;
      state.aiSentence = generated[0] ?? null;
      state.index = 0;
      saveAiSentenceQueue(generated);
      state.customDrillText = null;
      clearAttemptState();
      state.statusMessage = `Generated ${generated.length} sentences by ${generated[0]?.providerName ?? 'AI'}. Practise each one with Next and Previous.`;
      state.aiGenerationError = null;
    } catch (error) {
      state.aiGenerationError = `AI sentence set generation failed: ${error instanceof Error ? error.message : String(error)}`;
      state.statusMessage = 'The current sentence set was kept. Correct the issue above and try again.';
    } finally {
      state.isGeneratingAi = false;
      renderShadowingView(container, summary);
    }
  });

  container.querySelector<HTMLButtonElement>('#sh-prev-btn')?.addEventListener('click', () => {
    state.index = state.sourceMode === 'ai' ? Math.max(0, state.index - 1) : Math.max(0, state.index - 1);
    state.customDrillText = null;
    clearAttemptState();
    renderShadowingView(container, summary);
  });

  container.querySelector<HTMLButtonElement>('#sh-next-btn')?.addEventListener('click', () => {
    if (state.sourceMode === 'ai') {
      state.index = Math.min(Math.max(0, state.aiSentenceQueue.length - 1), state.index + 1);
    } else {
      state.index++;
    }
    state.customDrillText = null;
    clearAttemptState();
    renderShadowingView(container, summary);
  });

  container.querySelector<HTMLButtonElement>('#sh-exit-drill-btn')?.addEventListener('click', () => {
    state.customDrillText = null;
    clearAttemptState();
    renderShadowingView(container, summary);
  });

  const playModelAudio = async (mode: 'normal' | 'slow'): Promise<void> => {
    if (state.activeModelPlayback) return;
    const playbackToken = ++shadowingModelPlaybackToken;
    state.activeModelPlayback = mode;
    state.statusMessage = mode === 'normal'
      ? 'Playing model audio at normal speed...'
      : 'Playing model audio slowly...';
    renderShadowingView(container, summary);
    try {
      const rate = mode === 'normal' ? 1.0 : 0.72;
      const res = await speakSentenceWithTierFallback(targetText, { rate });
      if (playbackToken !== shadowingModelPlaybackToken) return;
      const offlineVoiceNote = res.activeTier.tier >= 3
        ? ' The basic offline system voice is being used; an online TTS API may sound more natural.'
        : '';
      state.statusMessage = mode === 'normal'
        ? `Played model audio via ${res.activeTier.detailLabel}${res.fromCache ? ' [Cached]' : ''}.${offlineVoiceNote}`
        : `Played slow model audio (0.72x) via ${res.activeTier.detailLabel}.${offlineVoiceNote}`;
    } catch (error) {
      if (playbackToken !== shadowingModelPlaybackToken) return;
      state.statusMessage = `Could not play model audio: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (playbackToken === shadowingModelPlaybackToken) {
        state.activeModelPlayback = null;
        renderShadowingView(container, summary);
      }
    }
  };

  container.querySelector<HTMLButtonElement>('#sh-play-normal-btn')?.addEventListener('click', () => {
    void playModelAudio('normal');
  });

  container.querySelector<HTMLButtonElement>('#sh-play-slow-btn')?.addEventListener('click', () => {
    void playModelAudio('slow');
  });

  // Shadowing always uses its own pronunciation-scoring slot. Never borrow
  // the IELTS transcription API: the two features have independent providers,
  // keys, verification and fallback/rotation.
  const resolveShadowingSttSlotId = (): 'pronunciation_scoring' => 'pronunciation_scoring';

  container.querySelector<HTMLButtonElement>('#sh-record-btn')?.addEventListener('click', async () => {
    // Always reset transcript & previous report to EMPTY on every new recording attempt
    clearAttemptState();
    const sttSlotId = resolveShadowingSttSlotId();
    const sttTier = summary.slots[sttSlotId];
    const isOnlineStt = sttTier.tier === 2 && sttTier.label === 'Online AI';

    try {
      await audioRecorder.start('en-US', { useOfflineRecognizer: !isOnlineStt, preferOffline: !isOnlineStt });
      clearShadowingRecordingTimer();
      // Keep the 60-second safety limit internal: no visible countdown in Shadowing.
      // Trigger the same stop-and-score flow the user would invoke manually.
      shadowingRecordingTimeout = setTimeout(() => {
        shadowingRecordingTimeout = null;
        container.querySelector<HTMLButtonElement>('#sh-stop-score-btn')?.click();
      }, 60_000);
      state.statusMessage = isOnlineStt
        ? 'Recording 16 kHz WAV (Online STT mode)... Speak clearly, then tap "Stop & Score Repetition".'
        : 'Listening via Android system speech recognition (no raw audio retained by SpeakCoach in this mode)... Speak clearly, then tap "Stop & Score Repetition".';
    } catch (err) {
      state.statusMessage = `Microphone error: ${err instanceof Error ? err.message : String(err)}`;
    }
    renderShadowingView(container, summary);
  });

  container.querySelector<HTMLButtonElement>('#sh-stop-score-btn')?.addEventListener('click', async () => {
    clearShadowingRecordingTimer();
    const rec = await audioRecorder.stop();
    state.lastRecording = rec;

    // Resolve the configured online speech provider (Azure, Whisper or Gemini), with API 2 and offline fallbacks.
    const sttSlotId = resolveShadowingSttSlotId();

    const sttOutcome = await transcribeWithTier2WhisperOrFallback({
      slotId: sttSlotId,
      wavBase64: rec.wavBase64,
      durationMs: rec.durationMs,
      offlineTranscript: rec.offlineTranscript,
      offlineConfidence: rec.offlineConfidence,
      referenceText: targetText
    });

    const rawRecognized = sttOutcome.transcript.trim();

    state.recognizedTranscript = rawRecognized;
    state.recognizedConfidence = rec.offlineConfidence;
    state.recognizedAlternatives = rec.offlineAlternatives;
    state.recognizerError = rec.recognizerError;

    // Never fall back to reference text! If recognizer returned empty/null/error, DO NOT score.
    if (!rawRecognized) {
      state.lastReport = null;
      state.emptyAttemptError = rec.recognizerError
        ? `Nothing was recognized, try again (${rec.recognizerError}).`
        : 'Nothing was recognized, try again.';

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
      clearDiagnosticsCache();
      renderShadowingView(container, summary);
      return;
    }

    state.emptyAttemptError = null;
    const vadAnalysis = rec.wavBase64
      ? analyzeWavBase64Vad(rec.wavBase64, targetExpectedDurationMs)
      : undefined;
    const modelTimings = (await getCachedModelWordTimings(targetText)) ?? undefined;

    if (sttOutcome.activeTier.tier <= 2 && sttOutcome.words.length > 0) {
      state.lastReport = scoreShadowingTier2({
        referenceText: targetText,
        spokenTranscript: rawRecognized,
        spokenTokens: sttOutcome.words,
        spokenDurationMs: rec.durationMs,
        expectedDurationMs: targetExpectedDurationMs,
        activeTierOverride: sttOutcome.activeTier,
        vadAnalysis,
        referenceTimingsOverride: modelTimings
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
        referenceTimingsOverride: modelTimings
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
    clearDiagnosticsCache();

    state.statusMessage = `Scored recognizer output ("${rawRecognized}") against reference.`;
    renderShadowingView(container, summary);
  });

  container.querySelector<HTMLButtonElement>('#sh-replay-my-audio-btn')?.addEventListener('click', async () => {
    if (state.lastRecording) {
      await playAudioDataUrl(state.lastRecording.wavDataUrl, 1.0);
    }
  });

  container.querySelector<HTMLButtonElement>('#sh-replay-my-slow-btn')?.addEventListener('click', async () => {
    if (state.lastRecording) {
      await playAudioDataUrl(state.lastRecording.wavDataUrl, 0.75);
    }
  });

  container.querySelector<HTMLButtonElement>('#sh-retry-weak-btn')?.addEventListener('click', () => {
    if (state.lastReport && state.lastReport.weakWords.length > 0) {
      state.customDrillText = state.lastReport.weakWords.join(' ');
      clearAttemptState();
      state.statusMessage = 'Focused Weak-Word Drill ready! Listen and repeat only your weak words.';
      renderShadowingView(container, summary);
    }
  });
}

export async function pauseShadowingRecordingForBackground(): Promise<void> {
  clearShadowingRecordingTimer();
  shadowingModelPlaybackToken++;
  const wasPlayingModelAudio = state.activeModelPlayback !== null;
  state.activeModelPlayback = null;
  const wasRecording = audioRecorder.isRecording();
  if (!wasRecording && !wasPlayingModelAudio) return;

  try {
    if (wasRecording) await audioRecorder.stop();
    state.statusMessage = wasPlayingModelAudio
      ? 'Model audio playback stopped because SpeakCoach moved to the background. Play it again when you return.'
      : 'Recording stopped because SpeakCoach moved to the background. Start a new recording when you return.';
  } catch (error) {
    state.statusMessage = `Audio was interrupted in the background. Please try again. ${error instanceof Error ? error.message : ''}`.trim();
  }
}

export function resetShadowingViewState(): void {
  state.difficulty = 'easy';
  state.sourceMode = 'bank';
  state.aiSentence = null;
  state.aiSentenceQueue = loadSavedAiSentenceQueue();
  state.isGeneratingAi = false;
  state.aiGenerationError = null;
  clearShadowingRecordingTimer();
  state.index = 0;
  state.topicInput = '';
  state.customDrillText = null;
  state.translationSourceText = null;
  state.translationText = '';
  state.translationResult = '';
  state.translationStatus = null;
  state.isTranslating = false;
  clearAttemptState();
}
