package com.ariyand.speakcoach.plugins;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "BackupExport")
public class BackupExportPlugin extends Plugin {
    @PluginMethod
    public void saveFile(PluginCall call) {
        String fileName = call.getString("fileName");
        if (fileName == null || fileName.trim().isEmpty()) {
            call.reject("A file name is required.");
            return;
        }
        if (call.getString("contents") == null) {
            call.reject("Backup contents are missing.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "handleSaveResult");
    }

    @ActivityCallback
    private void handleSaveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Save cancelled.");
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("No destination was selected.");
            return;
        }
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri)) {
            if (output == null) throw new IllegalStateException("Could not open the selected destination.");
            String contents = call.getString("contents", "");
            output.write(contents.getBytes(StandardCharsets.UTF_8));
            output.flush();
            JSObject resultData = new JSObject();
            resultData.put("uri", uri.toString());
            resultData.put("saved", true);
            call.resolve(resultData);
        } catch (Exception error) {
            call.reject("Could not save the backup: " + error.getMessage(), error);
        }
    }
}
