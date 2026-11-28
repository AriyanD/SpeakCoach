import { Capacitor, type HttpOptions, type HttpResponse } from '@capacitor/core';
import type {
  IeltsPart2CueCard,
  IeltsTestSessionPlan
} from '../data/ieltsQuestionTypes';
import {
  generateIeltsPlanWithTierFallback,
  LlmQuestionGenerationError,
  type LlmQuestionPlanResult
} from './ieltsQuestionGenerator';
import { getPreset } from '../config/providers';
import {
  audioRecorder,
  requestNativeMicPermission,
  type RecordedUtterance
} from './audioRecorder';
import {
  evaluateIeltsWithTierFallback,
  LlmEvaluationFailureError,
  type IeltsAnswerInput,
  type IeltsEvaluationResult
} from './ieltsLlmEvaluator';
import { clearPreloadedSentenceAudio, preloadSentenceAudio, speakSentenceWithTierFallback, stopAllTts } from './ttsService';
import { transcribeWithTier2WhisperOrFallback } from './whisperSttService';
import { logIeltsSessionEvent } from './ieltsTelemetry';
import { saveIeltsDraft } from '../storage/ieltsHistoryStore';
import { loadAllSlotsConfig } from '../storage/localStore';
import { isOnlineIeltsSttTier, resolveSlotTier } from './tierManager';


type IeltsTransport = (opts: HttpOptions) => Promise<HttpResponse>;

function sanitizeTtsDiagnostic(value: unknown): string {
  return String(value ?? '')
    .replace(/([?&](?:key|api_key|token|access_token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[redacted]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[redacted]');
}

export type IeltsTestMode = 'full' | 'part1' | 'part2' | 'part3';

function createEmptySessionPlan(): IeltsTestSessionPlan {
  return {
    id: 'pending-ai-plan',
    part1Topics: [],
    part1Questions: [],
    part2CueCard: {
      id: 'pending-ai-cue-card',
      topic: '',
      title: '',
      prompt: '',
      bullets: ['', '', '', '']
    },
    part3Questions: []
  };
}

export type IeltsStepType =
  | 'part1_question'
  | 'part2_prep'
  | 'part2_talk'
  | 'part3_question';

export interface CanonicalIeltsQuestion {
  id: string;
  part: 1 | 2 | 3;
  topic: string;
  text: string;
  cueCard?: IeltsPart2CueCard;
  source?: 'online_ai' | 'offline_bank';
}

export interface IeltsSessionStep {
  stepIndex: number;
  totalSteps: number;
  stepType: IeltsStepType;
  part: 1 | 2 | 3;
  questionId: string;
  questionText: string;
  cueCard?: IeltsPart2CueCard;
  canonicalQuestion: CanonicalIeltsQuestion;
  source?: 'online_ai' | 'offline_bank';
}

export type IeltsSessionStatus =
  | 'idle'
  | 'preparing'
  | 'examiner_speaking'
  | 'cue_tone'
  | 'prep_countdown'
  | 'recording'
  | 'transcribing'
  | 'unrecognized_prompt'
  | 'evaluating'
  | 'completed'
  | 'error';

export interface IeltsSessionStateSnapshot {
  sessionId: string;
  plan: IeltsTestSessionPlan;
  mode: IeltsTestMode;
  currentStepIndex: number;
  totalSteps: number;
  currentStep: IeltsSessionStep | null;
  status: IeltsSessionStatus;
  prepSecondsRemaining: number;
  talkSecondsRemaining: number;
  examinerAudioStarted: boolean;
  activeVoiceTier?: IeltsEvaluationResult['activeTier'] | null;
  candidateNotes: string;
  completedAnswers: IeltsAnswerInput[];
  evaluationResult: IeltsEvaluationResult | null;
  evaluationError?: string | null;
  errorMessage: string | null;
  isPreloadingPlan: boolean;
  allowBuiltinFallback?: boolean;
  questionSource?: 'AI' | 'OFFLINE';
  questionSourceDetails?: {
    providerName?: string;
    modelName?: string;
    totalQuestions?: number;
    fallbackReason?: string;
  };
}

export async function playAudioCueBeep(): Promise<void> {
  try {
    const ctxClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!ctxClass) return;
    const ctx = new ctxClass();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Autoplay policy might keep it suspended in some environments; don't block flow
      }
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1174, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.16);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);

    // Release context after tone completes
    setTimeout(() => {
      try {
        void ctx.close();
      } catch {
        // Ignore close error
      }
    }, 250);
  } catch {
    // AudioContext unavailable in headless test environment; safe to continue
  }
}

export class IeltsSessionController {
  private plan: IeltsTestSessionPlan;
  private mode: IeltsTestMode;
  private steps: IeltsSessionStep[] = [];
  private currentStepIndex = 0;
  private candidateNotes = '';
  private completedAnswers: IeltsAnswerInput[] = [];
  private evaluationResult: IeltsEvaluationResult | null = null;
  private evaluationError: string | null = null;
  private currentStatus: IeltsSessionStatus = 'idle';
  private errorMessage: string | null = null;
  private isSessionActive = false;
  private isProcessingAnswer = false;
  private isEvaluating = false;
  private activeEvaluationPromise: Promise<IeltsEvaluationResult | null> | null = null;
  private isPreloadingPlan = false;
  private preparedPlan: IeltsTestSessionPlan | null = null;
  private preparedPlanResult: LlmQuestionPlanResult | null = null;
  private activePreloadPromise: Promise<LlmQuestionPlanResult | null> | null = null;
  private currentPlanResult: LlmQuestionPlanResult | null = null;
  private stepRunToken = 0;
  private prepIntervalId: ReturnType<typeof setInterval> | null = null;
  private talkIntervalId: ReturnType<typeof setInterval> | null = null;
  private talkStopTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private prepSecondsRemaining = 60;
  private talkSecondsRemaining = 120;
  private examinerAudioStarted = false;
  private activeVoiceTier: IeltsEvaluationResult['activeTier'] | null = null;
  private recordedWavs = new Map<number, { wavBase64: string; durationMs: number }>();
  private onStateChange?: (state: IeltsSessionStateSnapshot) => void;
  private listeners: Set<(state: IeltsSessionStateSnapshot) => void> = new Set();

  constructor(options?: {
    mode?: IeltsTestMode;
    plan?: IeltsTestSessionPlan;
    onStateChange?: (state: IeltsSessionStateSnapshot) => void;
  }) {
    this.mode = options?.mode ?? 'full';
    this.plan = options?.plan ?? createEmptySessionPlan();
    this.onStateChange = options?.onStateChange;
    this.isSessionActive = !!options;
    this.buildStepSequence();
    if (options) {
      const firstStep = this.steps[0];
      if (firstStep?.stepType === 'part2_prep') {
        this.currentStatus = 'prep_countdown';
      }
    }

  }

  /** @deprecated Built-in IELTS question fallback is retired; kept as a no-op for older callers. */
  public setAllowBuiltinFallback(_allow: boolean): void {
    // Legacy callers may still invoke this method; it cannot enable the retired question bank.
  }

