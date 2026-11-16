import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IeltsSessionController } from '../src/services/ieltsSessionEngine';
import { audioRecorder } from '../src/services/audioRecorder';
import * as ttsService from '../src/services/ttsService';
import * as evaluatorModule from '../src/services/ieltsLlmEvaluator';
import { buildIeltsEvaluationPrompt } from '../src/services/ieltsLlmEvaluator';
import { clearAllRuntimeFailures } from '../src/services/tierManager';
import { clearIeltsSessionLogs } from '../src/services/ieltsTelemetry';
import { generateIeltsSessionPlan } from './fixtures/legacyIeltsQuestionBank';

describe('IELTS Question Synchronization & Concurrency Guards', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllRuntimeFailures();
    clearIeltsSessionLogs();
    audioRecorder.setMockRecognizerOutputForTest(null);
    vi.restoreAllMocks();
  });

  describe('1. Canonical Question Synchronization', () => {
    it('uses the exact same canonical question object for prompt, TTS, recorded answer, and evaluation', async () => {
      const plan = generateIeltsSessionPlan();
      const ctrl = new IeltsSessionController({ mode: 'part1', plan });

      const spokenSentences: string[] = [];
      vi.spyOn(ttsService, 'speakSentenceWithTierFallback').mockImplementation(async (text) => {
        spokenSentences.push(text);
        return {
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
          durationEstimateMs: 500
        };
      });

      const firstStep = ctrl.getSnapshot().currentStep!;
      expect(firstStep.canonicalQuestion).toBeDefined();
      const expectedId = firstStep.canonicalQuestion.id;
      const expectedText = firstStep.canonicalQuestion.text;

      // 1. Spoken TTS
      await ctrl.startStepExaminerPrompt();
      expect(spokenSentences).toContain(expectedText);

      // 2. Recording answer metadata
      audioRecorder.setMockRecognizerOutputForTest({
        transcript: 'I grew up in a coastal city with picturesque beaches.',
        confidence: 0.95
      });
      await ctrl.finishCurrentAnswer();

      const answers = ctrl.getSnapshot().completedAnswers;
      expect(answers).toHaveLength(1);
      const recorded = answers[0];
      expect(recorded.questionId).toBe(expectedId);
      expect(recorded.question).toBe(expectedText);

      // 3. Evaluation prompt
      const prompt = buildIeltsEvaluationPrompt({ answers });
      expect(prompt.user).toContain(`[Question 1 (Part 1)]: "${expectedText}"`);
      expect(prompt.user).toContain('Candidate Transcript: "I grew up in a coastal city with picturesque beaches."');

      ctrl.clearAllTimers();
    });

    it('synchronizes canonical question on Part 2 prep and talk steps', () => {
      const plan = generateIeltsSessionPlan();
      const ctrl = new IeltsSessionController({ mode: 'part2', plan });
      const snap = ctrl.getSnapshot();

      const prepStep = snap.currentStep!;
      expect(prepStep.stepType).toBe('part2_prep');
      expect(prepStep.canonicalQuestion.id).toBe(plan.part2CueCard.id);
      expect(prepStep.canonicalQuestion.cueCard).toEqual(plan.part2CueCard);

      ctrl.skipPart2Prep();
      const talkStep = ctrl.getSnapshot().currentStep!;
      expect(talkStep.stepType).toBe('part2_talk');
      expect(talkStep.canonicalQuestion.id).toBe(plan.part2CueCard.id);
      expect(talkStep.canonicalQuestion.text).toBe(prepStep.canonicalQuestion.text);

      ctrl.clearAllTimers();
    });

    it('does not replace a question from the retired offline bank when AI is unavailable', async () => {
      const ctrl = new IeltsSessionController({ mode: 'part1', plan: generateIeltsSessionPlan() });
      const originalStep = ctrl.getSnapshot().currentStep!;
      const originalId = originalStep.canonicalQuestion.id;

      await ctrl.replaceCurrentQuestionWithUnseen();

      const updatedStep = ctrl.getSnapshot().currentStep!;
      expect(updatedStep.canonicalQuestion.id).toBe(originalId);
      expect(updatedStep.questionId).toBe(originalId);
      expect(ctrl.getSnapshot().status).toBe('error');
      ctrl.clearAllTimers();
    });
  });

  describe('2. Concurrency, Race Conditions & Mutexes', () => {
    it('prevents duplicate concurrent evaluations', async () => {
      const ctrl = new IeltsSessionController({ mode: 'part1', plan: generateIeltsSessionPlan() });

      let evalCallCount = 0;
      vi.spyOn(evaluatorModule, 'evaluateIeltsWithTierFallback').mockImplementation(async () => {
        evalCallCount++;
        await new Promise((r) => setTimeout(r, 50));
        return {
          sessionId: 'test_session',
          mode: 'part1',
          source: 'offline_heuristic',
          overallBand: 6.5,
          fluencyBand: 6.5,
          grammarBand: 6.0,
          lexicalBand: 7.0,
          pronunciationBand: 6.5,
          evaluatorSummary: 'Good performance'
        } as any;
      });

      // Launch two concurrent evaluations
      const [res1, res2] = await Promise.all([
        ctrl.runEvaluation(),
        ctrl.runEvaluation()
      ]);

      expect(evalCallCount).toBe(1);
      expect(res1).toBe(res2);
      expect(res1?.overallBand).toBe(6.5);
    });

    it('prevents next question prompt from starting while evaluation is in-flight', async () => {
      const ctrl = new IeltsSessionController({ mode: 'part1', plan: generateIeltsSessionPlan() });

      vi.spyOn(evaluatorModule, 'evaluateIeltsWithTierFallback').mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100));
        return {
          sessionId: 'test_session',
          mode: 'part1',
          source: 'offline_heuristic',
          overallBand: 7.0,
          fluencyBand: 7.0,
          grammarBand: 7.0,
          lexicalBand: 7.0,
          pronunciationBand: 7.0
        } as any;
      });

      const evalPromise = ctrl.runEvaluation();
      expect(ctrl.getSnapshot().status).toBe('evaluating');

      // Attempting to start examiner prompt while evaluating must be safely rejected
      await ctrl.startStepExaminerPrompt();
      expect(ctrl.getSnapshot().status).toBe('evaluating');

      await evalPromise;
      expect(ctrl.getSnapshot().status).toBe('completed');
    });

    it('prevents concurrent finishCurrentAnswer calls from duplicating answers', async () => {
      const ctrl = new IeltsSessionController({ mode: 'part1', plan: generateIeltsSessionPlan() });

      audioRecorder.setMockRecognizerOutputForTest({
        transcript: 'I work as a software engineer at a tech firm.',
        confidence: 0.94
      });

      await ctrl.startCandidateRecording();
      expect(ctrl.getSnapshot().status).toBe('recording');

      // Concurrent finishCurrentAnswer calls (e.g. timeout + click)
      await Promise.all([
        ctrl.finishCurrentAnswer(),
        ctrl.finishCurrentAnswer()
      ]);

      const snap = ctrl.getSnapshot();
      expect(snap.completedAnswers).toHaveLength(1);

      ctrl.clearAllTimers();
    });

    it('increments question counter only when presenting next step and never exceeds total steps', async () => {
      const ctrl = new IeltsSessionController({ mode: 'part2', plan: generateIeltsSessionPlan() }); // 2 steps: prep, talk
      expect(ctrl.getSnapshot().currentStepIndex).toBe(0);
      expect(ctrl.getSnapshot().totalSteps).toBe(2);

      // Skip prep advances to talk (step 1)
      ctrl.skipPart2Prep();
      expect(ctrl.getSnapshot().currentStepIndex).toBe(1);

      audioRecorder.setMockRecognizerOutputForTest({
        transcript: 'I visited Paris two years ago and it was truly remarkable.',
        confidence: 0.92
      });

      vi.spyOn(evaluatorModule, 'evaluateIeltsWithTierFallback').mockResolvedValue({
        sessionId: 'test_session',
        mode: 'part2',
        source: 'offline_heuristic',
        overallBand: 7.0
      } as any);

      // Finish talk answer -> final step complete -> triggers evaluation
      await ctrl.finishCurrentAnswer();

      const finalSnap = ctrl.getSnapshot();
      // Step index must NOT be incremented to 2 (which would show Question 3 of 2)
      expect(finalSnap.currentStepIndex).toBe(1);
      expect(finalSnap.totalSteps).toBe(2);
      expect(finalSnap.status).toBe('completed');

      ctrl.clearAllTimers();
    });

    it('invalidates stale in-flight operations when session is reset', async () => {
      const ctrl = new IeltsSessionController({ mode: 'part1', plan: generateIeltsSessionPlan() });

      let slowEvalResolve: (val: any) => void;
      const slowEvalPromise = new Promise((resolve) => {
        slowEvalResolve = resolve;
      });

      vi.spyOn(evaluatorModule, 'evaluateIeltsWithTierFallback').mockImplementation(
        () => slowEvalPromise as any
      );

      const evalTask = ctrl.runEvaluation();
      expect(ctrl.getSnapshot().status).toBe('evaluating');

      // User cancels / resets session while evaluation is running
      ctrl.reset();
      expect(ctrl.getSnapshot().status).toBe('idle');

      // Stale evaluation resolves afterwards
      slowEvalResolve!({
        sessionId: 'stale_session',
        overallBand: 9.0
      });
      await evalTask;

      // Status must remain 'idle' and not be overwritten to 'completed'
      expect(ctrl.getSnapshot().status).toBe('idle');
      expect(ctrl.getSnapshot().evaluationResult).toBeNull();
    });
  });
});
