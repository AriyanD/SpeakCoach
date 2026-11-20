<div align="center">

<img src="public/speakcoach-symbol.svg" alt="SpeakCoach logo" width="96" height="96">

# SpeakCoach

**Multilingual Shadowing and IELTS Speaking practice for Android — bring your own AI, no backend, your keys stay on your phone.**

[English](README.md) · [فارسی](README.fa.md)

[![Latest release](https://img.shields.io/github/v/release/AriyanD/SpeakCoach?label=release)](https://github.com/AriyanD/SpeakCoach/releases/latest)
[![Build](https://github.com/AriyanD/SpeakCoach/actions/workflows/build-apk.yml/badge.svg)](https://github.com/AriyanD/SpeakCoach/actions/workflows/build-apk.yml)
![Platform](https://img.shields.io/badge/platform-Android-3DDC84)
![Capacitor](https://img.shields.io/badge/Capacitor-6-119EFF)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)

<img src="docs/screenshots/overview-light.png" alt="SpeakCoach screens: Shadowing, IELTS, history and settings" width="100%">

### ☕ [If SpeakCoach helps you, buy me a coffee](https://www.coffeebede.com/ariyand)

</div>

> Screenshots were captured from the app UI with **clearly fictional sample data** (sample question sets and one sample result). No real provider or account is shown.

## What is SpeakCoach?

SpeakCoach is a practice coach for people who want to practise Shadowing in multiple languages and prepare for the IELTS Speaking test. It has two main tools:

- **Shadowing Trainer** – listen to a sentence, repeat it, and get word-level feedback on what you said and how closely your timing followed the model.
- **IELTS Speaking** – practise Full test, Part 1, Part 2 (with a preparation timer and notes) or Part 3 using AI-generated question sets, then receive a practice-estimate evaluation.

There is **no SpeakCoach server and no subscription**. You connect your own AI providers (for example Google Gemini or Groq/Whisper) and the app talks to them directly from your device.

## Features

### Shadowing
- Built-in sentence library by **topic** and **difficulty** (Easy / Medium / Hard).
- **AI-generated sentences** on demand, optionally on a topic you choose.
- Playback with **speed control**, word-by-word alignment and timing, and replay of your own recording where available.
- Approximate scores for pronunciation, fluency, pace and completeness, with weak words highlighted for a quick retry.

### IELTS Speaking
- Modes: **Full test, Part 1, Part 2, Part 3**.
- **AI-generated question sets** (optional topic or random topic), reusable and restorable, with an undo for the last generation.
- Part 2 **preparation countdown and notes**.
- **History and trends**, per-criterion feedback, corrections, vocabulary upgrades, and **re-evaluation** with a chosen provider.
- Interrupted sessions keep your answers so you can retry evaluation later.

### Flexible AI, with fallbacks
Five independent provider slots, each with **API 1 → API 2 fallback** and an offline tier where one is possible:

| Slot | What it does | Basic fallback |
|---|---|---|
| Voice / TTS | Reads model sentences and examiner prompts | Android Text-to-Speech |
| Pronunciation / Shadowing | Transcribes and aligns your shadowing attempt | Android speech recognition + approximate alignment |
| IELTS Speech-to-Text | Transcribes IELTS answers | Android speech recognition |
| IELTS Evaluator | Fluency, Lexical Resource, Grammar feedback | None – answers are saved for retry |
| Question & Sentence Generator | Creates IELTS sets and shadowing sentences | Previously generated sets stay available |

Supported provider types include OpenAI-compatible endpoints, custom OpenAI-compatible gateways, Azure, ElevenLabs, Google Gemini, Whisper-style transcription (for example Groq) and Android's built-in speech services.

### Built for real phones
- **Guided first launch** in **English or فارسی** with a 7-page setup guide (where to get API keys, which slot does what, a ready-to-paste prompt for asking a chatbot for help).
- **Light / Dark / System** theme.
- **Manual backup & restore** of AI settings (with keys, treat as a password file) or test data (without keys).
- **In-app updates** from GitHub Releases, verified with SHA-256 before install.
- Redacted diagnostics page for troubleshooting without leaking keys.

### Privacy and security
- No analytics backend and no SpeakCoach-operated server; requests go straight to the providers you configure.
- API keys are stored with **Android Keystore (AES-GCM)** and are never silently downgraded to plaintext.
- Android automatic cloud backup is disabled; use the manual backup instead.
- Microphone and TTS are released when the app goes to the background.

## Honest limitations

SpeakCoach is a practice tool, not an exam:

- **AI bands are practice estimates, not official IELTS scores.**
- **Pronunciation is not given an IELTS band.** Speech-recognition confidence is not a valid pronunciation measure, so the app marks it "Not assessed".
- **Shadowing scores are approximate** (word matching, alignment, timing); there is no phoneme-level assessment.
- **No built-in IELTS question bank.** Question sets need an online AI provider; sets you generated earlier stay available offline.
- **Offline recognition depends on your phone.** Android's recognizer may still need a network connection.
- Online AI features use **your** provider accounts and quota. A successful connection test does not certify a provider's accuracy.

## Install

1. Open the [**Releases**](https://github.com/AriyanD/SpeakCoach/releases/latest) page and download `SpeakCoach-vX.Y.Z.apk`.
2. Allow installation from your browser/file manager when Android asks, then open the APK.
3. Launch SpeakCoach, choose your language and follow the setup guide.

Requires Android; see [docs/DEVICE_TEST_CHECKLIST.md](docs/DEVICE_TEST_CHECKLIST.md) for the manual device test list.

## Quick start

1. **Get an API key.** Free-tier friendly options: [Google AI Studio](https://aistudio.google.com/app/apikey) (Gemini) and [Groq](https://console.groq.com/keys) (Whisper transcription).
2. In **Settings**, open a slot, choose a provider, paste your key, **Test**, then **Save**. Do the same for the slots you want.
3. **Shadowing:** pick a topic and level, listen, then record yourself.
4. **IELTS:** tap *Get new question sets*, choose a mode and start practising. Review the feedback in *Test History*.

## Build from source

Requirements: Node.js 20+ and npm (JDK 21 and the Android SDK for APKs).

```bash
npm ci
npm test            # Vitest suite
npm run dev         # browser dev server (see MOBILE_PREVIEW.md)
npm run build       # type-check + production web build

npm run cap:sync    # build and sync to Android
cd android && ./gradlew assembleDebug
```

Pushing a `v*` tag runs the GitHub Actions workflow and publishes a signed `SpeakCoach-vX.Y.Z.apk` release. Signing secrets, version syncing, in-app update rules, backup semantics and dependency notes are documented in [docs/TECHNICAL_NOTES.md](docs/TECHNICAL_NOTES.md).

## Tech stack

TypeScript · vanilla DOM UI · Vite · Capacitor 6 (Android) · Vitest · GitHub Actions. Design decisions are recorded in [DECISIONS.md](DECISIONS.md).

## Documentation

- [Technical notes: release, signing, updates, backups](docs/TECHNICAL_NOTES.md)
- [Device test checklist](docs/DEVICE_TEST_CHECKLIST.md)
- [Architecture decisions](DECISIONS.md)
- [Mobile preview in the browser](MOBILE_PREVIEW.md)

## Screenshots

| Language | Setup guide | Shadowing |
|:--:|:--:|:--:|
| <img src="docs/screenshots/light-01-language.png" width="240" alt="Language selection"> | <img src="docs/screenshots/light-02-setup-guide.png" width="240" alt="Setup guide"> | <img src="docs/screenshots/light-03-shadowing.png" width="240" alt="Shadowing Trainer"> |

| IELTS | Test history (sample) | Settings |
|:--:|:--:|:--:|
| <img src="docs/screenshots/light-04-ielts.png" width="240" alt="IELTS Speaking"> | <img src="docs/screenshots/light-05-ielts-history.png" width="240" alt="IELTS history with sample result"> | <img src="docs/screenshots/light-06-settings.png" width="240" alt="AI provider settings"> |

<details>
<summary>Dark theme</summary>

<img src="docs/screenshots/overview-dark.png" alt="SpeakCoach in dark theme" width="100%">

</details>

## License

No license file has been added to this repository yet. Until one is added, all rights are reserved by the author.
