/**
 * IELTS no longer falls back to a prewritten question bank.
 * These tests cover legacy-setting migration and the AI-only generation path.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadAppSettings, saveAppSettings } from '../src/storage/appSettings';
import {
  generateIeltsPlanWithTierFallback,
  LlmQuestionGenerationError
} from '../src/services/ieltsQuestionGenerator';
import { ieltsSessionEngine } from '../src/services/ieltsSessionEngine';
import { saveSlotConfig, saveSlotConnectionTestResult } from '../src/storage/localStore';
import { saveApiKey } from '../src/storage/keyStore';
import { clearAllRuntimeFailures } from '../src/services/tierManager';
import { clearSeenQuestions } from '../src/services/ieltsQuestionTracker';
import { networkMonitor } from '../src/services/networkMonitor';

const VALID_PLAN_JSON = {
  part1Topics: ['Technology', 'Digital Communication'],
  part1Questions: [
    { topic: 'Technology', question: 'How often do you use technology in your daily life?' },
    { topic: 'Technology', question: 'Do you think technology has changed the way people communicate?' },
    { topic: 'Technology', question: 'What technology do you use most at home?' },
    { topic: 'Technology', question: 'Has technology improved education in your view?' },
    { topic: 'Digital Communication', question: 'Do you prefer sending messages or making phone calls?' },
    { topic: 'Digital Communication', question: 'How often do you communicate with friends online?' },
    { topic: 'Digital Communication', question: 'Have the ways people keep in touch changed recently?' },
    { topic: 'Digital Communication', question: 'Do you think people spend too much time communicating online?' }
  ],
  part2CueCard: {
    topic: 'Technology',
    title: 'A piece of technology you find useful',
    prompt: 'Describe a piece of technology you find particularly useful.',
    bullets: [
      'What it is',
      'How often you use it',
      'What you use it for',
      'And explain why it is useful to you'
    ]
  },
  part3Questions: [
    { topic: 'Technology', question: 'How has technology changed education over the past decade?' },
    { topic: 'Technology', question: 'Do you think people are too dependent on technology?' },
    { topic: 'Technology', question: 'What role should technology play in healthcare?' },
    { topic: 'Technology', question: 'How can societies ensure that technological progress benefits everyone?' }
  ]
};

function successTransport(opts: any): Promise<any> {
  return Promise.resolve({
    status: 200,
    headers: { 'content-type': 'application/json' },
    url: opts?.url,
    data: { candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_PLAN_JSON) }] } }] }
  });
}

function status503Transport(opts: any): Promise<any> {
  return Promise.resolve({
    status: 503,
    headers: {},
    url: opts?.url,
    data: { error: 'Service Unavailable' }
  });
}

async function configureOnlineSlot5(): Promise<void> {
  await saveSlotConfig({
    slotId: 'llm_generator',
    providerId: 'gemini_gen',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelOrVoice: 'gemini-3.5-flash-lite',
    authStyle: 'query_param'
  });
  await saveApiKey('llm_generator', 'gemini_gen', 'sk-test-key');
  await saveSlotConnectionTestResult('llm_generator', {
    ok: true,
    slotId: 'llm_generator',
    providerId: 'gemini_gen',
    tier: 1,
    label: 'Online AI',
    latencyMs: 1,
    message: 'PASS — test fixture'
  });
}

beforeEach(() => {
  localStorage.clear();
  clearAllRuntimeFailures();
  clearSeenQuestions();
  networkMonitor.setOnline(true);
  ieltsSessionEngine.setAllowBuiltinFallback(true);
  ieltsSessionEngine.reset();
});

describe('Retired built-in IELTS question fallback', () => {
  it('defaults to AI-only generation and ignores a legacy stored opt-in', async () => {
    localStorage.setItem('speakcoach.app_settings.v1', JSON.stringify({
      allowBuiltinFallback: true,
      theme: 'dark'
    }));
    await expect(loadAppSettings()).resolves.toMatchObject({
      allowBuiltinFallback: false,
      theme: 'dark'
    });
  });

  it('cannot re-enable the retired fallback through a settings save', async () => {
    const saved = await saveAppSettings({ allowBuiltinFallback: true });
    expect(saved.allowBuiltinFallback).toBe(false);
    await expect(loadAppSettings()).resolves.toMatchObject({ allowBuiltinFallback: false });
  });

  it('returns AI-generated questions when the online provider succeeds', async () => {
    await configureOnlineSlot5();
    const result = await generateIeltsPlanWithTierFallback({
      allowBuiltinFallback: true,
      transport: successTransport
    });
    expect(result.source).toBe('online_ai');
    expect(result.plan.id).toContain('session_llm_');
    expect(result.providerName).toBeTruthy();
  });

  it('does not substitute prewritten questions after an AI provider returns HTTP 503', async () => {
    await configureOnlineSlot5();
    await expect(generateIeltsPlanWithTierFallback({
      allowBuiltinFallback: true,
      transport: status503Transport
    })).rejects.toThrow(LlmQuestionGenerationError);
  });

  it('requires an online AI provider when the old offline bank provider is selected', async () => {
    await saveSlotConfig({
      slotId: 'llm_generator',
      providerId: 'offline_bank_gen',
      baseUrl: 'offline://builtin-bank',
      modelOrVoice: 'builtin-v1'
    });
    await expect(generateIeltsPlanWithTierFallback()).rejects.toThrow(/Online AI provider/i);
  });

  it('does not start an IELTS test with a prewritten plan when no AI plan is ready', async () => {
    await ieltsSessionEngine.startSession('part1');
    const snapshot = ieltsSessionEngine.getState();
    expect(snapshot.status).toBe('error');
    expect(snapshot.allowBuiltinFallback).toBe(false);
    expect(snapshot.errorMessage).toMatch(/AI-generated question set|Online AI provider/i);
    expect((ieltsSessionEngine as any).isSessionActive).toBe(false);
  });

  it('uses the actual AI source for an AI-generated session', async () => {
    await configureOnlineSlot5();
    await ieltsSessionEngine.preloadPlan({ transport: successTransport });
    await ieltsSessionEngine.startSession('part1');
    expect(ieltsSessionEngine.getState().questionSource).toBe('AI');
  });

  it('does not resume a saved session from the retired offline bank', async () => {
    const { generateIeltsSessionPlan } = await import('./fixtures/legacyIeltsQuestionBank');
    ieltsSessionEngine.restoreSession({
      mode: 'part1',
      plan: generateIeltsSessionPlan(),
      currentStepIndex: 0,
      completedAnswers: [],
      candidateNotes: '',
      questionSource: 'OFFLINE'
    });
    const snapshot = ieltsSessionEngine.getState();
    expect(snapshot.status).toBe('error');
    expect(snapshot.errorMessage).toContain('older offline version');
    expect((ieltsSessionEngine as any).isSessionActive).toBe(false);
  });
});
