package com.designsos.livescenes;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;

/** The catalog (sdk/FORMAT.md): a JSON list of looks to browse, with URLs relative to the catalog's own. */
final class Catalog {
    static final class Entry {
        JSONObject json;          // the catalog's entry, as is
        String id, title, description;
        URL poster;
        String orientation;       // the video this device would download
        URL video;
        long bytes;
        String sha256;
    }

    interface Progress { void update(long done, long total); }

    static List<Entry> fetch(String url, String orientation) throws IOException {
        URL base = new URL(url);
        JSONObject o;
        try {
            o = new JSONObject(new String(get(base), StandardCharsets.UTF_8));
        } catch (JSONException e) {
            throw new IOException("not a catalog: " + e.getMessage());
        }
        List<Entry> list = new ArrayList<>();
        JSONArray looks = o.optJSONArray("looks");
        for (int i = 0; looks != null && i < looks.length(); i++) {
            JSONObject l = looks.optJSONObject(i);
            JSONObject videos = l != null ? l.optJSONObject("videos") : null;
            if (videos == null || !l.optString("id").matches("[a-z0-9-]+")) continue;
            Entry e = new Entry();
            e.json = l;
            e.id = l.optString("id");
            e.title = l.optString("title", e.id);
            e.description = l.optString("description", "");
            if (!l.optString("poster").isEmpty()) e.poster = new URL(base, l.optString("poster"));
            String other = orientation.equals("portrait") ? "landscape" : "portrait";
            for (String c : new String[]{orientation, other}) {
                JSONObject v = videos.optJSONObject(c);
                if (v == null || v.optString("url").isEmpty()) continue;
                e.orientation = c;
                e.video = new URL(base, v.optString("url"));
                e.bytes = v.optLong("bytes");
                e.sha256 = v.optString("sha256", "");
                break;
            }
            if (e.video != null) list.add(e);
        }
        return list;
    }

    static byte[] get(URL url) throws IOException {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream()) {
            return in.readAllBytes();
        } finally {
            c.disconnect();
        }
    }

    /** Downloads to {@code dest} (via a .part file), checking the sha256 if one is given. */
    static void download(URL url, File dest, String sha256, Progress progress, BooleanSupplier cancelled) throws IOException {
        File part = new File(dest.getPath() + ".part");
        HttpURLConnection c = open(url);
        MessageDigest md = Store.sha256();
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
            long total = c.getContentLengthLong(), done = 0, shown = 0;
            byte[] buf = new byte[1 << 16];
            for (int n; (n = in.read(buf)) > 0; ) {
                if (cancelled.getAsBoolean()) throw new InterruptedIOException("cancelled");
                out.write(buf, 0, n);
                md.update(buf, 0, n);
                done += n;
                if (progress != null && (done - shown > (1 << 18) || done == total)) { shown = done; progress.update(done, total); }
            }
        } catch (IOException e) {
            part.delete();
            throw e;
        } finally {
            c.disconnect();
        }
        if (sha256 != null && !sha256.isEmpty() && !sha256.equalsIgnoreCase(Store.hex(md.digest()))) {
            part.delete();
            throw new IOException("the download is damaged (sha256 mismatch)");
        }
        if (!part.renameTo(dest)) { part.delete(); throw new IOException("can't save " + dest); }
    }

    static HttpURLConnection open(URL url) throws IOException {
        // follow redirects by hand too: GitHub release assets redirect, and Java won't cross http -> https
        for (int hops = 0; hops < 6; hops++) {
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setConnectTimeout(15_000);
            c.setReadTimeout(30_000);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", "LiveScenes-Android");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                url = new URL(url, c.getHeaderField("Location"));
                c.disconnect();
                continue;
            }
            if (code != 200) { c.disconnect(); throw new IOException("HTTP " + code + " for " + url); }
            return c;
        }
        throw new IOException("too many redirects: " + url);
    }
}
