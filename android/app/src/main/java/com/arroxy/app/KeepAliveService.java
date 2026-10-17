package com.arroxy.app;

import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.ServiceCompat;

/**
 * Keeps the process alive while yt-dlp runs, so a download continues with the
 * screen off or the app in the background. Reference-counted by the plugin;
 * it stops shortly after the last run, which lets the queue start its next
 * item without the service flapping. Its notification is the live progress one.
 */
public class KeepAliveService extends Service {

    private static final long STOP_DELAY_MS = 3_000;

    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static int activeRuns = 0;
    private static boolean running = false;
    private static DownloadNotifications.ProgressNotice notice = null;

    static synchronized void acquire(Context context) {
        activeRuns++;
        if (activeRuns == 1) {
            handler.removeCallbacksAndMessages(null);
            Context app = context.getApplicationContext();
            try {
                app.startForegroundService(new Intent(app, KeepAliveService.class));
            } catch (IllegalStateException e) {
                // Started from the background on Android 12+: the run continues
                // without the keep-alive rather than failing.
            }
        }
    }

    static synchronized void release(Context context) {
        activeRuns = Math.max(0, activeRuns - 1);
        if (activeRuns == 0) {
            Context app = context.getApplicationContext();
            handler.postDelayed(() -> {
                synchronized (KeepAliveService.class) {
                    if (activeRuns == 0) app.stopService(new Intent(app, KeepAliveService.class));
                }
            }, STOP_DELAY_MS);
        }
    }

    /** New progress from the queue; shown at once when the service is up. */
    static synchronized void update(Context context, DownloadNotifications.ProgressNotice next) {
        notice = next;
        if (running && next != null) context.getSystemService(NotificationManager.class).notify(DownloadNotifications.PROGRESS_ID, DownloadNotifications.progress(context, next));
    }

    private static synchronized DownloadNotifications.ProgressNotice currentNotice(Context context) {
        return notice != null ? notice : new DownloadNotifications.ProgressNotice(context.getString(R.string.app_name), context.getString(R.string.notification_downloading), -1, false, null);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0;
        ServiceCompat.startForeground(this, DownloadNotifications.PROGRESS_ID, DownloadNotifications.progress(this, currentNotice(this)), type);
        synchronized (KeepAliveService.class) {
            running = true;
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        synchronized (KeepAliveService.class) {
            running = false;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
