# SpeakCoach — Technical notes, release and backup details

SpeakCoach is an Android app for multilingual Shadowing practice and English IELTS Speaking practice. It is designed to work without a SpeakCoach-operated backend. When you configure online providers, the app sends the relevant request data directly to the provider you selected.

## Important accuracy and privacy notes

- **Android compatibility:** SpeakCoach requires Android 6.0 (API 23) or newer. Android 5.1 (API 22) and older are outside the supported range. Android API keys use AES-256-GCM backed by Android Keystore; the retired API-22 RSA-wrapped AES fallback is not used.

- **AI feedback is for practice, not an official IELTS result.** Online model-generated bands are estimates. They are not certified examiner scores.
- **No prewritten IELTS question bank ships in the production app.** New sessions, replacements and refreshed question sets require online AI generation. Previously generated sets may be saved and reused locally; the retired sample bank exists only as a test fixture.
- **Pronunciation is not currently assigned an IELTS band.** Android/Whisper speech-recognition confidence is not a valid measure of IELTS pronunciation quality. The app keeps pronunciation unassessed rather than inventing a band.
- **Offline examiner voice is labelled.** If an online TTS provider is unavailable, Android native TTS may be used as a basic fallback. The app identifies that offline voice and explains that an online neural voice may sound more natural.
- **Offline recognition is device-dependent.** The Android app uses the system `SpeechRecognizer` service and may request offline recognition where configured. Android's `EXTRA_PREFER_OFFLINE` is a preference, not a guarantee; the recognition service installed on the phone may require network access. SpeakCoach does not currently bundle Vosk or a guaranteed offline speech model.
- **IELTS evaluation requires an online AI API.** If evaluation cannot be completed, the app preserves the recorded answers and transcript in History as pending so the user can retry when an API provider is available. No heuristic offline IELTS score or feedback is generated.
- **Shadowing scores are approximate.** Word matching, transcript alignment, completeness and timing do not perform phoneme-level pronunciation assessment.
- **API keys are sensitive.** On Android, keys are stored through the native AES-GCM / Android Keystore integration. Older keys in legacy Preferences/browser storage are migrated only after a secure write is verified. New Android writes do not silently fall back to plaintext storage.
- **AI Settings backup contains API keys in readable JSON.** Keep the exported file private and delete temporary copies securely. Test-data backups do not contain API keys.
- Android automatic app-data backup is disabled because Keystore-encrypted values cannot be decrypted on a different device without the original Keystore key. Use SpeakCoach's manual backup and restore flow to move settings and data.

## Provider slots

Configure each capability independently in Settings:

| Slot | Purpose | Online provider use | Basic fallback |
|---|---|---|---|
| Voice / TTS | Speak model sentences and examiner prompts | Configured neural TTS providers | Android Text-to-Speech |
| Pronunciation / Shadowing | Compare spoken words with the reference and analyze timing | Configured pronunciation assessment or speech-to-text providers | Android system speech recognition where available, plus approximate word alignment |
| IELTS Speech-to-Text | Transcribe candidate answers | Configured transcription provider | Android system speech recognition where available |
| IELTS Evaluator | Feedback on Fluency, Lexical Resource and Grammar | Configured LLM provider; bands are practice estimates | No offline IELTS evaluation; incomplete answers are saved for retry |
| Question & Sentence Generator | Generate IELTS question sets and shadowing material | Configured LLM provider | No built-in IELTS question fallback; previously generated sets remain stored locally |
| Shadowing Translator | Translate the current Shadowing sentence and selected words | Independently configured online provider | No offline translation; configure an online provider |

A successful provider connection test confirms the tested endpoint responded. It does not certify the provider's assessment accuracy or guarantee that every feature is supported by a custom gateway.

## TTS connection health and Shadowing prefetch

