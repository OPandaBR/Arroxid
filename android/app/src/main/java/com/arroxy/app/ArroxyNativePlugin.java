package com.arroxy.app;

import android.app.DownloadManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yausername.ffmpeg.FFmpeg;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import kotlin.Unit;
import org.json.JSONException;

/**
 * The native half of the Android host (see src/android/host.ts for the
 * contract). Runs yt-dlp through youtubedl-android's bundled Python and ffmpeg,
 * and moves finished files into the public Download/Arroxy folder. Argument
 * planning stays in the WebView, where the desktop planner lives.
 */
@CapacitorPlugin(name = "ArroxyNative")
public class ArroxyNativePlugin extends Plugin {

    static final String PUBLIC_SUBDIR = "Arroxy";
    private static final String PUBLIC_DIR_LABEL = "Download/" + PUBLIC_SUBDIR;

    private final ExecutorService executor = Executors.newCachedThreadPool();

    // Text shared into the app ("Share → Arroxy"), held until the UI takes it.
    private String pendingShare = null;

    @Override
    public void load() {
        rememberShare(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (rememberShare(intent)) notifyListeners("sharedText", new JSObject());
    }

    private boolean rememberShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.isEmpty()) return false;
        synchronized (this) {
            pendingShare = text;
        }
        return true;
    }

    @PluginMethod
    public void takeSharedText(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (this) {
            result.put("text", pendingShare == null ? JSObject.NULL : pendingShare);
            pendingShare = null;
        }
        call.resolve(result);
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        String relativePath = call.getString("relativePath", "");
        int slash = relativePath.lastIndexOf('/');
        if (slash <= 0) {
            call.reject("not a file path: " + relativePath);
            return;
        }
        String dir = relativePath.substring(0, slash + 1);
        String name = relativePath.substring(slash + 1);
        ContentResolver resolver = getContext().getContentResolver();
        String[] projection = {MediaStore.Downloads._ID, MediaStore.Downloads.MIME_TYPE};
        String selection = MediaStore.Downloads.RELATIVE_PATH + "=? AND " + MediaStore.Downloads.DISPLAY_NAME + "=?";
        try (Cursor cursor = resolver.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI, projection, selection, new String[] {dir, name}, null)) {
            if (cursor == null || !cursor.moveToFirst()) {
                call.reject("file not found: " + relativePath);
                return;
            }
            Uri uri = Uri.withAppendedPath(MediaStore.Downloads.EXTERNAL_CONTENT_URI, String.valueOf(cursor.getLong(0)));
            Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, cursor.getString(1)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(Intent.createChooser(view, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (Exception e) {
            call.reject("cannot open " + relativePath + ": " + e.getMessage(), e);
        }
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

    @PluginMethod
    public void prepare(PluginCall call) {
        executor.execute(() -> {
            try {
                Context context = getContext().getApplicationContext();
                YoutubeDL.getInstance().init(context);
                FFmpeg.getInstance().init(context);
                JSObject result = new JSObject();
                result.put("workDir", workDir().getAbsolutePath());
                result.put("publicDir", PUBLIC_DIR_LABEL);
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

    @PluginMethod
    public void publish(PluginCall call) {
        String dir = call.getString("dir");
        executor.execute(() -> {
            try {
                File root = insideWorkDir(dir == null ? "" : dir);
                JSArray files = new JSArray();
                for (File file : listFiles(root)) {
                    String relative = root.toURI().relativize(file.getParentFile().toURI()).getPath();
                    String relativeDir = PUBLIC_SUBDIR + (relative.isEmpty() ? "" : "/" + relative.replaceAll("/$", ""));
                    // MediaStore renames on a clash ("clip (1).mp4"), so report the name it kept.
                    String savedName = copyToDownloads(file, relativeDir);
                    JSObject entry = new JSObject();
                    entry.put("name", savedName);
                    entry.put("relativePath", "Download/" + relativeDir + "/" + savedName);
                    entry.put("sizeBytes", file.length());
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
        Intent intent = new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http")) {
            call.reject("only http(s) links can be opened");
            return;
        }
        getContext().startActivity(new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve();
    }

    // Finished files only: yt-dlp's partial and internal files stay behind.
    private static boolean isPublishable(File file) {
        String name = file.getName();
        return !name.endsWith(".part") && !name.endsWith(".ytdl") && !name.endsWith(".info.json") && !name.startsWith(".");
    }

    private static List<File> listFiles(File dir) {
        List<File> out = new ArrayList<>();
        File[] children = dir.listFiles();
        if (children == null) return out;
        for (File child : children) {
            if (child.isDirectory()) out.addAll(listFiles(child));
            else if (isPublishable(child)) out.add(child);
        }
        return out;
    }

    private String copyToDownloads(File file, String relativeDir) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        String extension = MimeTypeMap.getFileExtensionFromUrl(Uri.fromFile(file).toString());
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase(Locale.ROOT));
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, file.getName());
        values.put(MediaStore.Downloads.MIME_TYPE, mime == null ? "application/octet-stream" : mime);
        values.put(MediaStore.Downloads.RELATIVE_PATH, "Download/" + relativeDir);
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri target = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (target == null) throw new IOException("MediaStore refused " + file.getName());
        try (InputStream in = new FileInputStream(file); OutputStream out = resolver.openOutputStream(target)) {
            if (out == null) throw new IOException("cannot write " + file.getName());
            byte[] buffer = new byte[1 << 16];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
        } catch (IOException e) {
            resolver.delete(target, null, null);
            throw e;
        }
        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        resolver.update(target, values, null, null);
        try (Cursor cursor = resolver.query(target, new String[] {MediaStore.Downloads.DISPLAY_NAME}, null, null, null)) {
            return cursor != null && cursor.moveToFirst() ? cursor.getString(0) : file.getName();
        }
    }

    private static void deleteRecursively(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
