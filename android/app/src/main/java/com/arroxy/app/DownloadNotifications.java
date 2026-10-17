package com.arroxy.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import androidx.core.app.NotificationCompat;

/**
 * Arroxy's notifications: the ongoing one that carries live download progress
 * (the phone's take on the desktop tray), and one per finished or failed item
 * (the desktop's OS notifications).
 */
final class DownloadNotifications {

    static final String CHANNEL_PROGRESS = "downloads";
    static final String CHANNEL_RESULTS = "results";
    static final int PROGRESS_ID = 1;
    // Broadcast fired by the progress notification's buttons; the plugin relays it to JS.
    static final String ACTION_NOTIFICATION = "com.arroxy.app.NOTIFICATION_ACTION";
    static final String EXTRA_ACTION = "action";

    /** What the ongoing notification shows; percent < 0 means indeterminate. */
    record ProgressNotice(String title, String text, int percent, boolean paused, String actionLabel) {}

    private DownloadNotifications() {}

    static void ensureChannels(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL_PROGRESS, context.getString(R.string.notification_channel_downloads), NotificationManager.IMPORTANCE_LOW));
        manager.createNotificationChannel(new NotificationChannel(CHANNEL_RESULTS, context.getString(R.string.notification_channel_results), NotificationManager.IMPORTANCE_DEFAULT));
    }

    private static PendingIntent openApp(Context context, int requestCode) {
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).setAction(LaunchIntents.ACTION_OPEN_DOWNLOADS);
        return PendingIntent.getActivity(context, requestCode, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static Notification progress(Context context, ProgressNotice notice) {
        ensureChannels(context);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_PROGRESS)
            .setSmallIcon(notice.paused() ? android.R.drawable.ic_media_pause : android.R.drawable.stat_sys_download)
            .setColor(context.getColor(R.color.ember))
            .setContentTitle(notice.title())
            .setContentText(notice.text())
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setContentIntent(openApp(context, 0));
        if (!notice.paused()) builder.setProgress(100, Math.max(0, notice.percent()), notice.percent() < 0);
        if (notice.actionLabel() != null) {
            Intent action = new Intent(ACTION_NOTIFICATION).setPackage(context.getPackageName()).putExtra(EXTRA_ACTION, notice.paused() ? "resumeAll" : "pauseAll");
            PendingIntent pending = PendingIntent.getBroadcast(context, 1, action, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            builder.addAction(0, notice.actionLabel(), pending);
        }
        return builder.build();
    }

    /** A finished (or failed) item. Tapping opens the saved file when there is one, else the app. */
    static void result(Context context, int id, String title, String text, SharedStorage.Found file) {
        ensureChannels(context);
        PendingIntent tap = openApp(context, 100 + id);
        if (file != null) {
            Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(file.uri(), file.mime()).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            tap = PendingIntent.getActivity(context, 100 + id, view, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        }
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_RESULTS)
            .setSmallIcon(file != null ? android.R.drawable.stat_sys_download_done : android.R.drawable.stat_notify_error)
            .setColor(context.getColor(R.color.ember))
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setContentIntent(tap)
            .build();
        context.getSystemService(NotificationManager.class).notify(id, notification);
    }
}
