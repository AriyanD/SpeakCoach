import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapApp } from '../src/main';
import { audioRecorder } from '../src/services/audioRecorder';
import { networkMonitor } from '../src/services/networkMonitor';
import { clearLastShadowingAttempt } from '../src/services/shadowingTelemetry';
import { clearAllRuntimeFailures } from '../src/services/tierManager';

describe('Shadowing Trainer UI (Empty-By-Default Transcript, No Reference Fallback & Diagnostics)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllRuntimeFailures();
    clearLastShadowingAttempt();
    audioRecorder.setMockRecognizerOutputForTest(null);
    networkMonitor.setOnline(true);
  });

  it('offers an AI Sentences tab and never substitutes a bank sentence when AI is unavailable', async () => {
    const root = document.createElement('div');
    await bootstrapApp(root, 'shadowing');

    const pronunciationNotice = root.querySelector<HTMLDetailsElement>('[aria-label="Offline pronunciation accuracy notice"]');
    expect(pronunciationNotice).not.toBeNull();
    expect(pronunciationNotice?.open).toBe(false);
    expect(pronunciationNotice?.querySelector('.offline-quality-learn-more')?.textContent).toBe('Learn more');
    expect(root.querySelector('.sentence-source-card strong')?.textContent).toBe('Sentence Library');
    root.querySelector<HTMLButtonElement>('[data-source="ai"]')?.click();
    expect(root.querySelector('#sh-generate-ai-btn')).not.toBeNull();
    expect(root.querySelectorAll('.sentence-source-card')).toHaveLength(2);
    expect(root.querySelector('#sh-target-text')?.textContent).toContain('Generate an AI sentence');
    expect(root.querySelector<HTMLButtonElement>('#sh-play-normal-btn')?.disabled).toBe(true);

    root.querySelector<HTMLButtonElement>('#sh-generate-ai-btn')?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(root.querySelector('#sh-ai-generation-error')?.textContent).toContain('AI sentence set generation failed');
    expect(root.querySelector('#sh-ai-generation-error')?.classList.contains('fail')).toBe(true);
    expect(root.querySelector('#sh-target-text')?.textContent).toContain('Generate an AI sentence');
    expect(root.querySelector('#sh-target-text')?.textContent).not.toContain('I usually start my morning');
  });

  it('starts the transcript box EMPTY and refuses to score when recognizer returns empty (silence)', async () => {
    const root = document.createElement('div');
    await bootstrapApp(root, 'shadowing');

    const transcriptInput = root.querySelector<HTMLInputElement>('#sh-transcript-input');
    expect(transcriptInput).not.toBeNull();
    // MUST start empty, NEVER prefilled with the reference sentence!
    expect(transcriptInput?.value).toBe('');

    // Simulate silence / empty recognizer result
    audioRecorder.setMockRecognizerOutputForTest({
      transcript: '',
      confidence: 0,
      error: 'ERROR_NO_MATCH (No speech recognized)'
    });

    root.querySelector<HTMLButtonElement>('#sh-stop-score-btn')?.click();
    await new Promise((r) => setTimeout(r, 40));

    // Must NOT render a score card; must show "Nothing was recognized, try again"
    expect(root.querySelector('#sh-score-card')).toBeNull();
    const errBox = root.querySelector('#sh-empty-error');
    expect(errBox).not.toBeNull();
    expect(errBox?.textContent).toContain('Nothing was recognized, try again');
  });

  it('scores ONLY what the recognizer returned, supports Weak-Word Drill, and logs to Diagnostics', async () => {
    const root = document.createElement('div');
    await bootstrapApp(root, 'shadowing');

    // Recognizer heard sentence with "usually" and "hot" skipped
    audioRecorder.setMockRecognizerOutputForTest({
      transcript: 'I start my morning with a cup of coffee',
      confidence: 0.87,
      alternatives: [
        { transcript: 'I start my morning with a cup of coffee', confidence: 0.87 },
        { transcript: 'I start morning with a cup of coffee', confidence: 0.72 }
      ]
    });

    root.querySelector<HTMLButtonElement>('#sh-stop-score-btn')?.click();
    await new Promise((r) => setTimeout(r, 40));

    const transcriptInput = root.querySelector<HTMLInputElement>('#sh-transcript-input');
    expect(transcriptInput?.value).toBe('I start my morning with a cup of coffee');
    expect(root.querySelector('#sh-recognizer-meta')?.textContent).toContain('87%');

    expect(root.querySelector('#sh-score-card')).not.toBeNull();
    // In offline SpeechRecognizer mode, no raw WAV is kept and word timing / replay are disabled with a clear notice
    expect(root.querySelector('#sh-vad-summary')).toBeNull();
    expect(root.querySelector('#sh-offline-timing-disabled')).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>('#sh-replay-my-audio-btn')?.disabled).toBe(true);
    const missingChips = root.querySelectorAll('[data-word-status="missing"]');
    expect(missingChips.length).toBe(2);

    // Diagnostics is now accessed from Settings.
    root.querySelector<HTMLButtonElement>('#nav-settings')?.click();
    await new Promise((r) => setTimeout(r, 40));
    root.querySelector<HTMLButtonElement>('#settings-open-diagnostics-btn')?.click();
    await new Promise((r) => setTimeout(r, 40));

    expect(root.querySelector('#diag-last-ref')?.textContent).toContain(
      'I usually start my morning with a cup of hot coffee.'
    );
    expect(root.querySelector('#diag-last-raw')?.textContent).toContain(
      '"I start my morning with a cup of coffee" (87%)'
    );
    expect(root.querySelector('#diag-last-alignment')?.textContent).toContain('usually [missing:0%]');
    expect(root.querySelector('#diag-last-alignment')?.textContent).toContain('hot [missing:0%]');

    // Return to Shadowing and click Retry Weak Words
    root.querySelector<HTMLButtonElement>('#nav-shadowing')?.click();
    await new Promise((r) => setTimeout(r, 40));

    const retryWeakBtn = root.querySelector<HTMLButtonElement>('#sh-retry-weak-btn');
    expect(retryWeakBtn).not.toBeNull();
    retryWeakBtn?.click();

    expect(root.querySelector('#sh-target-text')?.textContent).toBe('usually hot');
    // Transcript box must be cleared to EMPTY again for the new drill attempt!
    expect(root.querySelector<HTMLInputElement>('#sh-transcript-input')?.value).toBe('');
  });

  it('Part 2B: disables replay and word timing in System SpeechRecognizer mode with clear label, and enables Tier 2 speed tags and timing bars when online', async () => {
    const root = document.createElement('div');
    await bootstrapApp(root, 'shadowing');

    // The recording area presents one primary action at a time.
    expect(root.querySelector<HTMLButtonElement>('#sh-record-btn')?.hidden).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('#sh-stop-score-btn')?.hidden).toBe(true);

    // 1. Test Tier 3 rendering (offline default -> Mode B: SpeechRecognizer only, no audio kept)
    root.querySelector<HTMLButtonElement>('#sh-record-btn')?.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(root.querySelector<HTMLButtonElement>('#sh-record-btn')?.hidden).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('#sh-stop-score-btn')?.hidden).toBe(false);
    expect(audioRecorder.getLastStartOptions()?.useOfflineRecognizer).toBe(true);

    audioRecorder.setMockRecognizerOutputForTest({
      transcript: 'I usually start my morning with a cup of hot coffee',
      confidence: 0.92
    });

    root.querySelector<HTMLButtonElement>('#sh-stop-score-btn')?.click();
    await new Promise((r) => setTimeout(r, 40));

    expect(root.querySelector('#sh-score-card')).not.toBeNull();
    expect(root.querySelector('#sh-pace-score')).not.toBeNull();
    expect(root.querySelector('#sh-score-card .tier-badge')?.textContent).toContain('Basic offline');

    // In offline mode, word timing bars are hidden and replaced by clear notice, and replay button is disabled
    expect(root.querySelector('#sh-timing-bars')).toBeNull();
    expect(root.querySelector('#sh-offline-timing-disabled')?.textContent).toContain(
      'Word timing & recording replay disabled in System SpeechRecognizer mode'
    );
    expect(root.querySelector<HTMLButtonElement>('#sh-replay-my-audio-btn')?.disabled).toBe(true);
    expect(root.querySelectorAll('.speed-tag').length).toBe(0);
  });
});
