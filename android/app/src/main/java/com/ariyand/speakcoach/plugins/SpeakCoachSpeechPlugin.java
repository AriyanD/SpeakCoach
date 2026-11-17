package com.ariyand.speakcoach.plugins;

import android.Manifest;
import android.content.Intent;
import android.content.Context;
import android.media.AudioManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(
        name = "SpeakCoachSpeech",
        permissions = {
                @Permission(
                        alias = "microphone",
                        strings = { Manifest.permission.RECORD_AUDIO }
                )
        }
)
public class SpeakCoachSpeechPlugin extends Plugin {
    private static final int SAMPLE_RATE = 16000;
    private volatile boolean isRecording = false;
    private AudioRecord audioRecord;
    private Thread recordingThread;
    private ByteArrayOutputStream pcmBuffer;
    private long startTimeMs = 0L;
    private volatile String recorderError = "";
    private AudioManager audioManager;
    private AudioManager.OnAudioFocusChangeListener audioFocusChangeListener;
    private boolean hasAudioFocus = false;

    private SpeechRecognizer speechRecognizer;
    private CountDownLatch recognitionDoneLatch;
    private volatile String recognizedTranscript = "";
    private final StringBuilder recognizedFinalSegments = new StringBuilder();
    private volatile float recognizedConfidence = -1.0f;
    private final List<String> recognizedAlternatives = new ArrayList<>();
    private final List<Float> recognizedAltConfidences = new ArrayList<>();
    private volatile String recognizerError = "";
    private volatile boolean activeUseOfflineRecognizer = false;
    // These counters are used on the main thread by SpeechRecognizer callbacks.
    private int noSpeechRestartAttempts = 0;
    private int busyRestartAttempts = 0;
    private boolean recognizerRestartScheduled = false;

    @PluginMethod
    public void checkMicPermission(PluginCall call) {
        PermissionState state = getPermissionState("microphone");
        String status = state == PermissionState.GRANTED
                ? "granted"
                : state == PermissionState.DENIED ? "denied" : "prompt";
        JSObject ret = new JSObject();
        ret.put("status", status);
        call.resolve(ret);
    }

