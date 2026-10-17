package com.arroxy.pingo;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.yausername.ffmpeg.FFmpeg;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import kotlin.Unit;
import org.json.JSONException;

/**
 * The native half of the Android shell (see src/android/nativePort.ts for the
 * contract). Runs yt-dlp through youtubedl-android's bundled Python and ffmpeg,
 * publishes finished files to Download/Pingo, and carries the phone's own
 * integrations: share targets and shortcuts, clipboard, notifications, the
 * system share sheet and the file picker. Argument planning stays in the
 * WebView, where the desktop planner lives.
 */
@CapacitorPlugin(name = "ArroxyNative", permissions = {@Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})})
public class ArroxyNativePlugin extends Plugin {

    private static final long MAX_COOKIES_BYTES = 5L * 1024 * 1024;

    private final ExecutorService executor = Executors.newCachedThreadPool();

    // How the app was last entered (share, shortcut…), held until the UI takes it.
    private JSObject pendingLaunch = null;

    private final BroadcastReceiver notificationActions = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getStringExtra(DownloadNotifications.EXTRA_ACTION);
            if (action == null) return;
            JSObject event = new JSObject();
            event.put("action", action);
            notifyListeners("notificationAction", event);
        }
    };

    @Override
    public void load() {
        rememberLaunch(getActivity().getIntent());
        ContextCompat.registerReceiver(getContext(), notificationActions, new IntentFilter(DownloadNotifications.ACTION_NOTIFICATION), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        getContext().unregisterReceiver(notificationActions);
        super.handleOnDestroy();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (rememberLaunch(intent)) notifyListeners("launch", new JSObject());
    }

    private boolean rememberLaunch(Intent intent) {
        JSObject launch = LaunchIntents.read(intent);
        if (launch == null) return false;
        synchronized (this) {
            pendingLaunch = launch;
        }
        // Consumed: recreating the activity must not replay it.
        getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        return true;
    }

    private File workDir() {
        File dir = new File(getContext().getFilesDir(), "arroxy");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("cannot create " + dir);
        return dir;
    }

    // Only paths inside the app's own work directory may be touched from JS.
    private File insideWorkDir(String path) throws IOException {
        File root = workDir().getCanonicalFile();
        File target = new File(path).getCanonicalFile();
        if (!target.getPath().startsWith(root.getPath() + File.separator)) throw new IOException("path outside the work directory: " + path);
        return target;
    }

    // ---- yt-dlp -------------------------------------------------------------

    @PluginMethod
    public void prepare(PluginCall call) {
        executor.execute(() -> {
            try {
                Context context = getContext().getApplicationContext();
                YoutubeDL.getInstance().init(context);
                FFmpeg.getInstance().init(context);
                JSObject result = new JSObject();
                result.put("workDir", workDir().getAbsolutePath());
                result.put("publicDir", SharedStorage.PUBLIC_DIR_LABEL);
                result.put("ytDlpVersion", YoutubeDL.getInstance().version(context));
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Could not prepare yt-dlp: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void updateYtDlp(PluginCall call) {
        executor.execute(() -> {
            try {
                Context context = getContext().getApplicationContext();
                YoutubeDL.UpdateStatus status = YoutubeDL.getInstance().updateYoutubeDL(context, YoutubeDL.UpdateChannel._NIGHTLY);
                JSObject result = new JSObject();
                result.put("updated", status == YoutubeDL.UpdateStatus.DONE);
                result.put("ytDlpVersion", YoutubeDL.getInstance().version(context));
                call.resolve(result);
            } catch (Exception e) {
                call.reject("yt-dlp update failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void run(PluginCall call) {
        String runId = call.getString("runId");
        JSArray rawArgs = call.getArray("args");
        boolean streamLines = Boolean.TRUE.equals(call.getBoolean("streamLines", false));
        if (runId == null || rawArgs == null) {
            call.reject("run needs a runId and args");
            return;
        }
        List<String> args;
        try {
            args = rawArgs.toList();
        } catch (JSONException e) {
            call.reject("args must be strings", e);
            return;
        }
        executor.execute(() -> {
            KeepAliveService.acquire(getContext());
            JSObject result = new JSObject();
            try {
                YoutubeDLRequest request = new YoutubeDLRequest(Collections.emptyList());
                request.addCommands(args);
                YoutubeDLResponse response = YoutubeDL.getInstance().execute(request, runId, (progress, eta, line) -> {
                    if (streamLines) {
                        JSObject event = new JSObject();
                        event.put("runId", runId);
                        event.put("line", line);
                        notifyListeners("runLine", event);
                    }
                    return Unit.INSTANCE;
                });
                result.put("exitCode", response.getExitCode());
                result.put("stdout", response.getOut());
                result.put("stderr", response.getErr());
                result.put("cancelled", false);
            } catch (YoutubeDL.CanceledException e) {
                result.put("exitCode", 1);
                result.put("stdout", "");
                result.put("stderr", "");
                result.put("cancelled", true);
            } catch (Exception e) {
                // youtubedl-android throws on a non-zero exit, carrying stderr as the message.
                result.put("exitCode", 1);
                result.put("stdout", "");
                result.put("stderr", e.getMessage() == null ? e.toString() : e.getMessage());
                result.put("cancelled", false);
            } finally {
                KeepAliveService.release(getContext());
            }
            call.resolve(result);
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String runId = call.getString("runId");
        if (runId != null) YoutubeDL.getInstance().destroyProcessById(runId);
        call.resolve();
    }

    // ---- Files ----------------------------------------------------------------

    @PluginMethod
    public void publish(PluginCall call) {
        String dir = call.getString("dir");
        executor.execute(() -> {
            try {
                JSArray files = new JSArray();
                for (SharedStorage.Published file : SharedStorage.publish(getContext(), insideWorkDir(dir == null ? "" : dir))) {
                    JSObject entry = new JSObject();
                    entry.put("name", file.name());
                    entry.put("relativePath", file.relativePath());
                    entry.put("sizeBytes", file.sizeBytes());
                    files.put(entry);
                }
                JSObject result = new JSObject();
                result.put("files", files);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Could not save the download: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void removeDir(PluginCall call) {
        String dir = call.getString("dir");
        executor.execute(() -> {
            try {
                deleteRecursively(insideWorkDir(dir == null ? "" : dir));
                call.resolve();
            } catch (IOException e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void openDownloads(PluginCall call) {
        getContext().startActivity(new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve();
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        String relativePath = call.getString("relativePath", "");
        SharedStorage.Found file = SharedStorage.find(getContext(), relativePath);
        if (file == null) {
            call.reject("file not found: " + relativePath);
            return;
        }
        Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(file.uri(), file.mime()).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getContext().startActivity(Intent.createChooser(view, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve();
    }

    /** The system share sheet for one saved file (send it to a chat, a drive…). */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String relativePath = call.getString("relativePath", "");
        SharedStorage.Found file = SharedStorage.find(getContext(), relativePath);
        if (file == null) {
            call.reject("file not found: " + relativePath);
            return;
        }
        Intent send = new Intent(Intent.ACTION_SEND).setType(file.mime()).putExtra(Intent.EXTRA_STREAM, file.uri()).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getContext().startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve();
    }

    /** The system share sheet for text: error details, or a link to Pingo. */
    @PluginMethod
    public void shareText(PluginCall call) {
        String text = call.getString("text", "");
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
        getContext().startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve();
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        Uri uri = Uri.parse(call.getString("url", ""));
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http")) {
            call.reject("only http(s) links can be opened");
            return;
        }
        getContext().startActivity(new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve();
    }

    /** Lets the user pick a cookies.txt; a private copy is what yt-dlp reads (and may update). */
    @PluginMethod
    public void pickCookiesFile(PluginCall call) {
        Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        startActivityForResult(call, pick, "cookiesPicked");
    }

    @ActivityCallback
    private void cookiesPicked(PluginCall call, ActivityResult result) {
        JSObject reply = new JSObject();
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            reply.put("path", JSObject.NULL);
            call.resolve(reply);
            return;
        }
        executor.execute(() -> {
            File target = new File(workDir(), "cookies.txt");
            try (InputStream in = getContext().getContentResolver().openInputStream(uri); OutputStream out = new FileOutputStream(target)) {
                if (in == null) throw new IOException("cannot read the chosen file");
                byte[] buffer = new byte[1 << 14];
                long total = 0;
                int read;
                while ((read = in.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_COOKIES_BYTES) throw new IOException("the file is too large to be a cookies file");
                    out.write(buffer, 0, read);
                }
                reply.put("path", target.getAbsolutePath());
                call.resolve(reply);
            } catch (IOException e) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void removeCookiesFile(PluginCall call) {
        //noinspection ResultOfMethodCallIgnored
        new File(workDir(), "cookies.txt").delete();
        call.resolve();
    }

    // ---- Entry points, clipboard, task ---------------------------------------

    @PluginMethod
    public void takeLaunch(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (this) {
            result.put("launch", pendingLaunch == null ? JSObject.NULL : pendingLaunch);
            pendingLaunch = null;
        }
        call.resolve(result);
    }

    // Android only hands the clipboard to the focused app, which is exactly
    // when the UI asks (the desktop watcher's rule: only while in front).
    // With `since`, the text is read only for a clip copied after it: reading
    // shows Android 12+'s "pasted from your clipboard" toast, the timestamp does not.
    @PluginMethod
    public void readClipboard(PluginCall call) {
        long since = call.getLong("since", -1L);
        getActivity().runOnUiThread(() -> {
            JSObject result = new JSObject();
            ClipboardManager clipboard = getContext().getSystemService(ClipboardManager.class);
            ClipDescription description = clipboard == null ? null : clipboard.getPrimaryClipDescription();
            long copiedAt = description == null ? -1L : description.getTimestamp();
            result.put("copiedAt", copiedAt);
            boolean fresh = since < 0 || copiedAt > since;
            ClipData clip = description == null || !fresh ? null : clipboard.getPrimaryClip();
            CharSequence text = clip == null || clip.getItemCount() == 0 ? null : clip.getItemAt(0).coerceToText(getContext());
            result.put("text", text == null ? JSObject.NULL : text.toString());
            call.resolve(result);
        });
    }

    /** Back to the app the user came from, after a quick download was queued. */
    @PluginMethod
    public void moveToBackground(PluginCall call) {
        getActivity().runOnUiThread(() -> getActivity().moveTaskToBack(true));
        call.resolve();
    }

    // ---- Notifications ----------------------------------------------------------

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            resolveGranted(call, true);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsAnswered");
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        resolveGranted(call, getPermissionState("notifications") == PermissionState.GRANTED);
    }

    private static void resolveGranted(PluginCall call, boolean granted) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void setProgressNotice(PluginCall call) {
        JSObject notice = call.getObject("notice");
        if (notice == null) {
            KeepAliveService.update(getContext(), null);
        } else {
            String actionLabel = notice.getString("actionLabel");
            KeepAliveService.update(getContext(), new DownloadNotifications.ProgressNotice(notice.getString("title", ""), notice.getString("text", ""), notice.getInteger("percent", -1), Boolean.TRUE.equals(notice.getBool("paused")), actionLabel));
        }
        call.resolve();
    }

    @PluginMethod
    public void showResult(PluginCall call) {
        int id = call.getInt("id", 0);
        String title = call.getString("title", "");
        String text = call.getString("text", "");
        String relativePath = call.getString("relativePath");
        executor.execute(() -> {
            SharedStorage.Found file = relativePath == null ? null : SharedStorage.find(getContext(), relativePath);
            DownloadNotifications.result(getContext(), id, title, text, file);
            call.resolve();
        });
    }

    private static void deleteRecursively(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
