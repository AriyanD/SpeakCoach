package com.ariyand.speakcoach.plugins;

import android.app.Activity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Native actions used by the app-wide Android Back navigation handler. */
@CapacitorPlugin(name = "NativeBack")
public class NativeBackPlugin extends Plugin {
    @PluginMethod
    public void exitApp(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("The Android activity is not available.");
            return;
        }

        activity.runOnUiThread(() -> {
            JSObject result = new JSObject();
            result.put("exited", true);
            call.resolve(result);
            activity.finish();
        });
    }
}
