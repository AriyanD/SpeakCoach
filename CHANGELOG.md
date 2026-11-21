# Changelog

Notable user-facing changes are recorded here. Release tags and version numbers are created only when a release is intentionally published.

## Unreleased

### Breaking change for the next Android APK
- The next APK built from the current source requires Android 6.0 (API 23) or newer. Android 5.1 (API 22) and older are unsupported. This must be stated prominently in the GitHub Release notes and installation instructions before publication.
- The already-published 1.0.14 APK predates the source-side API 23 change. Its updater cannot be retroactively updated to block an incompatible APK offer; Android 5.1 may still see a future release, but the package installer will reject an APK requiring API 23.

### Added
- A Settings option to disable background Shadowing TTS prefetch and avoid spending provider quota on sentences the learner may not reach.
- A Diagnostics action to clear the latest saved Shadowing recognizer transcript, alternatives, timing and score details.
- IELTS history deletion now clears the corresponding saved evaluation telemetry; deleting all history also clears local IELTS session logs.

### Improved
- Shadowing prefetch discards queued work when the active language or sentence set changes.
- TTS cache account separation uses a truncated SHA-256 fingerprint; if Web Crypto is unavailable, synthesis continues without caching.
- TTS audio storage now uses one shared cache-writing helper.
- Custom provider API-key input is cleared after all compatible tested slots have been applied successfully.
- The in-app updater checks the native Android SDK level before checking or installing an update.
- Voice previews remain memory-only and do not create persistent cache entries.
- The device checklist covers the updated Shadowing flow, telemetry clearing, prefetch preference and Android compatibility.

### Documentation
- README and technical notes describe multilingual Shadowing and the bilingual English/Persian interface accurately.
- Release/version history wording distinguishes the initial 1.0.0 release from the currently published 1.0.14 release.
