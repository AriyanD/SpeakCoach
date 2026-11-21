# Changelog

Notable user-facing changes are recorded here. Release tags and version numbers are created only when a release is intentionally published.

## 1.1.0 — 2026-11-21

### Added
- API 2 is now an explicit opt-in backup account with matching provider, endpoint, model, key, and test controls.
- API 2 configuration stays hidden until enabled; enabling an empty slot chooses a suitable online provider when available.
- A Settings option to disable background Shadowing TTS prefetch and avoid spending provider quota on sentences the learner may not reach.
- A Diagnostics action to clear the latest saved Shadowing recognizer transcript, alternatives, timing and score details.
- IELTS history deletion now clears the corresponding saved evaluation telemetry; deleting all history also clears local IELTS session logs.

### Improved
- Shadowing Trainer keeps Sentence set, practice, recording results, and score details together in a clearer layout.
- Recorded result words can be replayed directly.
- The bulk API test action and key-copy controls have clearer, more consistent layouts.
- Settings → Backup & Restore now has **Test all APIs**: it tests every configured account sequentially (cancellable) and saves a slot's verification only when all its configured online accounts pass.
- AI voice audio for the active Shadowing sentence set is saved on the device (excluded from backups) so replays are instant, even after restarting the app; it is replaced when you switch sets.
- Shadowing prefetch now follows your position in the set (groups of four at sentences #2, #6, #10, …) and no longer skips sentences when the first Play happens at the same time.
- IELTS re-evaluation failures are shown next to the button with a specific reason (API 1/API 2 not verified, test expired, cooling down, missing key, offline provider) and no longer replace a previously valid score.
- Connection tests are bound to the provider, endpoint, model/voice and key and expire after 30 days; the speech-to-text path now uses the same verification and cooldown rules as voice.
- The Record button uses its own recording colour; Shadowing shows the score strip directly under it.
- Settings layouts are more robust on narrow screens and in right-to-left layouts.
- Shadowing prefetch discards queued work when the active language or sentence set changes.
- TTS cache account separation uses a truncated SHA-256 fingerprint; if Web Crypto is unavailable, synthesis continues without caching.
- TTS audio storage now uses one shared cache-writing helper.
- Custom provider API-key input is cleared after all compatible tested slots have been applied successfully.
- The in-app updater checks the native Android SDK level before checking or installing an update.
- Voice previews remain memory-only and do not create persistent cache entries.
- The device checklist covers the updated Shadowing flow, telemetry clearing, prefetch preference and Android compatibility.

### Compatibility
- Android 6.0 (API 23) or newer is required. Android 5.1 (API 22) and older are unsupported.
- The already-published 1.0.14 APK predates this change, so its updater cannot retroactively block an incompatible APK offer; Android 5.1 may still see this release, but the package installer will reject an APK requiring API 23.

### Documentation
- README and technical notes describe multilingual Shadowing and the bilingual English/Persian interface accurately.
- Release/version history wording distinguishes the initial 1.0.0 release from the later 1.0.x releases.

## Unreleased

_Nothing yet._
