package com.ariyand.speakcoach.plugins;

import android.annotation.TargetApi;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.KeyPairGeneratorSpec;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Calendar;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import javax.security.auth.x500.X500Principal;

@CapacitorPlugin(name = "SecureKey")
public class SecureKeyPlugin extends Plugin {
    private static final String PREFS_NAME = "speakcoach_secure_keys";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String AES_KEY_ALIAS = "SpeakCoachMasterKeyV1";
    private static final String API22_RSA_KEY_ALIAS = "SpeakCoachMasterRsaKeyV1";
    private static final String AES_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String RSA_TRANSFORMATION = "RSA/ECB/PKCS1Padding";
    private static final String API22_PAYLOAD_PREFIX = "rsa1:";
    private static final int GCM_TAG_LENGTH = 128;
    private static final int API22_AES_KEY_BYTES = 32;

    private SharedPreferences getPrefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    /**
     * API 22 does not provide KeyGenParameterSpec or AES key generation in
     * Android Keystore. It uses a Keystore-backed RSA private key to wrap a
     * randomly generated AES-256 key. Only the wrapped AES key is persisted;
     * the API-key ciphertext is authenticated with AES-GCM.
     */
    private String encryptApi22(String value) throws Exception {
        byte[] rawAesKey = new byte[API22_AES_KEY_BYTES];
        new SecureRandom().nextBytes(rawAesKey);
        SecretKey aesKey = new SecretKeySpec(rawAesKey, "AES");

        Cipher aesCipher = Cipher.getInstance(AES_TRANSFORMATION);
        aesCipher.init(Cipher.ENCRYPT_MODE, aesKey);
        byte[] iv = aesCipher.getIV();
        byte[] encryptedValue = aesCipher.doFinal(value.getBytes(StandardCharsets.UTF_8));

        byte[] wrappedAesKey = wrapApi22AesKey(rawAesKey);
        return API22_PAYLOAD_PREFIX
                + Base64.encodeToString(wrappedAesKey, Base64.NO_WRAP)
                + ":"
                + Base64.encodeToString(iv, Base64.NO_WRAP)
                + ":"
                + Base64.encodeToString(encryptedValue, Base64.NO_WRAP);
    }

    private String decryptApi22(String payload) throws Exception {
        String[] parts = payload.split(":", 4);
        if (parts.length != 4 || !API22_PAYLOAD_PREFIX.substring(0, API22_PAYLOAD_PREFIX.length() - 1).equals(parts[0])) {
            throw new IllegalStateException("The saved API 22 encrypted key is malformed. Restore API keys from a SpeakCoach AI Settings backup.");
        }

        byte[] wrappedAesKey = Base64.decode(parts[1], Base64.NO_WRAP);
        byte[] iv = Base64.decode(parts[2], Base64.NO_WRAP);
        byte[] encryptedValue = Base64.decode(parts[3], Base64.NO_WRAP);
        byte[] rawAesKey = unwrapApi22AesKey(wrappedAesKey);

        SecretKey aesKey = new SecretKeySpec(rawAesKey, "AES");
        Cipher aesCipher = Cipher.getInstance(AES_TRANSFORMATION);
        aesCipher.init(Cipher.DECRYPT_MODE, aesKey, new GCMParameterSpec(GCM_TAG_LENGTH, iv));
        return new String(aesCipher.doFinal(encryptedValue), StandardCharsets.UTF_8);
    }

    private byte[] wrapApi22AesKey(byte[] rawAesKey) throws Exception {
        KeyStore keyStore = getAndroidKeyStore();
        if (!keyStore.containsAlias(API22_RSA_KEY_ALIAS)) {
            generateApi22RsaKeyPair();
            keyStore = getAndroidKeyStore();
        }
        java.security.cert.Certificate certificate = keyStore.getCertificate(API22_RSA_KEY_ALIAS);
        if (certificate == null || certificate.getPublicKey() == null) {
            throw new IllegalStateException("The Android Keystore RSA public key is unavailable.");
        }
        Cipher rsaCipher = Cipher.getInstance(RSA_TRANSFORMATION);
        rsaCipher.init(Cipher.ENCRYPT_MODE, certificate.getPublicKey());
        return rsaCipher.doFinal(rawAesKey);
    }

    private byte[] unwrapApi22AesKey(byte[] wrappedAesKey) throws Exception {
        KeyStore keyStore = getAndroidKeyStore();
        java.security.Key storedKey = keyStore.getKey(API22_RSA_KEY_ALIAS, null);
        if (!(storedKey instanceof java.security.PrivateKey)) {
            throw new IllegalStateException("The Android Keystore RSA private key is missing or unavailable. Restore API keys from a SpeakCoach AI Settings backup.");
        }
        Cipher rsaCipher = Cipher.getInstance(RSA_TRANSFORMATION);
        rsaCipher.init(Cipher.DECRYPT_MODE, (java.security.PrivateKey) storedKey);
        byte[] rawAesKey = rsaCipher.doFinal(wrappedAesKey);
        if (rawAesKey.length != API22_AES_KEY_BYTES) {
            throw new IllegalStateException("The wrapped API 22 encryption key has an invalid length.");
        }
        return rawAesKey;
    }