  public subscribe(fn: (state: IeltsSessionStateSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.getSnapshot());
    return () => this.listeners.delete(fn);
  }

  private setStatus(
    newStatus: IeltsSessionStatus,
    errorMessage: string | null = null,
    details?: string
  ): void {
    const fromStatus = this.currentStatus;
    this.currentStatus = newStatus;
    this.errorMessage = errorMessage;
    const currentStep = this.steps[this.currentStepIndex] ?? null;

    logIeltsSessionEvent({
      event: `status_change:${fromStatus}->${newStatus}`,
      status: newStatus,
      stepIndex: this.currentStepIndex,
      questionId: currentStep?.questionId,
      error: errorMessage || undefined,
      details
    });

    this.notify();
  }

  private buildStepSequence(): void {
    if (this.plan.id === 'pending-ai-plan') {
      this.steps = [];
      this.currentStepIndex = 0;
      return;
    }
    const steps: IeltsSessionStep[] = [];
    // Snapshot explicit per-step sources from the current steps so that a
    // rebuild does not erase provenance that was assigned at runtime
    // (for example by replaceCurrentQuestionWithUnseen). The snapshot is
    // keyed by (part, questionId), which is stable across a rebuild because
    // the plan is mutated in place when a question is replaced.
    const explicitSources = new Map<string, 'online_ai' | 'offline_bank'>();
    for (const oldStep of this.steps) {
      const source = oldStep.source ?? oldStep.canonicalQuestion?.source;
      if (source) {
        explicitSources.set(`${oldStep.part}:${oldStep.questionId}`, source);
      }
    }

    const resolveSource = (
      part: 1 | 2 | 3,
      questionId: string
    ): 'online_ai' | 'offline_bank' => {
      const explicit = explicitSources.get(`${part}:${questionId}`);
      if (explicit) return explicit;
      // Backward-compatible provenance for saved plans created before
      // explicit source metadata was persisted. Current AI generation uses
      // llm_ IDs; legacy non-LLM IDs are retained only in saved history.
      return questionId.includes('llm') ? 'online_ai' : 'offline_bank';
    };

    if (this.mode === 'full' || this.mode === 'part1') {
      this.plan.part1Questions.forEach((q) => {
        const itemSource = resolveSource(1, q.id);
        const canonical: CanonicalIeltsQuestion = {
          id: q.id,
          part: 1,
          topic: q.topic,
          text: q.question,
          source: itemSource
        };
        steps.push({
          stepIndex: 0,
          totalSteps: 0,
          stepType: 'part1_question',
          part: 1,
          questionId: canonical.id,
          questionText: canonical.text,
          canonicalQuestion: canonical,
          source: itemSource
        });
      });
    }

    if (this.mode === 'full' || this.mode === 'part2') {
      const p2Source = resolveSource(2, this.plan.part2CueCard.id);
      const p2Canonical: CanonicalIeltsQuestion = {
        id: this.plan.part2CueCard.id,
        part: 2,
        topic: this.plan.part2CueCard.topic,
        text: this.plan.part2CueCard.prompt || this.plan.part2CueCard.title,
        cueCard: this.plan.part2CueCard,
        source: p2Source
      };
      steps.push({
        stepIndex: 0,
        totalSteps: 0,
        stepType: 'part2_prep',
        part: 2,
        questionId: p2Canonical.id,
        questionText: p2Canonical.text,
        cueCard: this.plan.part2CueCard,
        canonicalQuestion: p2Canonical,
        source: p2Source
      });
      steps.push({
        stepIndex: 0,
        totalSteps: 0,
        stepType: 'part2_talk',
        part: 2,
        questionId: p2Canonical.id,
        questionText: p2Canonical.text,
        cueCard: this.plan.part2CueCard,
        canonicalQuestion: p2Canonical,
        source: p2Source
      });
    }

    if (this.mode === 'full' || this.mode === 'part3') {
      this.plan.part3Questions.forEach((q) => {
        const itemSource = resolveSource(3, q.id);
        const canonical: CanonicalIeltsQuestion = {
          id: q.id,
          part: 3,
          topic: q.topic,
          text: q.question,
          source: itemSource
        };
        steps.push({
          stepIndex: 0,
          totalSteps: 0,
          stepType: 'part3_question',
          part: 3,
          questionId: canonical.id,
          questionText: canonical.text,
          canonicalQuestion: canonical,
          source: itemSource
        });
      });
    }

    this.steps = steps.map((s, idx) => ({
      ...s,
      stepIndex: idx,
      totalSteps: steps.length
    }));
  }

  public getSnapshot(): IeltsSessionStateSnapshot {
    const currentStep = this.steps[this.currentStepIndex] ?? null;
    let isStepAi = false;
    if (currentStep?.source) {
      isStepAi = currentStep.source === 'online_ai';
    } else if (currentStep?.canonicalQuestion?.source) {
      isStepAi = currentStep.canonicalQuestion.source === 'online_ai';
    } else if (currentStep) {
      isStepAi = currentStep.questionId.includes('llm');
    } else {
      isStepAi = this.currentPlanResult?.source === 'online_ai' || this.plan.id.includes('llm');
    }
    const qSource: 'AI' | 'OFFLINE' = isStepAi ? 'AI' : 'OFFLINE';

    return {
      sessionId: this.plan.id,
      plan: this.plan,
      mode: this.mode,
      currentStepIndex: this.currentStepIndex,
      totalSteps: this.steps.length,
      currentStep,
      status: this.currentStatus,
      prepSecondsRemaining: this.prepSecondsRemaining,
      talkSecondsRemaining: this.talkSecondsRemaining,
      examinerAudioStarted: this.examinerAudioStarted,
      activeVoiceTier: this.activeVoiceTier,
      candidateNotes: this.candidateNotes,
      completedAnswers: this.completedAnswers,
      evaluationResult: this.evaluationResult,
      evaluationError: this.evaluationError,
      errorMessage: this.errorMessage,
      isPreloadingPlan: this.isPreloadingPlan,
      allowBuiltinFallback: false,
      questionSource: qSource,
      questionSourceDetails: this.currentPlanResult
        ? {
            providerName: this.currentPlanResult.providerName,
            modelName: this.currentPlanResult.modelName,
            totalQuestions: this.currentPlanResult.questionsCount?.total,
            fallbackReason: this.currentPlanResult.fallbackReason
          }
        : undefined
    };
  }

  private notify(): void {
    const snap = this.getSnapshot();
    if (this.onStateChange) {
      this.onStateChange(snap);
    }
    this.listeners.forEach((fn) => fn(snap));
  }

  public setCandidateNotes(notes: string): void {
    this.candidateNotes = notes;
  }

  private preloadNextExaminerPrompt(): void {
    clearPreloadedSentenceAudio();
    const nextQuestion = this.steps
      .slice(this.currentStepIndex + 1)
      .find(candidate => candidate.stepType !== 'part2_prep' && candidate.stepType !== 'part2_talk');
    if (!nextQuestion) return;
    const text = nextQuestion.canonicalQuestion?.text || nextQuestion.questionText;
    if (text?.trim()) void preloadSentenceAudio(text, { locale: 'en-US' });
  }

