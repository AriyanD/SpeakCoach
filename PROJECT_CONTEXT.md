# SpeakCoach — Project Context & Handover

> Purpose: this file is the durable handover document for future ChatGPT sessions. Read it together with the current source code before making changes. The repository is the source of truth for current implementation; this document records the verified baseline and important decisions, not a substitute for inspecting code.

**Last inspected:** 2026-11-22  
**Repository:** https://github.com/AriyanD/SpeakCoach  
**Default branch:** `main`  
**Latest inspected main commit:** `ef8e8b16423de3a9bc16fde6cbb02fab4da54a66`  
**Latest published release at inspection:** `v1.1.0`  
**Current source version:** `1.1.0`, Android `versionCode 15`

---

## 1. What the project is

SpeakCoach is a standalone Android practice app for:
- Multilingual Shadowing practice.
- English IELTS Speaking practice (Full test, Part 1, Part 2 and Part 3).

The product is **BYOK (Bring Your Own Key)**: users configure their own AI providers and credentials. There is no SpeakCoach-operated application backend, account system, or subscription. When online features are used, requests go directly from the device to the configured provider.

The interface supports English and Persian. Shadowing offers a multilingual sentence catalogue; IELTS prompts and examiner feedback are in English.

Public repository description: Android app for English shadowing and IELTS Speaking practice; Gemini, Whisper/Groq and OpenAI-compatible providers; no backend; keys protected with Android Keystore.

## 2. Current verified technical baseline

| Area | Current source configuration |
|---|---|
| App name | SpeakCoach |
| Android application ID / namespace | `com.ariyand.speakcoach` |
| App version | `1.1.0` |
| Android versionCode | `15` |
| Minimum Android | API 23 (Android 6.0); API 22 and older are unsupported |
| Compile / target SDK | 34 / 34 |
| Platform wrapper | Capacitor 6 |
| UI / language | TypeScript, vanilla DOM, Vite |
| Tests | Vitest, jsdom; Android unit tests in Gradle |
| Build workflow | GitHub Actions, `.github/workflows/build-apk.yml` |
| Local requirements | Node.js 20+ and npm; JDK 21 + Android SDK for APK |
| CI Node / JDK | Node 22 / JDK 21 |

Key package versions read from `package.json`: Capacitor Android/core `^6.1.2`, Capacitor CLI `6.2.3`, TypeScript `^5.6.2`, Vite `^8.3.8`, Vitest `^4.1.12`. The compatibility script intentionally guards the app at Capacitor 6 and SDK 34.

The app's version is also exposed in `src/config/appVersion.ts`. Keep that value, `package.json`, Android `versionName`, and release tag synchronized. Increment Android `versionCode` for every new Android update.

## 3. Product capabilities

### 3.1 Shadowing Trainer
- Built-in multilingual sentence material organised by language, topic and difficulty.
- AI-generated sentence sets (currently described in the README as 20 sentences), optionally topic-directed, with set history.
- Sentence playback, speed control (including 0.72×), recording, transcript/word matching and approximate timing/alignment feedback.
- Word chips and replay controls; replay of the learner's own recording where available.
- Approximate feedback for completeness, fluency, pace and word matching. This is not phoneme-level pronunciation assessment unless a real pronunciation assessment provider is configured.
- AI TTS audio for the active set is persisted locally for fast replay, including after process restart; it is a cache, not user microphone recording.

### 3.2 IELTS Speaking
- Full test, Part 1, Part 2 and Part 3.
- AI-generated question sets, with topic/random generation, saved sets and previous-generation history/undo.
- Part 2 preparation countdown and notes.
- Recording and speech-to-text, session/history persistence, per-criterion feedback, corrections, vocabulary upgrades and re-evaluation.
- Re-evaluation can select automatic routing, API 1 or API 2. Successful evaluation versions are retained; failed retries must not overwrite a previously valid score.
- Interrupted or unevaluated answers are preserved in History so evaluation can be retried later.

### 3.3 Six independent provider slots
Provider configuration is independent per capability; API 2 is an optional backup account per slot.

1. Voice / Text-to-Speech.
2. Shadowing speech-to-text / pronunciation analysis.
3. IELTS speech-to-text.
4. IELTS evaluator.
5. Question & sentence generator.
6. Shadowing translator.

Provider families in source/docs include Google Gemini, OpenAI-compatible services and custom gateways, Azure speech services, ElevenLabs, Whisper-compatible services such as Groq, and Android native speech/TTS fallbacks where supported. Exact model names and provider capabilities change; inspect `src/config/providers.ts` and the relevant service before recommending or changing a model.

Connection verification is bound to provider, endpoint, model/voice and key fingerprint, and expires after 30 days. Runtime health is tracked separately for API 1 and API 2. Authentication/configuration failures require re-test; rate limits, server errors and timeouts use cooldown behaviour. Bulk “Test all APIs” runs sequentially and can be cancelled between probes; a slot's verification is saved only when all configured online accounts for that slot pass.

## 4. Privacy, security and data handling