    private KeyStore getAndroidKeyStore() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        return keyStore;
    }

    @SuppressWarnings("deprecation")
    private void generateApi22RsaKeyPair() throws Exception {
        Calendar start = Calendar.getInstance();
        Calendar end = Calendar.getInstance();
        end.add(Calendar.YEAR, 30);

        KeyPairGeneratorSpec spec = new KeyPairGeneratorSpec.Builder(getContext())
                .setAlias(API22_RSA_KEY_ALIAS)
                .setSubject(new X500Principal("CN=SpeakCoach API Key Encryption"))
                .setSerialNumber(BigInteger.ONE)
                .setStartDate(start.getTime())
                .setEndDate(end.getTime())
                .setKeySize(2048)
                .build();

        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA", ANDROID_KEYSTORE);
        generator.initialize(spec);
        generator.generateKeyPair();
    }

    @TargetApi(Build.VERSION_CODES.M)
    private static final class Api23Keystore {
        private static SecretKey getOrCreateSecretKey() throws Exception {
            KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
            keyStore.load(null);
            if (keyStore.containsAlias(AES_KEY_ALIAS)) {
                KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) keyStore.getEntry(AES_KEY_ALIAS, null);
                return entry.getSecretKey();
            }
            KeyGenerator keyGenerator = KeyGenerator.getInstance(
                    KeyProperties.KEY_ALGORITHM_AES,
                    ANDROID_KEYSTORE
            );
            KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                    AES_KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build();
            keyGenerator.init(spec);
            return keyGenerator.generateKey();
        }

        private static SecretKey getExistingSecretKey() throws Exception {
            KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
            keyStore.load(null);
            if (!keyStore.containsAlias(AES_KEY_ALIAS)) {
                throw new IllegalStateException("The Android Keystore key is missing or was invalidated. Restore API keys from a SpeakCoach AI Settings backup.");
            }
            KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) keyStore.getEntry(AES_KEY_ALIAS, null);
            if (entry == null || entry.getSecretKey() == null) {
                throw new IllegalStateException("The Android Keystore key is unavailable. Restore API keys from a SpeakCoach AI Settings backup.");
            }
            return entry.getSecretKey();
        }

        private static String encrypt(String value) throws Exception {
            SecretKey secretKey = getOrCreateSecretKey();
            Cipher cipher = Cipher.getInstance(AES_TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            byte[] iv = cipher.getIV();
            byte[] cipherBytes = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            return Base64.encodeToString(iv, Base64.NO_WRAP)
                    + ":"
                    + Base64.encodeToString(cipherBytes, Base64.NO_WRAP);
        }

        private static String decrypt(String payload) throws Exception {
            if (!payload.contains(":")) {
                throw new IllegalStateException("The saved encrypted API key is malformed. Restore the key from a SpeakCoach AI Settings backup.");
            }
            String[] parts = payload.split(":", 2);
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] cipherBytes = Base64.decode(parts[1], Base64.NO_WRAP);
            SecretKey secretKey = getExistingSecretKey();
            Cipher cipher = Cipher.getInstance(AES_TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH, iv));
            return new String(cipher.doFinal(cipherBytes), StandardCharsets.UTF_8);
        }
    }

    private String encryptValue(String value) throws Exception {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? Api23Keystore.encrypt(value)
                : encryptApi22(value);
    }

    private String decryptValue(String payload) throws Exception {
        if (payload.startsWith(API22_PAYLOAD_PREFIX)) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                return decryptApi22(payload);
            }
            // API 23+ can also restore/read an API 22-format payload.
            return decryptApi22(payload);
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            throw new IllegalStateException("This encrypted API key uses the Android 6+ Keystore format and cannot be opened on Android 5.1. Restore API keys from a SpeakCoach AI Settings backup.");
        }
        return Api23Keystore.decrypt(payload);
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
                boolean removed = prefs.edit().remove(keyId).commit();
                JSObject ret = new JSObject();
                ret.put("saved", removed);
                call.resolve(ret);
                return;
            }

            String payload = encryptValue(value);
            boolean saved = prefs.edit().putString(keyId, payload).commit();

            // Verify the persisted ciphertext by decrypting it before reporting success.
            if (saved) {
                String persistedPayload = prefs.getString(keyId, null);
                saved = persistedPayload != null && value.equals(decryptValue(persistedPayload));
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
            ret.put("value", decryptValue(payload));
            call.resolve(ret);
        } catch (Exception e) {
            // Do not disguise a decryption/Keystore failure as an empty key.
            // The TypeScript storage layer can then try its legacy fallback.
            call.reject("Failed to decrypt saved API key: " + e.getMessage(), e);
        }
    }
}