  public async startStepExaminerPrompt(): Promise<void> {
    if (this.currentStatus === 'evaluating' || this.isEvaluating) {
      return;
    }
    const token = ++this.stepRunToken;
    const step = this.steps[this.currentStepIndex];
    if (!step) {
      await this.runEvaluation();
      return;
    }

    this.activeVoiceTier = null;

    if (step.stepType === 'part2_prep') {
      this.preloadNextExaminerPrompt();
      this.startPart2PrepCountdown();
      return;
    }

    if (step.stepType === 'part2_talk') {
      this.preloadNextExaminerPrompt();
      await this.startPart2Speech();
      return;
    }

    const promptText = step.canonicalQuestion?.text || step.questionText;
    // Part 1 or Part 3 Question: wait for the TTS engine's real playback-start event.
    this.examinerAudioStarted = false;
    this.setStatus('examiner_speaking', null, `Waiting for examiner audio: ${promptText}`);

    try {
      const voiceResult = await speakSentenceWithTierFallback(promptText, {
        rate: 1.0,
        onPlaybackStart: () => {
          if (!this.isSessionActive || this.stepRunToken !== token || this.examinerAudioStarted) return;
          this.examinerAudioStarted = true;
          this.notify();
        }
      });
      if (this.isSessionActive && this.stepRunToken === token) {
        const voiceTier = {
          ...voiceResult.activeTier,
          reason: voiceResult.activeTier.reason
            ? sanitizeTtsDiagnostic(voiceResult.activeTier.reason)
            : undefined
        };
        this.activeVoiceTier = voiceTier;
        const fallbackReason = voiceTier.reason || 'No detailed provider error was returned.';
        logIeltsSessionEvent({
          event: voiceTier.tier >= 3 && voiceTier.isFallback
            ? 'examiner_tts_fallback'
            : 'examiner_tts_result',
          status: 'examiner_speaking',
          stepIndex: this.currentStepIndex,
          questionId: step.questionId,
          error: voiceTier.tier >= 3 && voiceTier.isFallback ? fallbackReason : undefined,
          details: `tier=${voiceTier.tier}; provider=${voiceTier.providerName}; cached=${voiceResult.fromCache}`
        });
        this.notify();
      }
    } catch (ttsErr: any) {
      logIeltsSessionEvent({
        event: 'examiner_tts_warning',
        status: 'examiner_speaking',
        stepIndex: this.currentStepIndex,
        questionId: step.questionId,
        error: sanitizeTtsDiagnostic(ttsErr?.message || String(ttsErr)),
        details: 'Native/Online TTS failed to synthesize, candidate visual prompt remains visible'
      });
    }

    if (!this.isSessionActive || this.stepRunToken !== token) return;

    // The current prompt has finished; keep only the next examiner question in RAM.
    this.preloadNextExaminerPrompt();

    // Play "Your turn" beep audio cue before candidate speaks
    this.setStatus('cue_tone', null, 'Playing turn cue tone');
    await playAudioCueBeep();

    if (!this.isSessionActive || this.stepRunToken !== token) return;

    // Immediately start recording the candidate's answer
    await this.startCandidateRecording();
  }

  public async startCandidateRecording(): Promise<void> {
    const token = this.stepRunToken;
    try {
      if (Capacitor.isNativePlatform()) {
        try {
          const granted = await requestNativeMicPermission();
          if (!granted) {
            throw new Error(
              'Microphone permission is required to record your speaking answers. Please grant microphone access in settings.'
            );
          }
        } catch (permErr: any) {
          throw new Error(permErr?.message || 'Could not verify microphone permission.');
        }
      }

      if (!this.isSessionActive || this.stepRunToken !== token) return;

      const configs = await loadAllSlotsConfig();
      const sttTier = await resolveSlotTier(configs.ielts_stt);
      const isOnlineStt = isOnlineIeltsSttTier(sttTier.tier, sttTier.label);

      if (!this.isSessionActive || this.stepRunToken !== token) return;

      await audioRecorder.start('en-US', { useOfflineRecognizer: !isOnlineStt, preferOffline: !isOnlineStt });

      if (!this.isSessionActive || this.stepRunToken !== token) return;

      this.setStatus(
        'recording',
        null,
        isOnlineStt
          ? 'Candidate recording active (Mode A: Online 16kHz WAV AudioRecord)'
          : 'Candidate recording active (Android system SpeechRecognizer; offline use depends on the installed service)'
      );

      // Practice limits: Part 1 = 45 seconds, Part 3 = 70 seconds.
      // Part 2 has its own dedicated 120-second timer in startPart2Speech().
      const currentPart = this.steps[this.currentStepIndex]?.part;
      if (currentPart === 1 || currentPart === 3) {
        this.talkSecondsRemaining = currentPart === 1 ? 45 : 70;
        this.talkIntervalId = setInterval(() => {
          this.talkSecondsRemaining--;
          if (this.talkSecondsRemaining <= 0) {
            this.talkSecondsRemaining = 0;
            if (this.talkIntervalId) {
              clearInterval(this.talkIntervalId);
              this.talkIntervalId = null;
            }
            this.notify();
            this.talkStopTimeoutId = setTimeout(() => {
              this.talkStopTimeoutId = null;
              this.finishCurrentAnswer().catch((err: any) => {
                this.setStatus('error', err?.message || 'Failed to complete timed answer');
              });
            }, 350);
          } else {
            this.notify();
          }
        }, 1000);
        this.notify();
      }
    } catch (err: any) {
      if (!this.isSessionActive || this.stepRunToken !== token) return;
      const msg = err?.message || 'Could not start recording. Please check microphone permissions.';
      this.setStatus('error', msg, 'audioRecorder.start error');
    }
  }

