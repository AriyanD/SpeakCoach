package com.ariyand.speakcoach.plugins;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SpeechRecognizerRetryPolicyTest {
    @Test
    public void noSpeechRetriesAreBoundedAndUseExponentialBackoff() {
        assertTrue(SpeechRecognizerRetryPolicy.canRetryNoSpeech(1));
        assertTrue(SpeechRecognizerRetryPolicy.canRetryNoSpeech(5));
        assertFalse(SpeechRecognizerRetryPolicy.canRetryNoSpeech(6));
        assertEquals(250L, SpeechRecognizerRetryPolicy.noSpeechDelayMs(1));
        assertEquals(500L, SpeechRecognizerRetryPolicy.noSpeechDelayMs(2));
        assertEquals(1000L, SpeechRecognizerRetryPolicy.noSpeechDelayMs(3));
        assertEquals(2000L, SpeechRecognizerRetryPolicy.noSpeechDelayMs(4));
        assertEquals(2000L, SpeechRecognizerRetryPolicy.noSpeechDelayMs(5));
    }

    @Test
    public void busyRetriesAreMoreConservativeAndBounded() {
        assertTrue(SpeechRecognizerRetryPolicy.canRetryBusy(1));
        assertTrue(SpeechRecognizerRetryPolicy.canRetryBusy(3));
        assertFalse(SpeechRecognizerRetryPolicy.canRetryBusy(4));
        assertEquals(500L, SpeechRecognizerRetryPolicy.busyDelayMs(1));
        assertEquals(1000L, SpeechRecognizerRetryPolicy.busyDelayMs(2));
        assertEquals(2000L, SpeechRecognizerRetryPolicy.busyDelayMs(3));
    }

    @Test(expected = IllegalArgumentException.class)
    public void invalidRetryAttemptCannotProduceDelay() {
        SpeechRecognizerRetryPolicy.noSpeechDelayMs(0);
    }
}
