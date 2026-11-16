package com.ariyand.speakcoach.plugins;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.security.MessageDigest;

@CapacitorPlugin(name = "UpdateInstaller")
public class UpdateInstallerPlugin extends Plugin {
    private boolean matchesSha256(File file, String expected) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[8192];
        try (FileInputStream input = new FileInputStream(file)) {
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        StringBuilder actual = new StringBuilder();
        for (byte value : digest.digest()) actual.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return actual.toString().equalsIgnoreCase(expected);
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String suppliedPath = call.getString("path");
        String expectedSha256 = call.getString("sha256");
        if (suppliedPath == null || suppliedPath.trim().isEmpty()) {
            call.reject("Missing downloaded APK path.");
            return;
        }

        if (expectedSha256 == null || !expectedSha256.matches("(?i)[a-f0-9]{64}")) {
            call.reject("Missing or invalid SHA-256 checksum for the update APK.");
            return;
        }

        try {
            Uri suppliedUri = Uri.parse(suppliedPath);
            File apkFile = "file".equalsIgnoreCase(suppliedUri.getScheme())
                    ? new File(suppliedUri.getPath())
                    : new File(suppliedPath);

            if (!apkFile.isFile() || !apkFile.canRead() || !apkFile.getName().toLowerCase().endsWith(".apk")) {
                call.reject("The downloaded update APK could not be found or read.");
                return;
            }
            if (!matchesSha256(apkFile, expectedSha256)) {
                call.reject("The downloaded APK failed its SHA-256 integrity check. Delete it and download the update again.");
                return;
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent permissionIntent = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName())
                );
                permissionIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(permissionIntent);

                JSObject result = new JSObject();
                result.put("permissionRequired", true);
                call.resolve(result);
                return;
            }

            Uri apkUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    apkFile
            );
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(installIntent);

            JSObject result = new JSObject();
            result.put("permissionRequired", false);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not open the Android package installer: " + error.getMessage());
        }
    }
}