  public async finishCurrentAnswer(): Promise<void> {
    if (
      this.isProcessingAnswer ||
      this.currentStatus === 'transcribing' ||
      this.currentStatus === 'evaluating' ||
      this.currentStatus === 'completed' ||
      this.currentStatus === 'idle'
    ) {
      return;
    }
    this.isProcessingAnswer = true;
    const token = this.stepRunToken;

    try {
      this.clearAllTimers();
      this.setStatus('transcribing', null, 'Processing spoken audio');

      let rec: RecordedUtterance;
      try {
        rec = await audioRecorder.stop();
      } catch (recErr: any) {
        if (!this.isSessionActive || this.stepRunToken !== token) return;
        this.setStatus('error', recErr?.message || 'Failed to stop audio recording.', 'audioRecorder.stop error');
        return;
      }

      if (!this.isSessionActive || this.stepRunToken !== token) return;

      const step = this.steps[this.currentStepIndex];

      // Keep recorded WAV for the current test until evaluation finishes
      if (rec.wavBase64) {
        this.recordedWavs.set(this.currentStepIndex, {
          wavBase64: rec.wavBase64,
          durationMs: rec.durationMs
        });
      }

      logIeltsSessionEvent({
        event: 'recognizer_result',
        status: 'transcribing',
        stepIndex: this.currentStepIndex,
        questionId: step?.questionId,
        details: `System recognizer completed; transcriptLength=${(rec.offlineTranscript || '').length}; confidence=${rec.offlineConfidence ?? 'N/A'}; duration=${Math.round(rec.durationMs / 1000)}s`
      });

      let finalTranscript = (rec.offlineTranscript || '').trim();
      let finalTokens: NonNullable<IeltsAnswerInput['tokens']> = [];
      let finalConfidence = rec.offlineConfidence;

      // If the system recognizer returned an empty/short (< 3 chars) transcript but we have a recorded WAV, transcribe with Tier 2 Whisper
      if (finalTranscript.length < 3 && rec.wavBase64) {
        try {
          const stt = await transcribeWithTier2WhisperOrFallback({
            slotId: 'ielts_stt',
            wavBase64: rec.wavBase64,
            durationMs: rec.durationMs,
            offlineTranscript: rec.offlineTranscript,
            offlineConfidence: rec.offlineConfidence
          });
          if (!this.isSessionActive || this.stepRunToken !== token) return;
          if (stt.transcript.trim().length >= 3) {
            finalTranscript = stt.transcript.trim();
            finalTokens = stt.words;
            logIeltsSessionEvent({
              event: 'whisper_recovered_transcript',
              status: 'transcribing',
              stepIndex: this.currentStepIndex,
              questionId: step?.questionId,
              details: 'Recovered transcript via Tier 2 STT; transcript omitted from technical logs.'
            });
          }
        } catch (whisperErr: any) {
          logIeltsSessionEvent({
            event: 'whisper_fallback_error',
            status: 'transcribing',
            stepIndex: this.currentStepIndex,
            questionId: step?.questionId,
            error: whisperErr?.message || 'Whisper STT fallback failure'
          });
        }
      } else if (finalTranscript.length >= 3 && rec.wavBase64) {
        // Normal flow: still transcribe with Tier 2 for word timestamps if online
        try {
          const stt = await transcribeWithTier2WhisperOrFallback({
            slotId: 'ielts_stt',
            wavBase64: rec.wavBase64,
            durationMs: rec.durationMs,
            offlineTranscript: rec.offlineTranscript,
            offlineConfidence: rec.offlineConfidence
          });
          if (!this.isSessionActive || this.stepRunToken !== token) return;
          if (stt.transcript.trim().length > 0) {
            finalTranscript = stt.transcript.trim();
            finalTokens = stt.words;
          }
        } catch {
          // Safe to use offline transcript if online STT is unreachable
        }
      }

      if (!this.isSessionActive || this.stepRunToken !== token) return;

      // If still empty or very short (< 3 chars), pause and prompt candidate: Re-record or Skip
      if (finalTranscript.length < 3) {
        logIeltsSessionEvent({
          event: 'unrecognized_speech_prompt',
          status: 'unrecognized_prompt',
          stepIndex: this.currentStepIndex,
          questionId: step?.questionId,
          details: 'No speech recognized. Presenting Re-record / Skip dialog to candidate.'
        });
        this.setStatus('unrecognized_prompt', null, 'Nothing was recognized for this answer');
        return;
      }

      // Successfully collected answer using canonical question metadata
      if (step) {
        const canonical = step.canonicalQuestion;
        const tokenConfs = finalTokens
          .map((t) => t?.confidence)
          .filter((c): c is number => typeof c === 'number' && c > 0 && c <= 1);
        const avgTokenConf =
          tokenConfs.length > 0
            ? tokenConfs.reduce((s, c) => s + c, 0) / tokenConfs.length
            : undefined;
        const validOfflineConf =
          typeof finalConfidence === 'number' && finalConfidence > 0 && finalConfidence <= 1
            ? finalConfidence
            : undefined;

        this.completedAnswers.push({
          questionId: canonical.id,
          part: canonical.part,
          question: canonical.text,
          transcript: finalTranscript,
          durationMs: rec.durationMs,
          tokens: finalTokens,
          confidence: avgTokenConf ?? validOfflineConf,
          wasSkipped: false
        });
      }

      if (!this.isSessionActive || this.stepRunToken !== token) return;

      await this.advanceToNextStep(step.stepType === 'part2_prep' ? 2 : 1);
    } finally {
      this.isProcessingAnswer = false;
    }
  }

  private async persistDraft(): Promise<void> {
    try {
      await saveIeltsDraft({
        sessionId: this.plan.id,
        mode: this.mode,
        plan: this.plan,
        currentStepIndex: this.currentStepIndex,
        candidateNotes: this.candidateNotes,
        completedAnswers: [...this.completedAnswers],
        updatedAt: Date.now(),
        questionSource: this.currentPlanResult?.source === 'online_ai' || this.plan.id.includes('llm') ? 'AI' : 'OFFLINE',
        questionSourceDetails: this.currentPlanResult
          ? {
              providerName: this.currentPlanResult.providerName,
              modelName: this.currentPlanResult.modelName,
              totalQuestions: this.currentPlanResult.questionsCount?.total,
              fallbackReason: this.currentPlanResult.fallbackReason
            }
          : undefined
      });
    } catch {
      // Ignore background draft persistence errors
    }
  }

  public async reRecordCurrentStep(): Promise<void> {
    const step = this.steps[this.currentStepIndex];
    if (!step) return;

    logIeltsSessionEvent({
      event: 'rerecord_step',
      status: 'recording',
      stepIndex: this.currentStepIndex,
      questionId: step.questionId,
      details: `Candidate selected Re-record for step ${step.stepType}`
    });

    if (step.stepType === 'part2_talk') {
      await this.startPart2Speech();
    } else {
      await this.startCandidateRecording();
    }
  }

  public async skipCurrentStep(): Promise<void> {
    // Skip is another answer-completion path. Serialize it with recording /
    // transcription so it cannot add a second answer or advance during scoring.
    if (
      this.isProcessingAnswer ||
      this.isEvaluating ||
      this.currentStatus === 'transcribing' ||
      this.currentStatus === 'evaluating' ||
      this.currentStatus === 'completed' ||
      this.currentStatus === 'idle' ||
      !this.isSessionActive
    ) {
      return;
    }

    const step = this.steps[this.currentStepIndex];
    if (!step) return;

    this.isProcessingAnswer = true;
    try {
      // Invalidate any in-flight examiner prompt and stop its audio/timers before
      // recording the skipped answer. This also handles Skip during Part 2 prep.
      this.stepRunToken++;
      this.clearAllTimers();
      stopAllTts();
      if (audioRecorder.isRecording()) {
        await audioRecorder.stop().catch(() => undefined);
      }

      const canonical = step.canonicalQuestion;
      logIeltsSessionEvent({
        event: 'skip_step',
        status: 'transcribing',
        stepIndex: this.currentStepIndex,
        questionId: canonical.id,
        details: `Candidate explicitly skipped question ${canonical.id}`
      });

      this.completedAnswers.push({
        questionId: canonical.id,
        part: canonical.part,
        question: canonical.text,
        transcript: '[Question skipped by candidate]',
        durationMs: 0,
        tokens: [],
        confidence: undefined,
        wasSkipped: true
      });

      await this.advanceToNextStep();
    } finally {
      this.isProcessingAnswer = false;
    }
  }

