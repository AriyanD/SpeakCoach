package com.ariyand.speakcoach.plugins;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "BackupImport")
public class BackupImportPlugin extends Plugin {
    private static final int MAX_BACKUP_BYTES = 10 * 1024 * 1024;

    @PluginMethod
    public void selectFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
                "application/json",
                "text/json",
                "text/plain",
                "application/octet-stream"
        });
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "handleSelectResult");
    }

    @ActivityCallback
    private void handleSelectResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Backup file selection was cancelled.");
            return;
        }

        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("Android did not return a readable file location.");
            return;
        }

        try {
            String fileName = getDisplayName(uri);
            byte[] bytes;
            try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                if (input == null) {
                    throw new IllegalStateException("Android could not open the selected document.");
                }
                byte[] buffer = new byte[8192];
                int total = 0;
                int count;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > MAX_BACKUP_BYTES) {
                        throw new IllegalArgumentException("The selected backup is larger than 10 MB.");
                    }
                    output.write(buffer, 0, count);
                }
                bytes = output.toByteArray();
            }

            String contents = new String(bytes, StandardCharsets.UTF_8);
            JSObject response = new JSObject();
            response.put("fileName", fileName);
            response.put("contents", contents);
            response.put("uri", uri.toString());
            response.put("bytesRead", bytes.length);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not read the selected backup file: " + error.getMessage(), error);
        }
    }

    private String getDisplayName(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(
                    uri,
                    new String[] { OpenableColumns.DISPLAY_NAME },
                    null,
                    null,
                    null
            );
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.trim().isEmpty()) return name;
                }
            }
        } catch (Exception ignored) {
            // Some document providers do not expose metadata; content reading
            // can still succeed, so use a safe fallback name.
        } finally {
            if (cursor != null) cursor.close();
        }
        String lastSegment = uri.getLastPathSegment();
        return lastSegment == null || lastSegment.trim().isEmpty()
                ? "selected-backup.json"
                : lastSegment;
    }
}
