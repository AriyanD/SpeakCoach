package com.ariyand.speakcoach;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.ariyand.speakcoach.plugins.SecureKeyPlugin;
import com.ariyand.speakcoach.plugins.BackupExportPlugin;
import com.ariyand.speakcoach.plugins.BackupImportPlugin;
import com.ariyand.speakcoach.plugins.SpeakCoachSpeechPlugin;
import com.ariyand.speakcoach.plugins.NativeBackPlugin;
import com.ariyand.speakcoach.plugins.UpdateInstallerPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureKeyPlugin.class);
        registerPlugin(BackupExportPlugin.class);
        registerPlugin(BackupImportPlugin.class);
        registerPlugin(SpeakCoachSpeechPlugin.class);
        registerPlugin(NativeBackPlugin.class);
        registerPlugin(UpdateInstallerPlugin.class);
        super.onCreate(savedInstanceState);

        // Consume Android hardware and gesture Back at the Activity boundary.
        // The web app decides whether to close an overlay, pop an app route,
        // or request a confirmed exit from the root screen.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                            "window.dispatchEvent(new Event('speakcoach:back'))",
                            null
                    );
                } else {
                    finish();
                }
            }
        });
    }
}