  public async replaceCurrentQuestionWithUnseen(): Promise<void> {
    const step = this.steps[this.currentStepIndex];
    if (!step || this.currentStatus === 'transcribing' || this.currentStatus === 'evaluating' || this.isEvaluating) {
      return;
    }

    this.stepRunToken++;
    this.clearAllTimers();
    clearPreloadedSentenceAudio();
    stopAllTts();
    if (audioRecorder.isRecording()) {
      try { await audioRecorder.stop(); } catch { /* Ignore stop error */ }
    }

    logIeltsSessionEvent({
      event: 'skip_new_question',
      status: 'idle',
      stepIndex: this.currentStepIndex,
      questionId: step.questionId,
      details: `Candidate selected Skip / New question for step ${step.stepType}`
    });

    this.isPreloadingPlan = true;
    this.setStatus('preparing', null, 'Generating an AI replacement question');
    try {
      const generated = await generateIeltsPlanWithTierFallback({
        mode: this.mode,
        allowBuiltinFallback: false
      });
      if (generated.source !== 'online_ai') {
        throw new Error('IELTS replacement questions must be generated by an online AI provider.');
      }

      this.currentPlanResult = generated;
      if (step.part === 1) {
        const usedTexts = new Set(this.plan.part1Questions.map(q => q.question.trim().toLowerCase()));
        const replacement = generated.plan.part1Questions.find(q => !usedTexts.has(q.question.trim().toLowerCase()))
          ?? generated.plan.part1Questions[0];
        if (!replacement) throw new Error('The AI did not return a valid Part 1 replacement question.');
        const qIdx = this.plan.part1Questions.findIndex(q => q.id === step.questionId);
        if (qIdx < 0) throw new Error('The current Part 1 question could not be located in the active AI set.');
        this.plan.part1Questions[qIdx] = replacement;
      } else if (step.part === 2) {
        this.plan.part2CueCard = generated.plan.part2CueCard;
        this.plan.part3Questions = generated.plan.part3Questions;
        this.prepSecondsRemaining = 60;
        this.talkSecondsRemaining = 120;
      } else {
        const usedTexts = new Set(this.plan.part3Questions.map(q => q.question.trim().toLowerCase()));
        const replacement = generated.plan.part3Questions.find(q => !usedTexts.has(q.question.trim().toLowerCase()))
          ?? generated.plan.part3Questions[0];
        if (!replacement) throw new Error('The AI did not return a valid Part 3 replacement question.');
        const qIdx = this.plan.part3Questions.findIndex(q => q.id === step.questionId);
        if (qIdx < 0) throw new Error('The current Part 3 question could not be located in the active AI set.');
        this.plan.part3Questions[qIdx] = replacement;
      }

      this.buildStepSequence();
      await this.persistDraft();
      this.isPreloadingPlan = false;
      await this.startStepExaminerPrompt();
    } catch (error) {
      this.isPreloadingPlan = false;
      const message = error instanceof Error ? error.message : 'AI could not generate a replacement question. Check the Slot 5 configuration.';
      this.setStatus('error', message, 'AI-only replacement generation failed; no built-in question was used');
    }
  }

  public async regenerateSessionPlan(
    mode?: IeltsTestMode,
    options?: { transport?: IeltsTransport }
  ): Promise<IeltsTestSessionPlan> {
    this.clearAllTimers();
    if (mode) {
      this.mode = mode;
    }
    // Invalidate any previously prepared plan so a stale plan is not adopted
    this.preparedPlan = null;
    this.preparedPlanResult = null;
    this.isPreloadingPlan = true;
    this.notify();

    const execute = async (): Promise<LlmQuestionPlanResult | null> => {
      try {
        this.notify();

        const genResult = await generateIeltsPlanWithTierFallback({
          mode: this.mode,
          transport: options?.transport,
          allowBuiltinFallback: false
        });
        if (genResult.source !== 'online_ai') {
          throw new LlmQuestionGenerationError(
            'AI-only mode was enabled while question generation was running. The offline plan was discarded.',
            genResult.providerName,
            genResult.modelName
          );
        }

        if (this.currentStatus === 'idle') {
          this.preparedPlan = genResult.plan;
          this.preparedPlanResult = genResult;
          this.plan = genResult.plan;
          this.currentPlanResult = genResult;
          this.completedAnswers = [];
          this.candidateNotes = '';
          this.evaluationResult = null;
          this.currentStepIndex = 0;
          this.buildStepSequence();
          this.notify();
        }
        return genResult;
      } catch (err: any) {
        if (err instanceof LlmQuestionGenerationError) {
          this.preparedPlan = null;
          this.preparedPlanResult = {
            plan: this.plan,
            source: 'offline_bank',
            providerName: err.providerName,
            modelName: err.modelName,
            fallbackReason: err.message
          };
        }
        throw err;
      } finally {
        this.isPreloadingPlan = false;
        this.activePreloadPromise = null;
        this.notify();
      }
    };

    const promise = execute();
    this.activePreloadPromise = promise;
    const res = await promise;
    return res ? res.plan : this.plan;
  }

  public async generateAndSetSessionPlan(
    mode?: IeltsTestMode,
    options?: { transport?: IeltsTransport }
  ): Promise<IeltsTestSessionPlan> {
    return this.regenerateSessionPlan(mode, options);
  }

  public setPreparedPlan(genResult: LlmQuestionPlanResult): void {
    this.preparedPlan = genResult.plan;
    this.preparedPlanResult = genResult;
    this.plan = genResult.plan;
    this.currentPlanResult = genResult;
    this.buildStepSequence();
    this.notify();
  }

  public preloadPlan(options?: { transport?: IeltsTransport }): Promise<LlmQuestionPlanResult | null> {
    if (this.isSessionActive || this.currentStatus !== 'idle') {
      return Promise.resolve(null);
    }
    if (this.activePreloadPromise) {
      return this.activePreloadPromise;
    }
    this.isPreloadingPlan = true;
    this.notify();

    const execute = async (): Promise<LlmQuestionPlanResult | null> => {
      try {
        this.notify();

        const genResult = await generateIeltsPlanWithTierFallback({
          mode: this.mode,
          transport: options?.transport,
          allowBuiltinFallback: false
        });
        if (genResult.source !== 'online_ai') {
          throw new LlmQuestionGenerationError(
            'AI-only mode was enabled while question generation was running. The offline plan was discarded.',
            genResult.providerName,
            genResult.modelName
          );
        }

        // A session may start while this background preload is in flight.
        // In that case startSession() has already switched to "preparing" and
        // is awaiting this promise, so the completed plan must still be adopted.
        if ((this.currentStatus === 'idle' && !this.isSessionActive) || this.currentStatus === 'preparing') {
          this.preparedPlan = genResult.plan;
          this.preparedPlanResult = genResult;
          this.plan = genResult.plan;
          this.currentPlanResult = genResult;
          this.buildStepSequence();
          this.notify();
        }
        return genResult;
      } catch (err: any) {
        if (err instanceof LlmQuestionGenerationError) {
          this.preparedPlan = null;
          this.preparedPlanResult = {
            plan: this.plan,
            source: 'offline_bank',
            providerName: err.providerName,
            modelName: err.modelName,
            fallbackReason: err.message
          };
        }
        return null;
      } finally {
        this.isPreloadingPlan = false;
        this.activePreloadPromise = null;
        this.notify();
      }
    };

    const promise = execute();
    this.activePreloadPromise = promise;
    return promise;
  }
  private async advanceToNextStep(stepCount = 1): Promise<void> {
    const nextIndex = this.currentStepIndex + stepCount;
    if (nextIndex >= this.steps.length) {
      // All answers collected; run evaluation without advancing index beyond bounds
      await this.persistDraft();
      await this.runEvaluation();
    } else {
      // Advance step index ONLY when actually presenting the next question
      this.currentStepIndex = nextIndex;
      await this.persistDraft();
      await this.startStepExaminerPrompt();
    }
  }

