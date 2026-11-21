# SpeakCoach Android device verification checklist

These checks require a real Android device. CI unit tests and APK compilation do not replace them. Run them on a test device first; do not uninstall an existing installation until its backups have been exported and verified.

## 1. API key persistence and migration
- [ ] Save a primary API key in each applicable slot and a secondary key in at least one slot.
- [ ] Force-close and relaunch SpeakCoach; verify each key is still present (masked) and each provider can be tested.
- [ ] Save a settings-only backup and confirm its JSON contains no `apiKeys` property.
- [ ] Save an AI settings backup with keys; confirm both primary and secondary credentials are present.
- [ ] Restore the with-keys backup on a separate test install and verify all keys by running provider tests.
- [ ] Restore the no-keys backup over an install with existing keys; verify those keys remain unchanged.
- [ ] Upgrade from the previous app build and confirm legacy Preferences keys migrate to Android Keystore without being cleared before read-back succeeds.
- [ ] If Keystore access is unavailable, confirm Settings displays a recovery warning and refuses to overwrite an unreadable key with an empty value.

## 2. Backup and restore failure handling
- [ ] Export test data with IELTS history, generated question sets, previous question-set generations, and Shadowing history.
- [ ] Restore it on a second test install and verify counts and recent entries.
- [ ] Import an invalid/incomplete AI settings backup; confirm provider settings and keys remain unchanged.
- [ ] Import an older AI settings backup without an `apiKeys` section; confirm existing keys remain unchanged.
- [ ] Confirm a failed restore reports whether rollback completed. Keep the app open if it reports incomplete rollback.

## 3. IELTS question generation and scoring
- [ ] With Slot 5 verified, refresh the library and confirm five AI-generated sets appear.
- [ ] Turn off network access and attempt refresh; confirm existing sets remain and no prewritten fallback question appears.
- [ ] Start an IELTS session and toggle Wi-Fi/mobile data; confirm the active question, recording, and session state are not reset by connectivity changes.
- [ ] With no verified evaluator configured, finish a test; confirm answers are saved in History and evaluation can be retried when an API is available.
- [ ] Re-evaluate a saved test using API 1, then API 2; confirm each successful evaluation remains in the result's evaluation history.
- [ ] Export a test-data backup after multiple evaluations, restore it, and confirm all evaluation versions remain available.
- [ ] Test a Gemini request through the normal connection and through the user's VPN/custom gateway; confirm the configured authentication style works and the API key is not added to the URL for official Gemini endpoints.
- [ ] Start, complete, and save a Full Mock Test; verify history, answer text, source/provider metadata, and question-set completion state.
- [ ] Test Part 1, Part 2 and Part 3 separately, including Skip / New question.
- [ ] Confirm Pronunciation is shown as Not assessed unless a validated pronunciation-assessment provider supplied a real assessment.

## 4. Speech and audio lifecycle
- [ ] Grant microphone permission, record, stop, and verify the microphone is released.
- [ ] Record and stop two separate answers in succession; confirm the second transcript contains only the second answer and no text from the first recording.
- [ ] Deny permission and verify the app shows an actionable error without becoming stuck.
- [ ] Test a long recording, an empty recording, rapid Stop taps, app backgrounding, screen lock, incoming call, and app resume.
- [ ] While an IELTS answer is recording, switch to another app; confirm TTS stops, the microphone is released, completed answers remain saved, and the interrupted answer is clearly marked for re-recording.
- [ ] While Shadowing is recording, background the app; confirm recording stops and the UI returns to a non-recording state when reopened.
- [ ] Test on a device with an on-device speech service available and another configuration without one. Airplane-mode recognition must not be assumed unless verified on that device.
- [ ] Confirm the UI explains that Android system speech recognition may use a network service when offline processing is only preferred.
- [ ] In IELTS History, delete one record and confirm its saved telemetry is cleared when it was the latest evaluation; then Delete all history and confirm the last evaluation plus local session logs are removed.
- [ ] In Diagnostics, clear the saved Shadowing attempt and confirm raw recognizer text, alternatives and word timings disappear from both the view and persistent storage.

