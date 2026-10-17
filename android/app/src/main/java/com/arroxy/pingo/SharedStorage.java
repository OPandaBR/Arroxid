package com.arroxy.pingo;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** The public Download/Pingo folder, reached through MediaStore (no storage permission needed). */
final class SharedStorage {

    static final String PUBLIC_SUBDIR = "Pingo";
    static final String PUBLIC_DIR_LABEL = "Download/" + PUBLIC_SUBDIR;

    record Published(String name, String relativePath, long sizeBytes) {}

    record Found(Uri uri, String mime) {}

    private SharedStorage() {}

    /** Copies every finished file under {@code root} into Download/Pingo, keeping subfolders. */
    static List<Published> publish(Context context, File root) throws IOException {
        List<Published> out = new ArrayList<>();
        for (File file : listFiles(root)) {
            String relative = root.toURI().relativize(file.getParentFile().toURI()).getPath();
            String relativeDir = PUBLIC_SUBDIR + (relative.isEmpty() ? "" : "/" + relative.replaceAll("/$", ""));
            // MediaStore renames on a clash ("clip (1).mp4"), so report the name it kept.
            String savedName = copyToDownloads(context, file, relativeDir);
            out.add(new Published(savedName, "Download/" + relativeDir + "/" + savedName, file.length()));
        }
        return out;
    }

    /** The content URI of one published file, by the relativePath publish() reported. */
    static Found find(Context context, String relativePath) {
        int slash = relativePath.lastIndexOf('/');
        if (slash <= 0) return null;
        String dir = relativePath.substring(0, slash + 1);
        String name = relativePath.substring(slash + 1);
        String[] projection = {MediaStore.Downloads._ID, MediaStore.Downloads.MIME_TYPE};
        String selection = MediaStore.Downloads.RELATIVE_PATH + "=? AND " + MediaStore.Downloads.DISPLAY_NAME + "=?";
        try (Cursor cursor = context.getContentResolver().query(MediaStore.Downloads.EXTERNAL_CONTENT_URI, projection, selection, new String[] {dir, name}, null)) {
            if (cursor == null || !cursor.moveToFirst()) return null;
            Uri uri = Uri.withAppendedPath(MediaStore.Downloads.EXTERNAL_CONTENT_URI, String.valueOf(cursor.getLong(0)));
            return new Found(uri, cursor.getString(1));
        }
    }

    static String mimeOf(String fileName) {
        int dot = fileName.lastIndexOf('.');
        String extension = dot < 0 ? "" : fileName.substring(dot + 1).toLowerCase(Locale.ROOT);
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return mime == null ? "application/octet-stream" : mime;
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

    private static String copyToDownloads(Context context, File file, String relativeDir) throws IOException {
        ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, file.getName());
        values.put(MediaStore.Downloads.MIME_TYPE, mimeOf(file.getName()));
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
}