  public startPart2PrepCountdown(): void {
    this.clearAllTimers();
    this.prepSecondsRemaining = 60;
    this.setStatus('prep_countdown', null, 'Part 2 1-minute preparation countdown');

    this.prepIntervalId = setInterval(() => {
      this.prepSecondsRemaining--;
      if (this.prepSecondsRemaining <= 0) {
        this.clearAllTimers();
        this.currentStepIndex++; // Advance to part2_talk
        this.setStatus('cue_tone', null, 'Prep time ended, playing cue beep');
        playAudioCueBeep().then(() => {
          this.startPart2Speech().catch((err: any) => {
            this.setStatus('error', err?.message || 'Failed to start Part 2 speech');
          });
        });
      } else {
        this.notify();
      }
    }, 1000);
  }

  public skipPart2Prep(): void {
    this.clearAllTimers();
    const step = this.steps[this.currentStepIndex];
    if (step?.stepType === 'part2_prep') {
      this.currentStepIndex++;
      this.setStatus('cue_tone', null, 'Skipped prep, playing cue tone');
      playAudioCueBeep().then(() => {
        this.startPart2Speech().catch((err: any) => {
          this.setStatus('error', err?.message || 'Failed to start Part 2 speech');
        });
      });
    }
  }

  public async startPart2Speech(): Promise<void> {
    this.clearAllTimers();
    this.talkSecondsRemaining = 120; // 2 minutes max
    await this.startCandidateRecording();

    if (this.currentStatus === 'recording') {
      this.talkIntervalId = setInterval(() => {
        this.talkSecondsRemaining--;
        if (this.talkSecondsRemaining <= 0) {
          this.clearAllTimers();
          this.finishCurrentAnswer().catch((err: any) => {
            this.setStatus('error', err?.message || 'Failed to complete Part 2 answer');
          });
        } else {
          this.notify();
        }
      }, 1000);
    }
  }

  public async retryCurrentStep(): Promise<void> {
    this.errorMessage = null;
    this.clearAllTimers();
    stopAllTts();
    if (audioRecorder.isRecording()) {
      try {
        await audioRecorder.stop();
      } catch {
        // Ignore
      }
    }

    const step = this.steps[this.currentStepIndex];
    if (!step) {
      if (this.steps.length === 0) {
        await this.startSession(this.mode);
      } else {
        await this.runEvaluation();
      }
      return;
    }

    logIeltsSessionEvent({
      event: 'retry_step',
      status: this.currentStatus,
      stepIndex: this.currentStepIndex,
      questionId: step.questionId,
      details: `Retrying step ${step.stepType}`
    });

    if (step.stepType === 'part2_prep') {
      this.startPart2PrepCountdown();
    } else if (step.stepType === 'part2_talk') {
      await this.startPart2Speech();
    } else {
      await this.startStepExaminerPrompt();
    }
  }

  public async runEvaluation(): Promise<IeltsEvaluationResult | null> {
    clearPreloadedSentenceAudio();
    if (this.currentStatus === 'completed' && this.evaluationResult) {
      return this.evaluationResult;
    }
    if (this.isEvaluating && this.activeEvaluationPromise) {
      return this.activeEvaluationPromise;
    }
    this.isEvaluating = true;
    const token = ++this.stepRunToken;

    this.clearAllTimers();
    this.setStatus('evaluating', null, 'Evaluating candidate answers against IELTS descriptors');

    this.activeEvaluationPromise = (async () => {
      try {
        const result = await evaluateIeltsWithTierFallback({
          answers: this.completedAnswers
        });
        if (!this.isSessionActive || this.stepRunToken !== token) {
          return null;
        }
        this.evaluationResult = result;
        this.evaluationError = null;
        this.recordedWavs.clear();
        this.setStatus(
          'completed',
          null,
          `Evaluation successful. Band: ${result.overallBand}`
        );
        return this.evaluationResult;
      } catch (evalErr: unknown) {
        if (!this.isSessionActive || this.stepRunToken !== token) return null;
        const reason =
          evalErr instanceof LlmEvaluationFailureError
            ? evalErr.reason
            : evalErr instanceof Error ? evalErr.message : 'Failed to evaluate IELTS session.';
        this.evaluationResult = null;
        this.evaluationError = reason;
        this.recordedWavs.clear();
        this.setStatus('completed', reason, `Evaluation failed: ${reason}`);
        return null;
      } finally {
        this.isEvaluating = false;
        this.activeEvaluationPromise = null;
      }
    })();

    return this.activeEvaluationPromise;
  }

  public clearAllTimers(): void {
    if (this.prepIntervalId) {
      clearInterval(this.prepIntervalId);
      this.prepIntervalId = null;
    }
    if (this.talkIntervalId) {
      clearInterval(this.talkIntervalId);
      this.talkIntervalId = null;
    }
    if (this.talkStopTimeoutId) {
      clearTimeout(this.talkStopTimeoutId);
      this.talkStopTimeoutId = null;
    }
  }

  public setPlan(plan: IeltsTestSessionPlan): void {
    this.plan = plan;
    this.buildStepSequence();
    this.notify();
  }

  public async generateAndStartSession(
    mode: IeltsTestMode = 'full',
    options?: { transport?: IeltsTransport }
  ): Promise<void> {
    const genResult = await generateIeltsPlanWithTierFallback({
      mode,
      transport: options?.transport,
      allowBuiltinFallback: false
    });
    await this.startSession(mode, { plan: genResult.plan });
  }