- No SpeakCoach-operated backend or analytics backend is described by the project.
- Android API keys are encrypted using AES-256-GCM backed by Android Keystore through the native secure-key plugin.
- Android API-22 RSA-wrapped AES fallback is intentionally not supported because minimum Android is API 23.
- Legacy Preferences/browser keys may be migrated, but the old copy should only be removed after a secure write is verified.
- Android automatic app-data backup is disabled. Use the in-app manual backup/restore flow.
- **AI Settings backup may contain API keys in readable JSON. Treat it like a password vault.** Never commit it, attach it to public issues, or place it in this context file.
- Test Data backup excludes API keys. It includes IELTS history/generated sets and related state, plus saved evaluation history and Shadowing data as documented in technical notes.
- AI-generated voice audio is a device-local cache and is excluded from backups. User microphone recordings are not placed in that TTS cache.
- Diagnostics must redact API keys and credentials.
- The in-app updater downloads release APKs and verifies their SHA-256 against GitHub release metadata before asking Android to install.

## 5. Honest product limitations (must remain explicit)

- AI IELTS bands are practice estimates, not official IELTS scores.
- Pronunciation is shown as “Not assessed” unless a validated pronunciation-assessment provider actually supplies a pronunciation assessment. Speech-recognition confidence is not a valid IELTS pronunciation score.
- Shadowing scores are approximate word matching/alignment/timing; they are not phoneme-level assessment.
- There is no prewritten IELTS question bank bundled in production. New IELTS sets/replacements require online AI generation; previously generated sets can remain locally available.
- IELTS evaluation requires an online AI evaluator. If unavailable, preserve answers for later retry; do not invent an offline heuristic score.
- Android system speech recognition and `EXTRA_PREFER_OFFLINE` do not guarantee offline recognition; availability depends on the device's installed speech service. The project does not bundle Vosk as a guaranteed offline recognizer.
- Native Android TTS is a basic fallback and should be identified as such.

## 6. Architecture and important source locations

The source tree is organised into:
- `src/ui/`: Shadowing, IELTS, History, Settings, Onboarding and diagnostics views.
- `src/services/`: provider routing/fallback, connection tests, health, HTTP, TTS, STT, audio cache/store, prefetch, alignment/scoring, IELTS generation/evaluation/session logic, translation, backup, updater and diagnostics.
- `src/storage/`: app settings, key storage, local storage and IELTS history.
- `src/config/`: app version, provider catalogue and shared types.
- `src/data/`: language catalogues, multilingual Shadowing sentence data and IELTS question types.
- `android/app/src/main/java/com/ariyand/speakcoach/plugins/`: native Java plugins for secure keys, speech, backup/restore, update installation and navigation.
- `tests/`: Vitest regression suite.
- `docs/`: technical notes, device test checklist and screenshots.
- `.github/workflows/build-apk.yml`: CI, Android builds and release publishing.

Architecture decisions are also recorded in `DECISIONS.md`; detailed implementation/release notes in `docs/TECHNICAL_NOTES.md`; real-device verification cases in `docs/DEVICE_TEST_CHECKLIST.md`.

## 7. Shadowing audio persistence and prefetch — important behaviour

The technical notes describe these deliberate rules:
- Prefetch is position-based, in windows of four sentences, triggered at sentence positions #2, #6, #10, etc. Skipping positions must not stall later windows.
- Failed/deferred items do not advance the scheduler cursor; retry is possible after playback or the next position trigger.
- Playback and prefetch share an in-flight synthesis promise for identical provider/account/configuration/text to avoid duplicate requests.
- Active-set AI audio persists under Capacitor Filesystem `Directory.Data`, keyed by active set and synthesis configuration. It survives process death but is excluded from backups.
- Switching to a genuinely different active set removes the previous set's stored audio. Changing the Voice/TTS provider, endpoint, model or key clears the active-set cache.
- The documented active-set disk budget is about 30 MB decoded audio; canonical sentence audio is prioritised over slow-speed/replay extras.
- The Enable audio prefetch setting remains available.
- TTS health, connection verification and cooldown are independent for API 1 and API 2.

Before altering this behaviour, read `src/services/shadowingPrefetch.ts`, `shadowingAudioStore.ts`, `ttsService.ts`, `providerHealth.ts` and their tests.

## 8. Build, test and release workflow

Useful commands:
```bash
npm ci
npm test
npm run build
npm run check:android-compat
npm run cap:sync
cd android && ./gradlew testDebugUnitTest
cd android && ./gradlew assembleDebug
```

The build workflow runs Android compatibility validation, a production dependency audit, unit tests, TypeScript + Vite build, Capacitor sync, Android unit tests and Debug/Release APK builds. It also scans for retired account/repository/package/icon references and checks that the retired prewritten IELTS question bank is not bundled.

Pushing a `v*` tag triggers release validation and publishing. For a signed release, all four GitHub Actions secrets must exist:
- `SPEAKCOACH_RELEASE_KEYSTORE_BASE64`
- `SPEAKCOACH_RELEASE_KEYSTORE_PASSWORD`
- `SPEAKCOACH_RELEASE_KEY_ALIAS`
- `SPEAKCOACH_RELEASE_KEY_PASSWORD`

