package com.ariyand.speakcoach.plugins;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureKey")
public class SecureKeyPlugin extends Plugin {
    private static final String PREFS_NAME = "speakcoach_secure_keys";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "SpeakCoachMasterKeyV1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_LENGTH = 128;

    private SecretKey getOrCreateSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null);
            return entry.getSecretKey();
        }
        KeyGenerator keyGenerator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                ANDROID_KEYSTORE
        );
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build();
        keyGenerator.init(spec);
        return keyGenerator.generateKey();
    }

    private SecretKey getExistingSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            throw new IllegalStateException("The Android Keystore key is missing or was invalidated. Restore API keys from a SpeakCoach AI Settings backup.");
        }
        KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null);
        if (entry == null || entry.getSecretKey() == null) {
            throw new IllegalStateException("The Android Keystore key is unavailable. Restore API keys from a SpeakCoach AI Settings backup.");
        }
        return entry.getSecretKey();
    }

    private SharedPreferences getPrefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void setKey(PluginCall call) {
        String keyId = call.getString("keyId");
        String value = call.getString("value", "");
        if (keyId == null || keyId.trim().isEmpty()) {
            call.reject("Missing keyId");
            return;
        }
        try {
            SharedPreferences prefs = getPrefs();
            if (value == null || value.isEmpty()) {
                boolean saved = prefs.edit().remove(keyId).commit();
                JSObject ret = new JSObject();
                ret.put("saved", saved);
                call.resolve(ret);
                return;
            }
            SecretKey secretKey = getOrCreateSecretKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            byte[] iv = cipher.getIV();
            byte[] cipherBytes = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            String payload = Base64.encodeToString(iv, Base64.NO_WRAP)
                    + ":"
                    + Base64.encodeToString(cipherBytes, Base64.NO_WRAP);
            boolean saved = prefs.edit().putString(keyId, payload).commit();

            // A successful SharedPreferences commit only confirms that the
            // ciphertext was written. Verify that the just-written value can
            // actually be read and decrypted before reporting success.
            if (saved) {
                String persistedPayload = prefs.getString(keyId, null);
                if (persistedPayload == null || !persistedPayload.contains(":")) {
                    saved = false;
                } else {
                    String[] persistedParts = persistedPayload.split(":", 2);
                    byte[] persistedIv = Base64.decode(persistedParts[0], Base64.NO_WRAP);
                    byte[] persistedCipherBytes = Base64.decode(persistedParts[1], Base64.NO_WRAP);
                    Cipher verifyCipher = Cipher.getInstance(TRANSFORMATION);
                    verifyCipher.init(Cipher.DECRYPT_MODE, secretKey,
                            new GCMParameterSpec(GCM_TAG_LENGTH, persistedIv));
                    byte[] verifiedBytes = verifyCipher.doFinal(persistedCipherBytes);
                    String verifiedValue = new String(verifiedBytes, StandardCharsets.UTF_8);
                    saved = value.equals(verifiedValue);
                }
            }

            JSObject ret = new JSObject();
            ret.put("saved", saved);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to encrypt key: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void getKey(PluginCall call) {
        String keyId = call.getString("keyId");
        if (keyId == null || keyId.trim().isEmpty()) {
            call.reject("Missing keyId");
            return;
        }
        try {
            String payload = getPrefs().getString(keyId, null);
            JSObject ret = new JSObject();
            if (payload == null) {
                ret.put("value", "");
                call.resolve(ret);
                return;
            }
            if (!payload.contains(":")) {
                throw new IllegalStateException("The saved encrypted API key is malformed. Restore the key from a SpeakCoach AI Settings backup.");
            }
            String[] parts = payload.split(":", 2);
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] cipherBytes = Base64.decode(parts[1], Base64.NO_WRAP);
            SecretKey secretKey = getExistingSecretKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH, iv));
            byte[] plainBytes = cipher.doFinal(cipherBytes);
            ret.put("value", new String(plainBytes, StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (Exception e) {
            // Do not disguise a decryption/Keystore failure as an empty key.
            // The TypeScript storage layer can then try its fallback store.
            call.reject("Failed to decrypt saved API key: " + e.getMessage(), e);
        }
    }
}