  public async startSession(
    mode: IeltsTestMode = 'full',
    options?: {
      plan?: IeltsTestSessionPlan;
      transport?: IeltsTransport;
      allowHistoricalPlan?: boolean;
    }
  ): Promise<void> {
    // Prevent competing starts while an asynchronous question plan is loading.
    if (this.currentStatus === 'preparing') return;

    this.stepRunToken++;
    const token = this.stepRunToken;
    this.isProcessingAnswer = false;
    this.isEvaluating = false;
    this.clearAllTimers();
    clearPreloadedSentenceAudio();
    stopAllTts();
    if (audioRecorder.isRecording()) {
      audioRecorder.stop().catch(() => {});
    }
    this.recordedWavs.clear();

    this.mode = mode;
    this.candidateNotes = '';
    this.completedAnswers = [];
    this.evaluationResult = null;
    this.evaluationError = null;
    this.currentStepIndex = 0;
    this.errorMessage = null;
    this.isSessionActive = true;
    this.setStatus('preparing', null, 'Preparing IELTS question plan');

    // Built-in IELTS question fallback is retired; only AI-generated plans are accepted.
    if (this.stepRunToken !== token) return;
    this.notify();

    // Synchronous decision when options.plan or ready preparedPlan exists
    if (options?.plan) {
      const isAiPlan = options.plan.id.includes('llm');
      if (!isAiPlan && !options.allowHistoricalPlan) {
        this.isSessionActive = false;
        this.setStatus(
          'error',
          'This saved question set is from an older offline version. Generate a new AI question set before starting a test.',
          'Fallback disabled, explicit offline plan rejected'
        );
        return;
      }
      this.isSessionActive = true;
      this.plan = options.plan;
      this.currentPlanResult = {
        plan: options.plan,
        source: options.plan.id.includes('llm') ? 'online_ai' : 'offline_bank'
      };
      this.preparedPlan = null;
      this.preparedPlanResult = null;
      this.buildStepSequence();
      logIeltsSessionEvent({
        event: 'session_started',
        status: 'idle',
        details: `Started ${mode} mock session with ${this.steps.length} steps (Source: ${this.currentPlanResult?.source ?? 'offline_bank'})`
      });
      this.startStepExaminerPrompt().catch((err: any) => {
        this.setStatus('error', err?.message || 'Failed to start IELTS session', 'startStepExaminerPrompt error');
      });
      return;
    }

    if (this.preparedPlanResult && this.preparedPlanResult.source === 'offline_bank' && this.preparedPlanResult.fallbackReason) {
      const reason = this.preparedPlanResult.fallbackReason;
      const providerName = this.preparedPlanResult.providerName || 'Slot 5';
      this.preparedPlan = null;
      this.preparedPlanResult = null;
      this.isSessionActive = false;
      this.setStatus(
        'error',
        `AI Question Generation Failed (${providerName}): ${reason}`,
        'Slot 5 AI generation error'
      );
      return;
    }

    if (this.preparedPlanResult && this.preparedPlanResult.source === 'offline_bank') {
      const providerName = this.preparedPlanResult.providerName || 'AI Question Generator';
      this.preparedPlan = null;
      this.preparedPlanResult = null;
      this.isSessionActive = false;
      this.setStatus(
        'error',
        `An Online AI provider is required for IELTS questions. Configure and test an AI provider in Slot 5 (${providerName} is not configured for Online AI).`,
        'Fallback disabled, offline plan rejected'
      );
      return;
    }

    if (this.preparedPlan) {
      if (!this.preparedPlan.id.includes('llm') || this.preparedPlanResult?.source === 'offline_bank') {
        this.preparedPlan = null;
        this.preparedPlanResult = null;
        this.isSessionActive = false;
        this.setStatus(
          'error',
          'This saved question set is from an older offline version. Generate a new AI question set.',
          'Fallback disabled, offline plan rejected'
        );
        return;
      }
      this.isSessionActive = true;
      this.plan = this.preparedPlan;
      this.currentPlanResult = this.preparedPlanResult;
      this.preparedPlan = null;
      this.preparedPlanResult = null;
      this.buildStepSequence();
      logIeltsSessionEvent({
        event: 'session_started',
        status: 'idle',
        details: `Started ${mode} mock session with ${this.steps.length} steps (Source: ${this.currentPlanResult?.source ?? 'offline_bank'})`
      });
      this.startStepExaminerPrompt().catch((err: any) => {
        this.setStatus('error', err?.message || 'Failed to start IELTS session', 'startStepExaminerPrompt error');
      });
      return;
    }

    if (!this.activePreloadPromise && !options?.transport) {
      this.isSessionActive = false;
      this.setStatus(
        'error',
        'No AI-generated question set is ready. Configure and test an Online AI provider in Slot 5, then generate a new set.',
        'Fallback disabled, no preloaded AI plan'
      );
      return;
    }
      // If there is an active preload in flight, await it first
      if (this.activePreloadPromise) {
        try {
          await this.activePreloadPromise;
        } catch {
          // Failure handled via preparedPlanResult
        }
      }

      if (this.stepRunToken !== token) return;

      // If no prepared plan yet and transport provided, generate now
      if (!this.preparedPlan && !this.preparedPlanResult && options?.transport) {
        try {
          const genResult = await generateIeltsPlanWithTierFallback({
            mode,
            transport: options.transport,
            allowBuiltinFallback: false
          });
          this.preparedPlan = genResult.plan;
          this.preparedPlanResult = genResult;
        } catch (err: any) {
          if (err instanceof LlmQuestionGenerationError) {
            this.preparedPlan = null;
            this.preparedPlanResult = {
              plan: this.plan,
              source: 'offline_bank',
              providerName: err.providerName,
              modelName: err.modelName,
              fallbackReason: err.message
            };
          }
        }
      }

      // If still no prepared plan, check whether Slot 5 is configured for Online AI.
      // If so, trigger generation and await it instead of silently falling back immediately.
      if (!this.preparedPlan && !this.preparedPlanResult) {
        try {
          const configs = await loadAllSlotsConfig();
          const genCfg = configs?.llm_generator;
          const isConfiguredOnline = genCfg ? getPreset('llm_generator', genCfg.providerId).tier < 3 : false;
          if (isConfiguredOnline) {
            const genResult = await generateIeltsPlanWithTierFallback({
              mode,
              allowBuiltinFallback: false
            });
            this.preparedPlan = genResult.plan;
            this.preparedPlanResult = genResult;
          }
        } catch (err: any) {
          if (err instanceof LlmQuestionGenerationError) {
            this.preparedPlan = null;
            this.preparedPlanResult = {
              plan: this.plan,
              source: 'offline_bank',
              providerName: err.providerName,
              modelName: err.modelName,
              fallbackReason: err.message
            };
          }
        }
      }

      if (this.stepRunToken !== token) return;

      // Evaluation of prepared plan / fallback status
      if (this.preparedPlanResult && this.preparedPlanResult.source === 'offline_bank' && this.preparedPlanResult.fallbackReason) {
        // AI generation failed
        const reason = this.preparedPlanResult.fallbackReason;
        const providerName = this.preparedPlanResult.providerName || 'Slot 5';
        this.preparedPlan = null;
        this.preparedPlanResult = null;
        this.isSessionActive = false;
        this.setStatus(
          'error',
          `AI Question Generation Failed (${providerName}): ${reason}`,
          'Slot 5 AI generation error'
        );
        return;
      } else if (this.preparedPlanResult && this.preparedPlanResult.source === 'offline_bank') {
        const providerName = this.preparedPlanResult.providerName || 'AI Question Generator';
        this.preparedPlan = null;
        this.preparedPlanResult = null;
        this.isSessionActive = false;
        this.setStatus(
          'error',
          `An Online AI provider is required for IELTS questions. Configure and test an AI provider in Slot 5 (${providerName} is not configured for Online AI).`,
          'Fallback disabled, offline plan rejected'
        );
        return;
      } else if (this.preparedPlan) {
        if (!this.preparedPlan.id.includes('llm') || this.preparedPlanResult?.source === 'offline_bank') {
          this.preparedPlan = null;
          this.preparedPlanResult = null;
          this.isSessionActive = false;
          this.setStatus(
            'error',
            'This saved question set is from an older offline version. Generate a new AI question set.',
            'Fallback disabled, offline plan rejected'
          );
          return;
        }
        this.isSessionActive = true;
        this.plan = this.preparedPlan;
        this.currentPlanResult = this.preparedPlanResult;
        this.preparedPlan = null;
        this.preparedPlanResult = null;
      } else {
        this.isSessionActive = false;
        this.setStatus(
          'error',
          'No AI-generated question set is ready. Configure and test an Online AI provider in Slot 5, then generate a new set.',
          'Fallback disabled, no preloaded AI plan'
        );
        return;
      }

    this.buildStepSequence();

    logIeltsSessionEvent({
      event: 'session_started',
      status: 'idle',
      details: `Started ${mode} mock session with ${this.steps.length} steps (Source: ${this.currentPlanResult?.source ?? 'offline_bank'})`
    });

    this.startStepExaminerPrompt().catch((err: any) => {
      this.setStatus('error', err?.message || 'Failed to start IELTS session', 'startStepExaminerPrompt error');
    });
  }

