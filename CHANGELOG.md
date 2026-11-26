# Changelog

Notable user-facing changes are recorded here. A version tag triggers creation of a draft release; it stays unpublished until intentionally published.

## 1.2.0 — 2026-11-27

### Added
- Shadowing can automatically play the next sentence and translate newly generated AI sentence sets into a selected language.
- Grammar explanations can be read in either the practice language or the selected translation language, with a compact scrollable explanation and follow-up tutor chat.
- English-only IELTS answer-sentence practice generates its own 20-sentence sets without using offline starter sentences.
- The Translation slot can generate a validated one-request translation batch for a saved Shadowing set.

### Improved
- Shadowing history navigation stays usable at the newest set, announces set changes, and highlights the current set.
- Word replay now shows which word is loading and playing.
- Shadowing translation preferences and IELTS difficulty survive backup/restore; existing saved histories are upgraded without discarding earlier sets.
- Shadowing remembers the selected difficulty and translation target language across app restarts.
- Shadowing end-of-set notices use an informational style, and empty-attempt messages no longer imply that a score of zero was calculated.

### Fixed
- Runtime speech and AI requests now follow the saved API 1 → API 2 order; provider family no longer silently changes the user's priority.
- Speech transcription avoids spending API quota on recordings that contain only near-digital silence.
- IELTS cancellation during preparation now correctly explains that no answers have been recorded yet.
- Fixed Translation & Grammar card styles being scoped to the wrong parent, replaced duplicate grammar/chat rules with a single card-scoped theme-aware block, and added independently managed scroll rails to both explanation and follow-up messages.
- Aligned the Translate and Explain Grammar actions with the sentence field and unified their accent colour while preserving the language toggle.

## 1.1.4 — 2026-11-24

### Fixed
- Fixed Groq OpenAI-compatible TTS connection tests to use the WAV response format required by Orpheus, matching playback behavior.

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
- IELTS re-evaluation failures are shown next to the button with a specific reason and no longer replace a previously valid score.
- Connection tests are bound to the provider, endpoint, model/voice and key and expire after 30 days; speech-to-text uses the same verification and cooldown rules as voice.
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

### Documentation
- README and technical notes describe multilingual Shadowing and the bilingual English/Persian interface accurately.
- Release/version history wording distinguishes the initial 1.0.0 release from later 1.0.x releases.
