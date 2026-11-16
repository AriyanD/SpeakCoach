import { beforeEach, describe, expect, it } from 'vitest';
import { applyLanguageToDocument } from '../src/services/appLanguage';

describe('App language and RTL localization', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="app">
        <nav><button id="nav-shadowing"><span>Shadowing</span></button></nav>
        <label for="api-key">API Key</label>
        <input id="api-key" placeholder="Enter your API key..." />
        <label for="provider">Provider</label>
        <input id="provider" value="Google" />
        <p id="question-count">Question 1 of 5</p>
        <div class="ielts-question-text">Describe a place you enjoy visiting.</div>
        <div class="ielts-cue-card"><div class="ielts-cue-card-bullets">Work and careers</div></div>
        <div class="sentence-box">Technology in daily life can change how people communicate.</div>
        <p class="ielts-criterion-comment">Your fluency was strong throughout the response.</p>
        <p id="backup-intro">Provider choices, model names, connection settings and preferences are saved here. You can export them with or without API keys.</p>
        <p id="backup-warning"><strong>Export AI settings</strong> includes your API keys. Anyone who gets that file could use those keys. Keep it private and store it securely. For sharing or cloud storage, use the no-key export instead.</p>
        <p id="shadowing-notice">Offline feedback uses Android's system SpeechRecognizer and approximate word/timing checks. It is still useful for practising repetition, fluency and matching the target sentence, but it is not a precise pronunciation score. For more dependable transcription and word-level timing, connect and test an online speech-to-text provider in Slot 2 (for example, Groq Whisper when available for your account). This improves the information available to the practice feedback, but true phoneme-level pronunciation assessment requires a dedicated pronunciation-assessment service.</p>


        <p id="evaluator-offline">IELTS evaluation requires an online AI API. Offline IELTS evaluation is not available.</p>
        <p id="secondary-provider-help">Configure a separate provider and key. It is used if the primary fails. Speech recognition rotates between verified providers.</p>
        <p id="no-speech">No clear speech was detected. You can record your answer again, or continue without answering this question.</p>
        <p id="voice-fallback">Using the basic Android voice. Online TTS was unavailable for this question.</p>
        <p id="reevaluation-failure">If the API connection fails, your answers remain saved in History. Re-evaluate after restoring the connection. Choose API 1 or API 2 separately only when comparing models; Automatic tries API 1 and falls back to API 2.</p>
        <p id="settings-backup-summary">AI settings can be exported with API keys for device migration, or without keys for safer sharing. Importing a no-key backup leaves the API keys already stored on this device unchanged.</p>
        <p id="updates-guidance">Check the official SpeakCoach GitHub releases for a newer version.</p>
        <p id="about-disclaimer">It is not an official IELTS score or a substitute for a certified examiner.</p>
        <p id="secure-storage">Securely stored on this device</p>
        <p id="diagnostics-empty">Take an IELTS mock test to view band telemetry and detailed criteria breakdown here.</p>
      </div>
    `;
  });

  it('translates interface labels and restores the original English text and placeholders', () => {
    applyLanguageToDocument('fa');

    expect(document.documentElement.lang).toBe('fa');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.querySelector('#nav-shadowing span')?.textContent).toBe('شَدوئینگ');
    expect(document.querySelector('#api-key')?.getAttribute('placeholder')).toBe('API Key خود را وارد کنید…');
    expect(document.querySelector('#question-count')?.textContent).toBe('سؤال 1 از 5');
    expect(document.querySelector('#provider')?.previousElementSibling?.textContent).toBe('Provider');

    applyLanguageToDocument('en');

    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.querySelector('#nav-shadowing span')?.textContent).toBe('Shadowing');
    expect(document.querySelector('#api-key')?.getAttribute('placeholder')).toBe('Enter your API key...');
    expect(document.querySelector('#question-count')?.textContent).toBe('Question 1 of 5');
  });


  it('translates remaining evaluator, provider, recording and diagnostics messages', () => {
    applyLanguageToDocument('fa');

    expect(document.querySelector('#evaluator-offline')?.textContent).toContain('ارزیابی آفلاین IELTS در دسترس نیست');
    expect(document.querySelector('#secondary-provider-help')?.textContent).toContain('اگر Provider اصلی از کار بیفتد');
    expect(document.querySelector('#no-speech')?.textContent).toContain('گفتار واضحی تشخیص داده نشد');
    expect(document.querySelector('#voice-fallback')?.textContent).toContain('صدای پایهٔ Android');
    expect(document.querySelector('#reevaluation-failure')?.textContent).toContain('پاسخ‌های شما در تاریخچه باقی می‌مانند');
    expect(document.querySelector('#diagnostics-empty')?.textContent).toContain('یک آزمون آزمایشی IELTS انجام دهید');
    expect(document.querySelector('#settings-backup-summary')?.textContent).toContain('برای اشتراک‌گذاری امن‌تر');
    expect(document.querySelector('#updates-guidance')?.textContent).toContain('انتشارهای رسمی SpeakCoach');
    expect(document.querySelector('#about-disclaimer')?.textContent).toContain('جایگزین ارزیابی ممتحن معتبر نمی‌شود');
    expect(document.querySelector('#secure-storage')?.textContent).toContain('به‌صورت امن در این دستگاه');

  });

  it('leaves IELTS prompts, Shadowing practice text and generated feedback in English', () => {
    applyLanguageToDocument('fa');

    expect(document.querySelector('.ielts-question-text')?.textContent).toBe('Describe a place you enjoy visiting.');
    expect(document.querySelector('.ielts-cue-card-bullets')?.textContent).toBe('Work and careers');
    expect(document.querySelector('.sentence-box')?.textContent).toBe('Technology in daily life can change how people communicate.');
    expect(document.querySelector('.ielts-criterion-comment')?.textContent).toBe('Your fluency was strong throughout the response.');
  });


  it('fully translates AI backup and Shadowing accuracy guidance into Persian', () => {
    applyLanguageToDocument('fa');

    expect(document.querySelector('#backup-intro')?.textContent).toContain('انتخاب Providerها');
    expect(document.querySelector('#backup-intro')?.textContent).toContain('می‌توانید از آن‌ها همراه API Key یا بدون کلید خروجی بگیرید');
    expect(document.querySelector('#backup-intro')?.textContent).not.toMatch(/Bandwave|SpeakCoach|نسخه‌های پشتیبان قدیمی|نام قدیمی برنامه/);
    expect(document.querySelector('#backup-warning')?.textContent).toContain('شامل API Keyهای شماست');
    expect(document.querySelector('#backup-warning')?.textContent).toContain('خروجی بدون کلید');
    expect(document.querySelector('#shadowing-notice')?.textContent).toContain('برای تبدیل گفتار به متن و زمان‌بندی قابل‌اتکاتر');
    expect(document.querySelector('#shadowing-notice')?.textContent).toContain('Slot 2');
  });
});