  public async stopRecordingEarly(): Promise<void> {
    await this.finishCurrentAnswer();
  }

  /**
   * Safely pause an active IELTS attempt when the app is backgrounded.
   * The in-progress answer is intentionally discarded so it can be re-recorded;
   * completed answers and the current question are persisted for recovery.
   */
  public async pauseForBackground(): Promise<void> {
    if (!this.isSessionActive || this.currentStatus === 'completed' || this.currentStatus === 'idle') return;

    clearPreloadedSentenceAudio();
    this.stepRunToken++;
    this.isProcessingAnswer = false;
    this.clearAllTimers();
    stopAllTts();

    if (audioRecorder.isRecording()) {
      try {
        await audioRecorder.stop();
      } catch {
        // The microphone must be released even if the native recognizer fails.
      }
    }

    await this.persistDraft();
    this.setStatus(
      'error',
      'The test was paused because SpeakCoach moved to the background. Your completed answers are saved; record the current answer again when you return.',
      'Session safely paused on app background'
    );
  }

  public cancelSession(): void {
    this.reset();
    logIeltsSessionEvent({
      event: 'session_cancelled',
      status: 'idle',
      details: 'Session cancelled by candidate'
    });
  }

  public reset(): void {
    clearPreloadedSentenceAudio();
    this.stepRunToken++;
    this.isProcessingAnswer = false;
    this.isEvaluating = false;
    this.activeEvaluationPromise = null;
    this.preparedPlan = null;
    this.preparedPlanResult = null;
    this.activePreloadPromise = null;
    this.currentPlanResult = null;
    this.clearAllTimers();
    stopAllTts();
    if (audioRecorder.isRecording()) {
      audioRecorder.stop().catch(() => {});
    }
    this.recordedWavs.clear();
    this.isSessionActive = false;
    this.currentStepIndex = 0;
    this.completedAnswers = [];
    this.evaluationResult = null;
    this.evaluationError = null;
    this.activeVoiceTier = null;
    this.candidateNotes = '';
    this.errorMessage = null;
    // Keep a typed empty placeholder; no question is shown until AI generation succeeds.
    this.plan = createEmptySessionPlan();
    this.buildStepSequence();
    this.setStatus('idle', null, 'Session reset to idle');
  }

  public getState(): IeltsSessionStateSnapshot {
    return this.getSnapshot();
  }

  public restoreSession(snapshot: {
    mode?: IeltsTestMode;
    plan?: IeltsTestSessionPlan;
    currentStepIndex: number;
    completedAnswers: IeltsAnswerInput[];
    candidateNotes: string;
    autoStartPrompt?: boolean;
    questionSource?: 'AI' | 'OFFLINE';
    questionSourceDetails?: {
      providerName?: string;
      modelName?: string;
      totalQuestions?: number;
      fallbackReason?: string;
    };
  }): void {
    if (
      snapshot.plan &&
      snapshot.questionSource !== 'AI' &&
      !snapshot.plan.id.includes('llm')
    ) {
      this.isSessionActive = false;
      this.setStatus(
        'error',
        'This saved session uses questions from an older offline version and cannot be resumed. Generate a new AI question set.',
        'Offline draft rejected because IELTS questions now require an AI-generated set'
      );
      return;
    }
    this.clearAllTimers();
    stopAllTts();
    if (snapshot.mode) {
      this.mode = snapshot.mode;
    }
    if (snapshot.plan) {
      this.plan = snapshot.plan;
      this.currentPlanResult = {
        plan: snapshot.plan,
        source: snapshot.questionSource === 'AI' || snapshot.plan.id.includes('llm') ? 'online_ai' : 'offline_bank',
        providerName: snapshot.questionSourceDetails?.providerName,
        modelName: snapshot.questionSourceDetails?.modelName
      };
    }
    this.buildStepSequence();

    this.completedAnswers = [...snapshot.completedAnswers];
    this.candidateNotes = snapshot.candidateNotes ?? '';
    this.evaluationResult = null;
    this.evaluationError = null;
    this.errorMessage = null;
    this.isSessionActive = true;

    let targetStepIndex = snapshot.currentStepIndex;
    const stepAtTarget = this.steps[targetStepIndex];
    if (
      stepAtTarget &&
      stepAtTarget.stepType !== 'part2_prep' &&
      this.completedAnswers.some((a) => a.questionId === stepAtTarget.questionId) &&
      targetStepIndex + 1 < this.steps.length
    ) {
      targetStepIndex = targetStepIndex + 1;
    }
    this.currentStepIndex = Math.max(0, Math.min(targetStepIndex, Math.max(0, this.steps.length - 1)));

    logIeltsSessionEvent({
      event: 'session_restored',
      status: 'idle',
      stepIndex: this.currentStepIndex,
      details: `Restored ${this.mode} session with ${this.completedAnswers.length} saved answer(s) at step ${this.currentStepIndex}`
    });

    if (snapshot.autoStartPrompt) {
      this.startStepExaminerPrompt().catch((err: any) => {
        this.setStatus('error', err?.message || 'Failed to resume IELTS step');
      });
      return;
    }

    const currentStep = this.steps[this.currentStepIndex];
    if (currentStep?.stepType === 'part2_prep') {
      this.setStatus('prep_countdown', null, 'Restored session in Part 2 prep');
    } else {
      this.setStatus('idle', null, 'Restored session');
    }
  }
}

export const ieltsSessionEngine = new IeltsSessionController();