## 5. Shadowing and visual regression
- [ ] Test normal Play, Slow Play, Record, Stop & Score, retry, and weak-word practice; verify visible loading/pressed states and no double actions.
- [ ] Confirm Stop immediately ends both normal and slow model playback; pressing Play afterwards starts the sentence from the beginning.
- [ ] Confirm Slow Play requests a separately generated slow version of the selected sentence and does not prefetch other sentences.
- [ ] Confirm TTS prefetch starts only after the first normal-play/record action, initially queues up to two upcoming sentences, and queues the next batch only after two distinct sentences have been successfully practised and scored.
- [ ] Change language or sentence set while prefetch is queued; verify stale queued batches are discarded and do not generate audio for the previous set.
- [ ] Check that failed prefetch does not lock playback to offline TTS; pressing Play on that sentence should attempt online TTS again before falling back.
- [ ] In Settings → Shadowing performance, disable prefetch; verify normal Play/Record makes no background TTS requests. Re-enable it and confirm the two-at-a-time schedule resumes.
- [ ] Monitor provider usage/quota and memory on a long session; confirm prefetched audio is RAM-only and remains within the bounded cache.
- [ ] In Settings, preview multiple voices and confirm previews play correctly without creating persistent audio-cache entries.
- [ ] Confirm Tier 2/3 feedback is labelled as word-match/timing guidance, not phoneme-level pronunciation assessment.
- [ ] Check light, dark and system themes on a narrow phone and a larger phone.
- [ ] Check keyboard-open layout, landscape, large system font, reduced motion, safe areas, and bottom navigation.

- [ ] After upgrading from a build with legacy PASS records, confirm each primary provider requires a fresh test; verify a saved PASS becomes stale after changing provider, base URL, model/voice, or API key.
- [ ] Run the same Gemini TTS connection test twice with a valid key; each test must make a live request. Revoke the key or simulate HTTP 401 on the second test and confirm it fails instead of reusing cached audio.
- [ ] Start prefetch for a sentence, then immediately play that same sentence; confirm the provider receives exactly one synthesis request.
- [ ] Start a long user-initiated TTS request and trigger a different prefetch batch; confirm the prefetch worker does not start another provider request until playback synthesis has finished.
- [ ] With the voice slot unverified, offline, or in cooldown, trigger Shadowing prefetch and confirm zero provider requests are sent.
- [ ] Make the first prefetch in a batch fail with HTTP 429/5xx; confirm the remaining sentences in that batch are not requested.
- [ ] Simulate HTTP 400/401/403/404 for API 1 and confirm it is marked Needs re-test and skipped while a healthy API 2 can still be used. Confirm the status survives force-close/relaunch.
- [ ] Simulate HTTP 429 with Retry-After; confirm that account is skipped until the cooldown expires, without blocking a healthy alternate account.
- [ ] Background and resume Shadowing after prefetch completes; confirm still-valid prefetched audio is reused rather than generated again. Change language/sentence set and confirm old entries are discarded.
- [ ] Change the TTS provider, model/voice, or API key in Settings; confirm previously prefetched audio and queued work are invalidated before the next playback.
- [ ] On a slow connection, confirm interactive Gemini TTS times out sooner than the explicit connection test. Confirm an unsupported Gemini language/model failure is not repeated for every sentence during the same app session.
- [ ] Play long Hard sentences while prefetch is enabled; confirm ordinary playback cache activity does not evict the reserved prefetched-audio budget.

## 6. Android minimum-version and update compatibility
- [ ] On Android 6.0 (API 23), install the next API-23+ APK and verify the app launches, saves settings, records audio, checks for updates and installs a later signed update.
- [ ] On Android 5.1 (API 22), test the already-published 1.0.14 updater separately: it may still offer a future API-23+ APK because its old updater cannot be retrofitted, but Android's installer must reject that APK. Do not describe the old updater as blocking the offer.
- [ ] Before publishing any API-23+ release, state prominently in the GitHub Release notes and download instructions that Android 6.0+ is required; do not publish a new APK as a routine update without this warning.

## 7. Android Back navigation and bottom navigation
- [ ] From Diagnostics, press Back; confirm the Settings root is restored at the top. Press Back again; confirm “Press back again to exit.” appears. Press Back once more within two seconds; confirm the app exits.
- [ ] Repeat the root-to-exit sequence from the IELTS root and Shadowing root independently.
- [ ] In IELTS, open History and a result; verify Back follows result → history → IELTS test menu, one page per press.
- [ ] Confirm Back never switches from one bottom-navigation tab to another, regardless of the tab-switching sequence.
- [ ] During an IELTS recording or other active test step, press Back; confirm the Quit test confirmation appears and the session is not cancelled until Quit test is confirmed.
- [ ] On the Quit test confirmation, press Back; confirm only the dialog closes and the test continues.
- [ ] Open a dropdown or model picker; press Back and confirm it closes before any page navigation.
- [ ] Confirm expanded Settings and IELTS-result accordions remain open/closed as page content and are not treated as navigation layers.
- [ ] Repeat with Android gesture navigation and three-button navigation, in light and dark themes.
