import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audioRecorder } from '../src/services/audioRecorder';
import { generateIeltsSessionPlan } from './fixtures/legacyIeltsQuestionBank';
import { IeltsSessionController } from '../src/services/ieltsSessionEngine';
import { saveAppSettings } from '../src/storage/appSettings';
import { clearAllRuntimeFailures } from '../src/services/tierManager';
import * as ttsService from '../src/services/ttsService';
import { getIeltsSessionLogs, clearIeltsSessionLogs } from '../src/services/ieltsTelemetry';

function createAiPlan() {
  const plan = generateIeltsSessionPlan();
  plan.id = `session_llm_test_${plan.id}`;
  plan.part1Questions = plan.part1Questions.map((q) => ({ ...q, id: `llm_${q.id}` }));
  plan.part2CueCard = { ...plan.part2CueCard, id: `llm_${plan.part2CueCard.id}` };
  plan.part3Questions = plan.part3Questions.map((q) => ({ ...q, id: `llm_${q.id}`, cueCardId: `llm_${q.cueCardId}` }));
  return plan;
}

describe('IELTS Test Session State Machine Engine (Stage 3.5 & Bugfix)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllRuntimeFailures();
    clearIeltsSessionLogs();
    audioRecorder.setMockRecognizerOutputForTest(null);
    vi.restoreAllMocks();
  });

  it('builds step sequence correctly for different modes', () => {
    const fullCtrl = new IeltsSessionController({ mode: 'full', plan: createAiPlan() });
    const fullSnap = fullCtrl.getSnapshot();
    // 8 Part 1 questions + Part 2 prep + Part 2 talk + 3-4 Part 3 questions
    expect(fullSnap.totalSteps).toBeGreaterThanOrEqual(13);

    const p1Ctrl = new IeltsSessionController({ mode: 'part1', plan: createAiPlan() });
    expect(p1Ctrl.getSnapshot().totalSteps).toBe(8);

    const p2Ctrl = new IeltsSessionController({ mode: 'part2', plan: createAiPlan() });
    expect(p2Ctrl.getSnapshot().totalSteps).toBe(2); // prep + talk

    const p3Ctrl = new IeltsSessionController({ mode: 'part3', plan: createAiPlan() });
    expect(p3Ctrl.getSnapshot().totalSteps).toBeGreaterThanOrEqual(3);
  });

  it('starts with no question until an AI-generated plan is supplied', () => {
    const ctrl = new IeltsSessionController({ mode: 'full' });
    const snapshot = ctrl.getSnapshot();
    expect(snapshot.plan.id).toBe('pending-ai-plan');
    expect(snapshot.totalSteps).toBe(0);
    expect(snapshot.currentStep).toBeNull();
    ctrl.reset();
  });

  it('handles candidate notes and Part 2 prep skip transition', () => {
    const ctrl = new IeltsSessionController({ mode: 'part2', plan: createAiPlan() });
    ctrl.setCandidateNotes('Key points: - childhood memory - summer camp');

    expect(ctrl.getSnapshot().candidateNotes).toContain('summer camp');
    expect(ctrl.getSnapshot().currentStep?.stepType).toBe('part2_prep');

    ctrl.skipPart2Prep();
    expect(ctrl.getSnapshot().currentStep?.stepType).toBe('part2_talk');
    expect(ctrl.getSnapshot().talkSecondsRemaining).toBe(120);

    ctrl.clearAllTimers();
  });

  it('records and completes answers, collecting candidate transcripts without raw audio bloat', async () => {
    const ctrl = new IeltsSessionController({ mode: 'part1', plan: createAiPlan() });

    audioRecorder.setMockRecognizerOutputForTest({
      transcript: 'I come from a small town surrounded by hills.',
      confidence: 0.93
    });

    await ctrl.startCandidateRecording();
    expect(ctrl.getSnapshot().status).toBe('recording');

    await ctrl.finishCurrentAnswer();

    const snap = ctrl.getSnapshot();
    expect(snap.completedAnswers).toHaveLength(1);
    expect(snap.completedAnswers[0].transcript).toBe(
      'I come from a small town surrounded by hills.'
    );
    expect(snap.currentStepIndex).toBe(1);

    ctrl.clearAllTimers();
  });

  it('transitions automatically from examiner TTS prompt -> cue tone -> candidate recording state', async () => {
    const ctrl = new IeltsSessionController({ mode: 'part1', plan: createAiPlan() });

    vi.spyOn(ttsService, 'speakSentenceWithTierFallback').mockResolvedValue({
      activeTier: {
        slotId: 'voice_tts',
        providerId: 'native_tts',
        providerName: 'Native TTS',
        tier: 3,
        label: 'Basic offline',
        detailLabel: 'Native offline',
        isFallback: true,
        reason: 'HTTP 503 from online TTS provider'
      },
      fromCache: false,
      durationEstimateMs: 1200
    });

    await ctrl.startStepExaminerPrompt();

    // After prompt finishes, state MUST be 'recording' (NEVER idle or exited!)
    const snap = ctrl.getSnapshot();
    expect(snap.status).toBe('recording');
    expect(snap.currentStep?.part).toBe(1);

    const logs = getIeltsSessionLogs();
    expect(logs.some((l) => l.event.includes('cue_tone') || l.status === 'cue_tone')).toBe(true);
    expect(logs.some((l) => l.status === 'recording')).toBe(true);
    expect(logs.some((l) =>
      l.event === 'examiner_tts_fallback' &&
      l.error === 'HTTP 503 from online TTS provider'
    )).toBe(true);
    expect(ctrl.getSnapshot().activeVoiceTier?.reason).toBe('HTTP 503 from online TTS provider');

    ctrl.clearAllTimers();
  });

  it('survives TTS synthesis error gracefully without exiting session or resetting to idle', async () => {
    const ctrl = new IeltsSessionController({ mode: 'part1', plan: createAiPlan() });

    vi.spyOn(ttsService, 'speakSentenceWithTierFallback').mockRejectedValue(
      new Error('TTS synthesis timeout')
    );

    await ctrl.startStepExaminerPrompt();

    // Visual prompt remains and recording still engages!
    const snap = ctrl.getSnapshot();
    expect(snap.status).toBe('recording');
    expect(snap.status).not.toBe('idle');

    const logs = getIeltsSessionLogs();
    expect(logs.some((l) => l.event === 'examiner_tts_warning')).toBe(true);

    ctrl.clearAllTimers();
  });

  it('transitions to error state with human-readable message on microphone start error and enables retry', async () => {
    const ctrl = new IeltsSessionController({ mode: 'part1', plan: createAiPlan() });

    vi.spyOn(audioRecorder, 'start').mockRejectedValue(
      new Error('Microphone audio source in use by another app')
    );

    await ctrl.startCandidateRecording();

    const snap = ctrl.getSnapshot();
    expect(snap.status).toBe('error');
    expect(snap.status).not.toBe('idle'); // Must stay on error screen, never exit!
    expect(snap.errorMessage).toContain('Microphone audio source in use by another app');

    // Test retry
    vi.spyOn(audioRecorder, 'start').mockResolvedValue(undefined);
    await ctrl.retryCurrentStep();

    expect(ctrl.getSnapshot().status).toBe('recording');
    expect(ctrl.getSnapshot().errorMessage).toBeNull();

    ctrl.clearAllTimers();
  });

  it('cleanly resets state and allows consecutive sessions: complete a session -> start another -> it runs', async () => {
    const ctrl = new IeltsSessionController({ mode: 'part1', plan: createAiPlan() });

    vi.spyOn(ttsService, 'speakSentenceWithTierFallback').mockResolvedValue({
      activeTier: {
        slotId: 'voice_tts',
        providerId: 'native_tts',
        providerName: 'Native TTS',
        tier: 3,
        label: 'Basic offline',
        detailLabel: 'Native offline',
        isFallback: false
      },
      fromCache: false,
      durationEstimateMs: 100
    });

    audioRecorder.setMockRecognizerOutputForTest({
      transcript: 'I work in software design and enjoy solving tricky bugs.',
      confidence: 0.95
    });

    // Complete session evaluation
    await ctrl.runEvaluation();
    expect(ctrl.getSnapshot().status).toBe('completed');
    expect(ctrl.getSnapshot().evaluationResult).toBeNull();
    expect(ctrl.getSnapshot().errorMessage).toContain('An AI API is required for IELTS evaluation');

    // Reset session (simulating completion / retake)
    ctrl.reset();
    expect(ctrl.getSnapshot().status).toBe('idle');
    expect(ctrl.getSnapshot().evaluationResult).toBeNull();
    expect(ctrl.getSnapshot().completedAnswers).toHaveLength(0);

    // Start another session -> must run cleanly!
    await ctrl.startSession('part1', { plan: createAiPlan() });
    // The prompt is launched immediately, but its async TTS may already have
    // completed by the time startSession resolves. Accept any active prompt,
    // cue, or recording state rather than asserting a transient TTS state.
    expect(['examiner_speaking', 'cue_tone', 'recording']).toContain(ctrl.getSnapshot().status);
    expect(ctrl.getSnapshot().currentStepIndex).toBe(0);

    ctrl.clearAllTimers();
  });

  it('prompts user with unrecognized_prompt on empty transcript and supports re-record or skip', async () => {
    const ctrl = new IeltsSessionController({ mode: 'part1', plan: createAiPlan() });

    // Set mock to return empty/silence
    audioRecorder.setMockRecognizerOutputForTest({
      transcript: '',
      confidence: 0
    });

    await ctrl.startCandidateRecording();
    expect(ctrl.getSnapshot().status).toBe('recording');

    // Finish answer with empty transcript
    await ctrl.finishCurrentAnswer();

    // Must NOT silently advance or exit! Must be 'unrecognized_prompt'
    expect(ctrl.getSnapshot().status).toBe('unrecognized_prompt');
    expect(ctrl.getSnapshot().currentStepIndex).toBe(0); // Did not advance

    // Test re-record
    await ctrl.reRecordCurrentStep();
    expect(ctrl.getSnapshot().status).toBe('recording');

    // Simulate second attempt failing again
    await ctrl.finishCurrentAnswer();
    expect(ctrl.getSnapshot().status).toBe('unrecognized_prompt');

    // Test skip
    await ctrl.skipCurrentStep();
    const snap = ctrl.getSnapshot();
    // Must advance to step 1
    expect(snap.currentStepIndex).toBe(1);
    expect(snap.completedAnswers).toHaveLength(1);
    expect(snap.completedAnswers[0].wasSkipped).toBe(true);
    expect(snap.completedAnswers[0].transcript).toBe('[Question skipped by candidate]');

    const logs = getIeltsSessionLogs();
    expect(logs.some((l) => l.event === 'unrecognized_speech_prompt')).toBe(true);
    expect(logs.some((l) => l.event === 'skip_step')).toBe(true);

    ctrl.clearAllTimers();
  });

  it('rejects a supplied built-in plan when AI-only mode is enabled', async () => {
    const ctrl = new IeltsSessionController();
    await saveAppSettings({ allowBuiltinFallback: false });

    const offlinePlan = generateIeltsSessionPlan({ preferUnseen: false });
    await ctrl.startSession('part1', { plan: offlinePlan });

    const snap = ctrl.getSnapshot();
    expect(snap.status).toBe('error');
    expect(snap.errorMessage).toContain('older offline version');
    expect(snap.currentStepIndex).toBe(0);
    expect(snap.totalSteps).toBe(0);
    expect(snap.currentStep).toBeNull();
    ctrl.reset();
  });

  it('does not allow Skip to advance while evaluation is active', async () => {
    const ctrl = new IeltsSessionController({ mode: 'part1', plan: createAiPlan() });
    const initialQuestionId = ctrl.getSnapshot().currentStep?.questionId;

    // Simulate the state at the evaluation boundary without starting a network request.
    // @ts-expect-error access private method to place the controller in the guarded state
    ctrl.setStatus('evaluating', null, 'Test evaluation lock');
    await ctrl.skipCurrentStep();

    const snap = ctrl.getSnapshot();
    expect(snap.status).toBe('evaluating');
    expect(snap.currentStepIndex).toBe(0);
    expect(snap.currentStep?.questionId).toBe(initialQuestionId);
    expect(snap.completedAnswers).toHaveLength(0);
    ctrl.reset();
  });

  it('serializes concurrent Skip actions so one question is counted only once', async () => {
    const ctrl = new IeltsSessionController({ mode: 'part1', plan: createAiPlan() });
    // The candidate can use Skip from the unrecognized-answer prompt.
    // @ts-expect-error access private method to simulate that visible UI state
    ctrl.setStatus('unrecognized_prompt', null, 'Test skip dialog');

    await Promise.all([ctrl.skipCurrentStep(), ctrl.skipCurrentStep()]);

    const snap = ctrl.getSnapshot();
    expect(snap.currentStepIndex).toBe(1);
    expect(snap.completedAnswers).toHaveLength(1);
    expect(snap.completedAnswers[0].wasSkipped).toBe(true);
    ctrl.reset();
  });

  it('does not use the built-in bank for Skip / New question when AI-only mode is enabled', async () => {
    const ctrl = new IeltsSessionController({ mode: 'part1', plan: createAiPlan() });
    await saveAppSettings({ allowBuiltinFallback: false });
    const initialQuestionId = ctrl.getSnapshot().currentStep?.questionId;

    await ctrl.replaceCurrentQuestionWithUnseen();

    const snap = ctrl.getSnapshot();
    expect(snap.status).toBe('error');
    expect(snap.errorMessage).toBeTruthy();
    expect(snap.currentStep?.questionId).toBe(initialQuestionId);
    expect(snap.currentStep?.source).toBe('online_ai');
    expect(snap.completedAnswers).toHaveLength(0);
    ctrl.reset();
  });

  it('does not replace a question with a prewritten bank item when AI is unavailable', async () => {
    const ctrl = new IeltsSessionController({ mode: 'part1', plan: createAiPlan() });
    const initialStep = ctrl.getSnapshot().currentStep!;
    const initialQuestionId = initialStep.questionId;

    await ctrl.replaceCurrentQuestionWithUnseen();

    const updatedStep = ctrl.getSnapshot().currentStep!;
    expect(updatedStep.questionId).toBe(initialQuestionId);
    expect(ctrl.getSnapshot().status).toBe('error');
    expect(ctrl.getSnapshot().completedAnswers).toHaveLength(0);
    expect(ctrl.getSnapshot().currentStepIndex).toBe(0);
    ctrl.clearAllTimers();
  });

  it('requires an online AI provider to regenerate an IELTS question plan', async () => {
    const ctrl = new IeltsSessionController({ mode: 'full' });
    await expect(ctrl.regenerateSessionPlan('full')).rejects.toThrow(/API key|Online AI provider/i);
    expect(ctrl.getSnapshot().completedAnswers).toHaveLength(0);
  });
});