- Gemini TTS connection tests and voice previews bypass the audio cache, so a PASS requires a live provider response. Interactive Gemini synthesis uses a shorter 15-second request timeout; explicit connection tests retain a longer 45-second timeout.
- Playback and prefetch share the same in-flight synthesis promise for an identical account, endpoint, model/voice, language, rate and sentence. This prevents overlapping actions from issuing duplicate TTS requests.
- A saved primary PASS is valid only for the exact provider/base URL/model-or-voice/key fingerprint and expires after 30 days. Existing primary PASS records without a fingerprint are treated as unverified and require a new test after upgrade. Legacy secondary snapshots without fingerprints are accepted only for the 30-day migration window.
- Provider runtime health is tracked independently for API 1 and API 2. HTTP 400/401/403/404 failures require a successful connection re-test; HTTP 429, 5xx and network timeouts apply a temporary cooldown (90 seconds by default, respecting Retry-After when supplied). Health is stored locally and a successful request clears that account's state.
- Shadowing prefetch uses a position-based four-sentence sliding window. Reaching sentence #2, #6, #10, etc. queues the next four not-yet-passed sentences; skipped positions do not stall later windows. A failed/deferred item does not advance the scheduler cursor, and the remainder of a failed batch is retried after user playback or the next position trigger. The Enable audio prefetch setting remains available.
- AI-generated audio for sentences in the active set is stored separately under Capacitor Filesystem `Directory.Data`, indexed by the active set ID and the existing provider/account/model/voice/language/rate/text cache hash. Both Play and Prefetch populate this store; it survives process death and is read before the generic LRU cache, including before tier resolution so saved audio can still play offline/Tier 3. Switching to a genuinely different active set removes the previous set's files; leaving/re-entering the same set or backgrounding does not. Saving a changed Voice/TTS provider, model, endpoint or API key clears the active-set audio store so the next Play/Prefetch uses the new account configuration. A separate RAM layer serves prefetched entries immediately.
- The active-set disk budget is 80,000,000 data-URL characters. Slow-speed and replay extras are evicted before canonical sentence audio; canonical active-set sentences are never evicted to make room for extras. If canonical sentences alone exceed the budget, they are retained rather than deleted. Generic 30-entry LRU eviction cannot remove these files.
- Startup reconciles the active-set index against files and removes missing entries/orphan files and non-active set folders. AI audio files are derived device-local cache and are intentionally excluded from both backup types; successful backup restore clears the active-set audio store. User microphone recordings are never passed to this store.
- Gemini model/language failures (HTTP 400/404) are scoped to provider endpoint, model, voice, account-key fingerprint and language, expire after five minutes, and can be cleared by an explicit connection test. Explicit probes bypass the language-failure guard.
- Whisper STT candidates require a matching configuration/key fingerprint and a connection test younger than 30 days. Primary and secondary runtime health is checked independently; failed accounts enter the same persistent re-test/cooldown state as TTS. When online STT is unavailable or verification has expired, Shadowing exposes an actionable notice and can still use the device recognizer when it produced a transcript.

## Application identity

The application name is **SpeakCoach**. The standalone Android application ID is `com.ariyand.speakcoach`. The **initial public release** was `1.0.0` (`versionCode` 1); the current published app version is `1.0.14` (`versionCode` 14). This is a new installation identity; it is not intended to update an earlier development build. Future SpeakCoach updates are checked against the public GitHub Releases page for `AriyanD/SpeakCoach` and are downloaded and installed only after the user confirms the Android installer prompts. The updater verifies the downloaded APK against the SHA-256 digest published by GitHub before opening Android's package installer. Android may require the user to allow installs from SpeakCoach. All future APKs must retain this application ID and be signed with the same private release keystore.

## In-app updates

SpeakCoach requires Android 6.0 (API 23) or newer. The current updater checks the native Android SDK level before offering or installing an update and refuses API 22 or older. The published 1.0.14 APK predates the source-side API 23 change; its already-installed updater cannot be retrofitted, so Android 5.1 users must not install a future API 23+ APK. Release notes must continue to state the minimum Android version explicitly.

