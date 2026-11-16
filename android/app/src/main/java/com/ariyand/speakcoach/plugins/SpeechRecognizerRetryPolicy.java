package com.ariyand.speakcoach.plugins;

/** Small deterministic retry policy for Android SpeechRecognizer restart handling. */
final class SpeechRecognizerRetryPolicy {
    static final int MAX_NO_SPEECH_RESTARTS = 5;
    static final int MAX_BUSY_RESTARTS = 3;
    static final long MAX_RESTART_DELAY_MS = 2000L;

    private SpeechRecognizerRetryPolicy() {}

    static boolean canRetryNoSpeech(int attempt) {
        return attempt >= 1 && attempt <= MAX_NO_SPEECH_RESTARTS;
    }

    static boolean canRetryBusy(int attempt) {
        return attempt >= 1 && attempt <= MAX_BUSY_RESTARTS;
    }

    static long noSpeechDelayMs(int attempt) {
        return backoffDelayMs(attempt, 250L, MAX_NO_SPEECH_RESTARTS);
    }

    static long busyDelayMs(int attempt) {
        return backoffDelayMs(attempt, 500L, MAX_BUSY_RESTARTS);
    }

    private static long backoffDelayMs(int attempt, long baseDelayMs, int maxAttempts) {
        if (attempt < 1 || attempt > maxAttempts) {
            throw new IllegalArgumentException("Retry attempt is outside the allowed range");
        }
        return Math.min(baseDelayMs * (1L << (attempt - 1)), MAX_RESTART_DELAY_MS);
    }
}
