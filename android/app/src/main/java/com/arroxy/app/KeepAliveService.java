package com.arroxy.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Keeps the process alive while yt-dlp runs, so a download continues with the
 * screen off or the app in the background. Reference-counted by the plugin;
 * it stops shortly after the last run, which lets the queue start its next
 * item without the service flapping.
 */
public class KeepAliveService extends Service {

    private static final String CHANNEL_ID = "downloads";
    private static final int NOTIFICATION_ID = 1;
    private static final long STOP_DELAY_MS = 3_000;

    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static int activeRuns = 0;

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

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID, getString(R.string.notification_channel_downloads), NotificationManager.IMPORTANCE_LOW));
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notification_downloading))
            .setOngoing(true)
            .setContentIntent(android.app.PendingIntent.getActivity(this, 0, open, android.app.PendingIntent.FLAG_IMMUTABLE))
            .build();
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