Open **Settings → Software updates** to check the public GitHub Releases page for a newer version. SpeakCoach downloads the matching APK, verifies its SHA-256 checksum against GitHub release metadata, and opens the Android package installer after user confirmation. Android may ask you to allow installs from SpeakCoach. Future releases must use the same Android application ID and persistent signing keystore.

## Manual backup and restore

- **AI Settings backup:** includes provider configuration, primary and secondary API keys, and app preferences. Treat the file like a password vault.
- **Test Data backup:** includes IELTS history, generated IELTS question sets and their previous-generation undo history, seen-question tracking, and the last Shadowing attempt, and saved IELTS evaluation versions. It does not include API keys.
- Restore validates the complete payload before writing. API keys are stored and read back before the app switches to the imported provider configuration. If an import fails, SpeakCoach attempts to restore the previous configuration, keys, preferences and connection status.
- Older supported backups without an API-key section remain importable; existing API keys are left untouched. Older test-data backups without evaluation-history metadata remain valid.

## Build and install

The GitHub Actions workflow runs tests, TypeScript checks, the web build and Android APK builds. Pushing a `v*` tag builds a stable-signed APK and publishes it as a GitHub Release. The in-app update checker reads the latest published Release and downloads the attached `SpeakCoach-vX.Y.Z.apk` asset.

### Local development

Requirements: Node.js 20+ and npm.

```bash
npm ci
npm test
npm run dev
npm run build
```

### Local Android build

Requirements: JDK 21 and Android SDK.

```bash
npm run cap:sync
cd android
./gradlew assembleDebug
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

### Stable release signing

A release APK must be signed with the same keystore on every release to support in-place updates. Create one keystore once and keep a secure offline copy (for example, run `keytool -genkeypair -v -keystore speakcoach-release.keystore -alias speakcoach -keyalg RSA -keysize 2048 -validity 10000`). Add these repository Actions secrets:

- `SPEAKCOACH_RELEASE_KEYSTORE_BASE64`: Base64 encoding of the keystore file (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("speakcoach-release.keystore"))`).
- `SPEAKCOACH_RELEASE_KEYSTORE_PASSWORD`: keystore password.
- `SPEAKCOACH_RELEASE_KEY_ALIAS`: key alias.
- `SPEAKCOACH_RELEASE_KEY_PASSWORD`: key password.

Do not commit the keystore or passwords. Before each future release, keep `package.json`, `src/config/appVersion.ts`, and Android `versionName` synchronized with the `vX.Y.Z` tag, and increment Android `versionCode` for every update. All four secrets are required to publish a GitHub Release. Ordinary branch builds can still upload a debug APK and an unsigned release artifact, but a version tag fails safely unless stable signing is configured. Never lose the keystore or its passwords: every future APK update must use the same application ID and signing certificate. The in-app updater checks for a newer full Release and will not install an unsigned workflow artifact.


## Backup safety
- **AI settings backup with keys** is intended for moving the app to a new device. Treat the exported JSON as a credential file.
- **Settings-only backup without keys** is safer for sharing or cloud storage. It contains provider settings and preferences but no API keys; importing it leaves keys already stored on the device unchanged.
- On Android, API keys are stored using Android Keystore. In a desktop browser, provider keys are kept in browser app storage and are not encrypted by Android Keystore.
- Android automatic app-data backup is disabled to avoid restoring encrypted preferences without the matching Keystore key. Use SpeakCoach's manual backup before reinstalling or changing devices.

For hands-on Android verification, follow [the device test checklist](docs/DEVICE_TEST_CHECKLIST.md).


## Dependency maintenance

The current security baseline uses the latest compatible Capacitor 6 patch line (`6.2.3` for CLI, core and Android), Vite `8.3.8`, and Vitest `4.1.12`. Run `npm audit` for the complete dependency tree and `npm run audit:production` to check production dependencies separately.