A persistent release keystore is essential: all future update APKs must keep the same application ID and signing certificate. Keep a secure offline backup of the keystore and passwords. Never put the keystore or passwords in Git.

Branch builds can still create debug and unsigned release artifacts if signing secrets are absent, but a version-tag release is designed to fail safely unless stable signing is configured. The in-app updater only offers signed APK assets attached to published full Releases.

## 9. Release history and current GitHub state (inspection on 2026-11-22)

- Latest published GitHub Release: `v1.1.0`, published 2026-11-21, with asset `SpeakCoach-v1.1.0.apk`.
- Source `package.json`, `src/config/appVersion.ts` and Android Gradle files currently report `1.1.0`; Android versionCode is `15`.
- PR #46 delivered the 1.1.0 API 2 redesign and Shadowing Trainer improvements.
- PR #47 and #48 updated README/screenshots and coffee-support graphics; both are merged.
- PRs #1–#48 returned by the inspected GitHub pull request listing are closed; no open PR appeared in that listing.
- Current branch listing returned only `main` (protected) and `docs/refresh-readme-and-screenshots` (unprotected). The latter's PRs #47/#48 are merged, so it appears to be a leftover branch; verify it is no longer needed and that the user's local backup is complete before deleting it.
- Latest inspected main commit is `ef8e8b16423de3a9bc16fde6cbb02fab4da54a66` (2026-11-21 21:14 UTC), following the README updates and cleanup of temporary coffee images.
- The combined commit-status endpoint returned no status entries for that latest commit at inspection. This is **not** proof that tests failed or passed. Check the latest Actions run directly before relying on CI status.

### Documentation drift to fix

At inspection, `docs/TECHNICAL_NOTES.md` and `DECISIONS.md` still contain statements that the current published version is `1.0.14` / versionCode `14`. This conflicts with the current source and Release page (`1.1.0` / versionCode `15`). Treat package/Gradle/appVersion and the actual Releases page as current truth; update the stale documentation in a separate, reviewed documentation change.

## 10. Previous release and branch work

Recent merged changes include:
- #46: API 2 redesign / six-slot settings parity, connection verification and Shadowing UI improvements.
- #43: IELTS retry feedback, Shadowing layout and API testing.
- #42: persistent active-set Shadowing audio and position-based prefetch.
- #41: TTS connection verification and prefetch reliability.
- #40: privacy, prefetch controls and Android update safety.
- #39: slow Shadowing TTS and stop-control fix.
- #37 and #31: Android minimum version moved to API 23; API 22 support deliberately dropped.
- #36/#34/#28: test and template cleanup.
- #47/#48: README and screenshot documentation updates.

Earlier branch cleanup discussion identified several merged/superseded branches and the user said they have a local backup. However, **completion/verification of the local backup was not confirmed in the available conversation**. Do not assume it is done. The current branch listing now shows the additional docs branch noted above.

## 11. User's collaboration preferences — follow these

- Be direct and transparent about what can and cannot actually be done. Never claim a GitHub action, test, build, device check or file edit succeeded unless the tool/result confirms it.
- Prefer doing the work, not merely describing a sequence of steps, when the connected tools permit it.
- Work sequentially rather than starting conflicting edits/actions in parallel. Do not create unnecessary back-and-forth or ask the user to approve every safe, reversible step.
- Before modifying code, inspect the latest `main` and the relevant files/PRs/commits. Do not assume an old chat's branch or version is still current.
- The user prefers complete replacement files/finished implementations over fragmented patch instructions when practical.
- Test changes thoroughly (TypeScript, unit tests, Android build/compatibility and real-device checks where available). Clearly separate CI checks from tests that require the user's physical Android phone.
- Keep the working version recoverable. The user maintains local backups; confirm backup status before destructive branch/repository cleanup.
- Do not weaken security, remove safeguards, change app identity, lower Android minimum, or alter release signing without a clear reason and explicit discussion.
- Keep secrets out of source, logs, documentation, screenshots and commits.
- When a task is complete, report exactly what changed, commit/PR reference, tests run and anything still unverified.

## 12. Start-of-session checklist for future work

Whenever the user returns with the repository link:
1. Read this file, but treat it as historical context.
2. Fetch the current `main` HEAD, branch list, open PRs and latest release.
3. Compare current version values across `package.json`, `src/config/appVersion.ts`, `android/app/build.gradle` and tags/releases.
4. Read the relevant source and tests before changing anything.
5. Check the latest Actions run/status; do not infer CI status from a missing status response.
6. Confirm whether local backup is complete before deleting branches or doing destructive cleanup.
7. Make one coherent change at a time, test it, then continue.
8. Update this file when architecture, release state, important decisions or project workflow materially changes.

---

## Quick resume prompt

When opening a new ChatGPT conversation, the user can say:

> Continue work on SpeakCoach: https://github.com/AriyanD/SpeakCoach . First read `PROJECT_CONTEXT.md`, then independently inspect the latest main branch, releases, branches and PRs. Treat GitHub source as authoritative over old chat summaries. Follow the collaboration preferences in the context file, verify before changing anything, and continue from the actual current repository state.