    @PluginMethod
    public void ensureMicPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
        } else {
            requestPermissionForAlias("microphone", call, "micPermsCallback");
        }
    }

    @PermissionCallback
    private void micPermsCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("microphone") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void startRecording(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "startAfterPermCallback");
            return;
        }
        beginCapture(call);
    }

    @PermissionCallback
    private void startAfterPermCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            beginCapture(call);
        } else {
            call.reject("Microphone permission denied by user");
        }
    }

    private void beginCapture(PluginCall call) {
        if (isRecording) {
            call.resolve(new JSObject().put("started", true));
            return;
        }
        final String locale = call.getString("locale", "en-US");
        final boolean useOfflineRecognizer = call.getBoolean("useOfflineRecognizer", true);
        final boolean preferOfflineOnly = call.getBoolean("preferOffline", false);

        recognizedTranscript = "";
        synchronized (recognizedFinalSegments) {
            // Each recording is a separate answer; never leak the previous transcript into a new attempt.
            recognizedFinalSegments.setLength(0);
        }
        recognizedConfidence = -1.0f;
        recognizerError = "";
        recorderError = "";
        noSpeechRestartAttempts = 0;
        busyRestartAttempts = 0;
        recognizerRestartScheduled = false;
        synchronized (recognizedAlternatives) {
            recognizedAlternatives.clear();
            recognizedAltConfidences.clear();
        }
        startTimeMs = System.currentTimeMillis();
        isRecording = true;
        activeUseOfflineRecognizer = useOfflineRecognizer;

        if (useOfflineRecognizer) {
            // Mode (b): Android system SpeechRecognizer path — the app does not retain/upload raw PCM here.
            // Android may still use network services unless an on-device recognizer is explicitly available.
            pcmBuffer = null;
            recognitionDoneLatch = new CountDownLatch(1);
            startNativeSpeechRecognizer(locale, preferOfflineOnly, call);
        } else {
            // Mode (a): Online STT AudioRecord ONLY — capture continuous 16 kHz mono PCM WAV
            pcmBuffer = new ByteArrayOutputStream();
            recognitionDoneLatch = null;
            startRawPcmRecorder(call);
        }
    }

    private void startRawPcmRecorder(PluginCall call) {
        try {
            int minBuf = AudioRecord.getMinBufferSize(
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
            );
            if (minBuf <= 0) {
                throw new IllegalStateException("AudioRecord does not support 16 kHz mono PCM on this device (buffer size " + minBuf + ").");
            }
            final int bufferSize = Math.max(minBuf * 2, 4096);
            audioRecord = new AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSize
            );
            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                audioRecord.release();
                audioRecord = null;
                throw new IllegalStateException("Android could not initialize the microphone recorder.");
            }

            requestCaptureAudioFocus();
            audioRecord.startRecording();
            if (audioRecord.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                throw new IllegalStateException("Android did not enter the recording state.");
            }

            final AudioRecord recorder = audioRecord;
            final ByteArrayOutputStream captureBuffer = pcmBuffer;
            recordingThread = new Thread(() -> {
                byte[] readBuf = new byte[2048];
                while (isRecording && recorder != null && captureBuffer != null) {
                    int read = recorder.read(readBuf, 0, readBuf.length);
                    if (read > 0) {
                        synchronized (captureBuffer) {
                            captureBuffer.write(readBuf, 0, read);
                        }
                    } else if (read < 0) {
                        recorderError = mapAudioRecordReadError(read);
                        isRecording = false;
                        break;
                    }
                }
            }, "SpeakCoachPCMThread");
            recordingThread.start();
            call.resolve(new JSObject().put("started", true));
        } catch (Exception e) {
            recorderError = "Failed to start PCM recorder: " + e.getMessage();
            isRecording = false;
            releaseAudioRecord();
            abandonCaptureAudioFocus();
            call.reject(recorderError, e);
        }
    }

    private void requestCaptureAudioFocus() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null) return;

        audioFocusChangeListener = focusChange -> {
            if ((focusChange == AudioManager.AUDIOFOCUS_LOSS ||
                    focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) && isRecording) {
                recorderError = "Audio focus was interrupted while recording. Please try again.";
                isRecording = false;
            }
        };

        try {
            // The legacy focus API remains available on the app's minimum SDK (22).
            hasAudioFocus = audioManager.requestAudioFocus(
                    audioFocusChangeListener,
                    AudioManager.STREAM_VOICE_CALL,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
            ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } catch (Exception e) {
            // Audio focus is best-effort; a denied request must not block microphone capture.
            hasAudioFocus = false;
        }
    }

    private void abandonCaptureAudioFocus() {
        if (audioManager != null && hasAudioFocus) {
            try {
                if (audioFocusChangeListener != null) {
                    audioManager.abandonAudioFocus(audioFocusChangeListener);
                }
            } catch (Exception ignored) {
            }
        }
        hasAudioFocus = false;
        audioFocusChangeListener = null;
        audioManager = null;
    }

    private void releaseAudioRecord() {
        if (audioRecord == null) return;
        try {
            if (audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) audioRecord.stop();
        } catch (Exception ignored) {
        }
        try { audioRecord.release(); } catch (Exception ignored) {}
        audioRecord = null;
    }

    private String mapAudioRecordReadError(int code) {
        if (code == AudioRecord.ERROR_DEAD_OBJECT) return "The microphone recorder stopped unexpectedly (dead object).";
        if (code == AudioRecord.ERROR_INVALID_OPERATION) return "The microphone recorder returned an invalid operation.";
        if (code == AudioRecord.ERROR_BAD_VALUE) return "The microphone recorder rejected the audio buffer.";
        if (code == AudioRecord.ERROR) return "The microphone recorder reported an audio capture error.";
        return "The microphone recorder failed with error " + code + ".";
    }

    private void startNativeSpeechRecognizer(String locale, boolean preferOfflineOnly, PluginCall call) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                    recognizerError = "SpeechRecognizer service not available on this device";
                    isRecording = false;
                    if (recognitionDoneLatch != null) recognitionDoneLatch.countDown();
                    call.reject(recognizerError);
                    return;
                }
                if (speechRecognizer != null) {
                    speechRecognizer.destroy();
                    speechRecognizer = null;
                }
                if (preferOfflineOnly && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                        SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext())) {
                    // Prefer the explicit on-device service when Android exposes one.
                    speechRecognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
                } else {
                    // Compatibility fallback. EXTRA_PREFER_OFFLINE is a preference,
                    // not a guarantee that the installed recognition service is local or network-free.
                    speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                }
                final Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale);
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
                if (preferOfflineOnly) {
                    intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
                }

                speechRecognizer.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(Bundle params) {}
                    @Override public void onBeginningOfSpeech() {
                        busyRestartAttempts = 0;
                    }
                    @Override public void onRmsChanged(float rmsdB) {}
                    @Override public void onBufferReceived(byte[] buffer) {}
                    @Override public void onEndOfSpeech() {}

                    @Override
                    public void onError(int error) {
                        if (!isRecording) {
                            if (recognitionDoneLatch != null) recognitionDoneLatch.countDown();
                            return;
                        }
                        if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                            scheduleNoSpeechRestart(intent);
                            return;
                        }
                        if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) {
                            scheduleBusyRestart(intent);
                            return;
                        }
                        recognizerError = mapSpeechErrorCode(error);
                        isRecording = false;
                        if (recognitionDoneLatch != null) recognitionDoneLatch.countDown();
                    }

                    @Override
                    public void onResults(Bundle results) {
                        boolean segmentHasSpeech = hasSpeechResult(results);
                        extractSpeechBundle(results, true);
                        if (isRecording) {
                            if (segmentHasSpeech) {
                                noSpeechRestartAttempts = 0;
                                busyRestartAttempts = 0;
                                // A valid segment is progress: allow the next recognition window.
                                scheduleRecognizerRestart(intent, 150L, "Recognition segment ended");
                            } else {
                                scheduleNoSpeechRestart(intent);
                            }
                        } else if (recognitionDoneLatch != null) {
                            recognitionDoneLatch.countDown();
                        }
                    }

                    @Override
                    public void onPartialResults(Bundle partialResults) {
                        extractSpeechBundle(partialResults, false);
                    }

                    @Override public void onEvent(int eventType, Bundle params) {}
                });

                speechRecognizer.startListening(intent);
                call.resolve(new JSObject().put("started", true));
            } catch (Exception e) {
                recognizerError = "Failed to start SpeechRecognizer: " + e.getMessage();
                isRecording = false;
                if (recognitionDoneLatch != null) recognitionDoneLatch.countDown();
                try {
                    if (speechRecognizer != null) {
                        speechRecognizer.destroy();
                        speechRecognizer = null;
                    }
                } catch (Exception ignored) {
                }
                call.reject(recognizerError, e);
            }
        });
    }

    private boolean hasSpeechResult(Bundle bundle) {
        if (bundle == null) return false;
        ArrayList<String> matches = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches == null) return false;
        for (String match : matches) {
            if (match != null && !match.trim().isEmpty()) return true;
        }
        return false;
    }

    private void extractSpeechBundle(Bundle bundle, boolean isFinal) {
        if (bundle == null) return;
        ArrayList<String> matches = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        float[] scores = bundle.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);

        if (matches != null && !matches.isEmpty()) {
            String best = matches.get(0) != null ? matches.get(0).trim() : "";
            if (!best.isEmpty()) {
                synchronized (recognizedFinalSegments) {
                    if (isFinal) {
                        if (recognizedFinalSegments.length() > 0) recognizedFinalSegments.append(' ');
                        recognizedFinalSegments.append(best);
                        recognizedTranscript = recognizedFinalSegments.toString();
                    } else {
                        recognizedTranscript = recognizedFinalSegments.length() > 0
                                ? recognizedFinalSegments.toString() + " " + best
                                : best;
                    }
                }
            }
            if (isFinal) {
                synchronized (recognizedAlternatives) {
                    recognizedAlternatives.clear();
                    recognizedAltConfidences.clear();
                    for (int i = 0; i < matches.size(); i++) {
                        String alt = matches.get(i);
                        if (alt != null && !alt.trim().isEmpty()) {
                            recognizedAlternatives.add(alt.trim());
                            float conf = (scores != null && i < scores.length && scores[i] > 0f) ? scores[i] : -1.0f;
                            recognizedAltConfidences.add(conf);
                        }
                    }
                }
            }
        }
        if (scores != null && scores.length > 0 && scores[0] > 0f) {
            recognizedConfidence = scores[0];
        }
    }

    @PluginMethod
    public void stopRecording(PluginCall call) {
        isRecording = false;
        final long durationMs = Math.max(100L, System.currentTimeMillis() - startTimeMs);

        new Thread(() -> {
            try {
                if (recordingThread != null) {
                    recordingThread.join(500);
                    recordingThread = null;
                }
            } catch (InterruptedException ignored) {
            }

            releaseAudioRecord();
            abandonCaptureAudioFocus();

            if (speechRecognizer != null) {
                new Handler(Looper.getMainLooper()).post(() -> {
                    try {
                        if (speechRecognizer != null) {
                            speechRecognizer.stopListening();
                        }
                    } catch (Exception ignored) {
                    }
                });

                if (recognitionDoneLatch != null) {
                    try {
                        recognitionDoneLatch.await(1500, TimeUnit.MILLISECONDS);
                    } catch (InterruptedException ignored) {
                    }
                }

                new Handler(Looper.getMainLooper()).post(() -> {
                    try {
                        if (speechRecognizer != null) {
                            speechRecognizer.destroy();
                            speechRecognizer = null;
                        }
                    } catch (Exception ignored) {
                    }
                });
            }

            String wavBase64 = "";
            if (!activeUseOfflineRecognizer && pcmBuffer != null) {
                byte[] rawPcm = pcmBuffer.toByteArray();
                if (rawPcm.length > 0) {
                    byte[] wavBytes = wrapPcm16MonoWav(rawPcm, SAMPLE_RATE);
                    wavBase64 = Base64.encodeToString(wavBytes, Base64.NO_WRAP);
                }
            }

            JSArray altArray = new JSArray();
            synchronized (recognizedAlternatives) {
                for (int i = 0; i < recognizedAlternatives.size(); i++) {
                    JSObject item = new JSObject();
                    item.put("transcript", recognizedAlternatives.get(i));
                    item.put("confidence", recognizedAltConfidences.get(i));
                    altArray.put(item);
                }
                if (recognizedAlternatives.isEmpty() && !recognizedTranscript.isEmpty()) {
                    JSObject item = new JSObject();
                    item.put("transcript", recognizedTranscript);
                    item.put("confidence", recognizedConfidence > 0f ? recognizedConfidence : -1.0f);
                    altArray.put(item);
                }
            }

            JSObject ret = new JSObject();
            ret.put("wavBase64", wavBase64);
            ret.put("durationMs", durationMs);
            ret.put("sampleRate", SAMPLE_RATE);
            ret.put("offlineTranscript", recognizedTranscript);
            ret.put("offlineConfidence", recognizedConfidence);
            ret.put("offlineAlternatives", altArray);
            ret.put("recognizerError", recorderError.isEmpty() ? recognizerError : recorderError);
            call.resolve(ret);
        }, "SpeakCoachStopThread").start();
    }

    private void scheduleNoSpeechRestart(Intent intent) {
        noSpeechRestartAttempts++;
        if (!SpeechRecognizerRetryPolicy.canRetryNoSpeech(noSpeechRestartAttempts)) {
            failRecognizerRestart("Speech recognition stopped after repeated silence or unrecognized speech. Please try recording again.");
            return;
        }
        long delayMs = SpeechRecognizerRetryPolicy.noSpeechDelayMs(noSpeechRestartAttempts);
        scheduleRecognizerRestart(intent, delayMs, "No speech recognized; retrying");
    }

    private void scheduleBusyRestart(Intent intent) {
        busyRestartAttempts++;
        if (!SpeechRecognizerRetryPolicy.canRetryBusy(busyRestartAttempts)) {
            failRecognizerRestart("The Android speech recognizer remained busy. Please try recording again.");
            return;
        }
        long delayMs = SpeechRecognizerRetryPolicy.busyDelayMs(busyRestartAttempts);
        scheduleRecognizerRestart(intent, delayMs, "Speech recognizer busy; retrying");
    }

    private void scheduleRecognizerRestart(Intent intent, long delayMs, String diagnostic) {
        if (recognizerRestartScheduled || !isRecording || speechRecognizer == null) return;
        recognizerRestartScheduled = true;
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            recognizerRestartScheduled = false;
            if (!isRecording || speechRecognizer == null) return;
            try {
                recognizerError = "";
                speechRecognizer.startListening(intent);
            } catch (IllegalStateException e) {
                // Some recognition services report BUSY synchronously instead of via onError.
                scheduleBusyRestart(intent);
            } catch (Exception e) {
                failRecognizerRestart("Failed to continue SpeechRecognizer: " + e.getMessage());
            }
        }, delayMs);
    }

    private void failRecognizerRestart(String message) {
        recognizerError = message;
        isRecording = false;
        recognizerRestartScheduled = false;
        if (recognitionDoneLatch != null) recognitionDoneLatch.countDown();
    }

    private String mapSpeechErrorCode(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_AUDIO: return "ERROR_AUDIO (Audio recording error)";
            case SpeechRecognizer.ERROR_CLIENT: return "ERROR_CLIENT (Client side error)";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "ERROR_INSUFFICIENT_PERMISSIONS (Mic permission missing)";
            case SpeechRecognizer.ERROR_NETWORK: return "ERROR_NETWORK (Network error)";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "ERROR_NETWORK_TIMEOUT (Network timeout)";
            case SpeechRecognizer.ERROR_NO_MATCH: return "ERROR_NO_MATCH (No speech recognized)";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "ERROR_RECOGNIZER_BUSY (Recognizer busy)";
            case SpeechRecognizer.ERROR_SERVER: return "ERROR_SERVER (Server error)";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "ERROR_SPEECH_TIMEOUT (No speech input detected)";
            default: return "ERROR_CODE_" + code;
        }
    }

    private byte[] wrapPcm16MonoWav(byte[] pcmData, int sampleRate) {
        int totalDataLen = pcmData.length + 36;
        int byteRate = sampleRate * 2;
        ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.put(new byte[]{'R', 'I', 'F', 'F'});
        header.putInt(totalDataLen);
        header.put(new byte[]{'W', 'A', 'V', 'E'});
        header.put(new byte[]{'f', 'm', 't', ' '});
        header.putInt(16);
        header.putShort((short) 1);
        header.putShort((short) 1);
        header.putInt(sampleRate);
        header.putInt(byteRate);
        header.putShort((short) 2);
        header.putShort((short) 16);
        header.put(new byte[]{'d', 'a', 't', 'a'});
        header.putInt(pcmData.length);

        byte[] out = new byte[44 + pcmData.length];
        System.arraycopy(header.array(), 0, out, 0, 44);
        System.arraycopy(pcmData, 0, out, 44, pcmData.length);
        return out;
    }
}
