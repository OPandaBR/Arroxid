package com.arroxy.app;

import android.content.ComponentName;
import android.content.Intent;
import com.getcapacitor.JSObject;

/**
 * Turns the ways into the app into one "launch" the UI handles:
 * a share (reviewed, or queued at once through the "Download now" target),
 * text selected in another app, or a launcher shortcut.
 */
final class LaunchIntents {

    static final String ACTION_PASTE_LINK = "com.arroxy.app.PASTE_LINK";
    static final String ACTION_OPEN_DOWNLOADS = "com.arroxy.app.OPEN_DOWNLOADS";
    // The share target that queues without asking (the phone's take on the desktop hotkey).
    static final String QUICK_DOWNLOAD_ALIAS = "com.arroxy.app.QuickDownload";

    private LaunchIntents() {}

    static JSObject read(Intent intent) {
        if (intent == null || intent.getAction() == null) return null;
        switch (intent.getAction()) {
            case Intent.ACTION_SEND: {
                String text = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (text == null || text.isBlank()) return null;
                ComponentName component = intent.getComponent();
                boolean quick = component != null && QUICK_DOWNLOAD_ALIAS.equals(component.getClassName());
                return share(text, quick);
            }
            case Intent.ACTION_PROCESS_TEXT: {
                CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
                return text == null || text.toString().isBlank() ? null : share(text.toString(), false);
            }
            case ACTION_PASTE_LINK:
                return kind("paste");
            case ACTION_OPEN_DOWNLOADS:
                return kind("downloads");
            default:
                return null;
        }
    }

    private static JSObject share(String text, boolean quick) {
        JSObject launch = kind("share");
        launch.put("text", text);
        launch.put("quick", quick);
        return launch;
    }

    private static JSObject kind(String kind) {
        JSObject launch = new JSObject();
        launch.put("kind", kind);
        return launch;
    }
}
