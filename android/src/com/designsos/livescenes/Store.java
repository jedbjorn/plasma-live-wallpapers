package com.designsos.livescenes;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.media.MediaMetadataRetriever;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Display;
import android.view.Surface;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Saved looks and profiles, laid out as sdk/FORMAT.md says (in the app's files dir):
 * looks/&lt;id&gt;/scene.json + portrait.mp4 or landscape.mp4 + poster.jpg, and profiles.json.
 * One instance per process, shared by the wallpaper and the app; changes notify listeners on the main thread.
 */
final class Store {
    static final String TAG = LiveWallpaperService.TAG;
    static final String DEFAULT_ASSETS = "default";   // the bundled look, never copied to storage
    static final float[] SPEEDS = {0.5f, 1f, 2f};

    static final class Profile {
        String id, name, look;
        float speed = 1f;
    }

    /** What a player needs: one video file and how to crop it. */
    static final class Video {
        String look, title, orientation;
        File file;             // a saved look
        String asset;          // or the bundled one
        int width, height;
        float focusX = 0.5f, focusY = 0.5f;
        float speed = 1f;
        File poster;           // null for the bundled look (asset DEFAULT_ASSETS/poster.jpg)

        /** Changes when a different file should play (a speed change alone doesn't restart playback). */
        String key() {
            return file != null ? file.getPath() + ":" + file.length() + ":" + file.lastModified() : "asset:" + asset;
        }

        AssetFileDescriptor openAsset(Context c) throws IOException { return c.getAssets().openFd(asset); }
    }

    private static Store instance;

    static synchronized Store get(Context c) {
        if (instance == null) instance = new Store(c.getApplicationContext());
        return instance;
    }

    final Context app;
    final File root, looksDir, profilesFile;
    final List<Profile> profiles = new ArrayList<>();
    String active;
    private final CopyOnWriteArrayList<Runnable> listeners = new CopyOnWriteArrayList<>();
    private final Handler main = new Handler(Looper.getMainLooper());

    private Store(Context app) {
        this.app = app;
        root = app.getFilesDir();
        looksDir = new File(root, "looks");
        profilesFile = new File(root, "profiles.json");
        load();
    }

    // ---- listeners

    void addListener(Runnable r) { listeners.add(r); }
    void removeListener(Runnable r) { listeners.remove(r); }
    private void changed() { main.post(() -> { for (Runnable r : listeners) r.run(); }); }

    // ---- profiles.json

    private synchronized void load() {
        profiles.clear();
        active = null;
        if (!profilesFile.exists()) return;
        try {
            JSONObject o = new JSONObject(readText(profilesFile));
            active = o.optString("active", null);
            JSONArray a = o.optJSONArray("profiles");
            for (int i = 0; a != null && i < a.length(); i++) {
                JSONObject p = a.getJSONObject(i);
                Profile pr = new Profile();
                pr.id = p.getString("id");
                pr.name = p.optString("name", pr.id);
                pr.look = p.getString("look");
                pr.speed = nearestSpeed((float) p.optDouble("speed", 1));
                profiles.add(pr);
            }
        } catch (IOException | JSONException e) {
            Log.e(TAG, "bad profiles.json", e);
        }
        if (find(active) == null) active = profiles.isEmpty() ? null : profiles.get(0).id;
    }

    private synchronized void save() {
        try {
            JSONObject o = new JSONObject().put("format", 1);
            if (active != null) o.put("active", active);
            JSONArray a = new JSONArray();
            for (Profile p : profiles) {
                a.put(new JSONObject().put("id", p.id).put("name", p.name).put("look", p.look).put("speed", (double) p.speed));
            }
            o.put("profiles", a);
            writeText(profilesFile, o.toString(2));
        } catch (IOException | JSONException e) {
            Log.e(TAG, "can't write profiles.json", e);
        }
        changed();
    }

    synchronized Profile find(String id) {
        for (Profile p : profiles) if (p.id.equals(id)) return p;
        return null;
    }

    synchronized Profile activeProfile() { return find(active); }

    synchronized List<Profile> list() { return new ArrayList<>(profiles); }

    synchronized void setActive(String id) {
        if (find(id) == null || id.equals(active)) return;
        active = id;
        save();
    }

    synchronized void setSpeed(String id, float speed) {
        Profile p = find(id);
        if (p == null || p.speed == speed) return;
        p.speed = nearestSpeed(speed);
        save();
    }

    synchronized void rename(String id, String name) {
        Profile p = find(id);
        name = name.trim();
        if (p == null || name.isEmpty() || name.equals(p.name)) return;
        p.name = name;
        save();
    }

    /** Deletes a profile (never the active one), and its look's files if no other profile uses them. */
    synchronized boolean delete(String id) {
        Profile p = find(id);
        if (p == null || id.equals(active)) return false;
        profiles.remove(p);
        boolean used = false;
        for (Profile q : profiles) used |= q.look.equals(p.look);
        if (!used) deleteTree(new File(looksDir, p.look));
        save();
        return true;
    }

    /** The profiles that play a look. */
    synchronized List<Profile> profilesFor(String look) {
        List<Profile> l = new ArrayList<>();
        for (Profile p : profiles) if (p.look.equals(look)) l.add(p);
        return l;
    }

    /**
     * A profile for a saved look at a speed, made from the saved files (nothing to download); it becomes the
     * active one. A look has nothing else to set, so if a profile already plays it at that speed, that one is used.
     */
    synchronized Profile addProfile(String look, float speed) {
        speed = nearestSpeed(speed);
        Profile p = withSpeed(profiles, look, speed);
        if (p == null) {
            p = new Profile();
            p.id = UUID.randomUUID().toString().substring(0, 8);
            p.look = look;
            p.speed = speed;
            List<String> taken = new ArrayList<>();
            for (Profile q : profiles) taken.add(q.name);
            p.name = profileName(lookTitle(look), speed, taken);
            profiles.add(p);
        }
        active = p.id;
        save();
        return p;
    }

    static Profile withSpeed(List<Profile> ps, String look, float speed) {
        for (Profile p : ps) if (p.look.equals(look) && p.speed == speed) return p;
        return null;
    }

    /** "Hall" for the first 1× profile, else "Hall (0.5×)", "Hall (2×)", "Hall (1×)"; a number only if that's taken too. */
    static String profileName(String title, float speed, List<String> taken) {
        String base = title + " (" + speedLabel(speed) + ")";
        if (speed == 1f && !taken.contains(title)) return title;
        if (!taken.contains(base)) return base;
        for (int i = 2; ; i++) if (!taken.contains(base + " " + i)) return base + " " + i;
    }

    static String speedLabel(float s) { return (s == 0.5f ? "0.5" : String.valueOf((int) s)) + "×"; }

    static float nearestSpeed(float s) {
        float best = 1f;
        for (float v : SPEEDS) if (Math.abs(v - s) < Math.abs(best - s)) best = v;
        return best;
    }

    // ---- looks

    File lookDir(String id) { return new File(looksDir, id); }

    JSONObject scene(String look) {
        try {
            return new JSONObject(readText(new File(lookDir(look), "scene.json")));
        } catch (IOException | JSONException e) {
            return null;
        }
    }

    String lookTitle(String look) {
        JSONObject s = scene(look);
        return s != null ? s.optString("title", look) : look;
    }

    long lookBytes(String look) { return treeBytes(lookDir(look)); }

    long totalBytes() { return treeBytes(looksDir); }

    /** Whether a look is saved on the device (it may have no profile left, in an odd case). */
    boolean isSaved(String look) { return new File(lookDir(look), "scene.json").isFile(); }

    /** The sha256 a scene lists for its video of an orientation, or "". */
    static String videoSha(JSONObject scene, String orientation) {
        JSONObject v = scene != null ? scene.optJSONObject("videos") : null;
        JSONObject e = v != null ? v.optJSONObject(orientation) : null;
        return e != null ? e.optString("sha256", "") : "";
    }

    /** The catalog has a different video than the saved one (both sha256s known, for the same orientation). */
    static boolean isNewer(String savedSha, String catalogSha) {
        return savedSha != null && catalogSha != null && !savedSha.isEmpty() && !catalogSha.isEmpty()
                && !savedSha.equalsIgnoreCase(catalogSha);
    }

    File poster(String look) {
        File f = new File(lookDir(look), "poster.jpg");
        return f.exists() ? f : null;
    }

    /** The video to play for the active profile, or the bundled look if there is none (or its files are gone). */
    Video playable(boolean landscape) {
        Profile p;
        synchronized (this) { p = activeProfile(); }
        if (p != null) {
            Video v = savedVideo(p.look, landscape);
            if (v != null) { v.speed = p.speed; return v; }
            Log.w(TAG, "look " + p.look + " has no playable video, using the bundled one");
        }
        return bundledVideo(app);
    }

    Video savedVideo(String look, boolean landscape) {
        JSONObject s = scene(look);
        if (s == null) return null;
        File dir = lookDir(look);
        for (String o : landscape ? new String[]{"landscape", "portrait"} : new String[]{"portrait", "landscape"}) {
            JSONObject e = s.optJSONObject("videos") != null ? s.optJSONObject("videos").optJSONObject(o) : null;
            File f = new File(dir, e != null ? e.optString("file", o + ".mp4") : o + ".mp4");
            if (e == null || !f.isFile()) continue;
            Video v = video(s, o, e);
            v.file = f;
            v.poster = poster(look);
            return v;
        }
        return null;
    }

    static Video bundledVideo(Context c) {
        JSONObject s;
        try (InputStream in = c.getAssets().open(DEFAULT_ASSETS + "/scene.json")) {
            s = new JSONObject(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        } catch (IOException | JSONException e) {
            throw new IllegalStateException("the APK has no bundled look", e);
        }
        JSONObject videos = s.optJSONObject("videos");
        for (String o : new String[]{"portrait", "landscape"}) {
            JSONObject e = videos != null ? videos.optJSONObject(o) : null;
            if (e == null) continue;
            String asset = DEFAULT_ASSETS + "/" + e.optString("file", o + ".mp4");
            try (AssetFileDescriptor fd = c.getAssets().openFd(asset)) {
                Video v = video(s, o, e);
                v.asset = asset;
                return v;
            } catch (IOException ignored) {
                // not bundled (or compressed): try the other orientation
            }
        }
        throw new IllegalStateException("the APK has no bundled video");
    }

    private static Video video(JSONObject scene, String orientation, JSONObject e) {
        Video v = new Video();
        v.look = scene.optString("id");
        v.title = scene.optString("title", v.look);
        v.orientation = orientation;
        v.width = e.optInt("width");
        v.height = e.optInt("height");
        JSONArray f = e.optJSONArray("focus");
        if (f != null && f.length() == 2) {
            v.focusX = clamp01((float) f.optDouble(0, 0.5));
            v.focusY = clamp01((float) f.optDouble(1, 0.5));
        }
        return v;
    }

    static Bitmap posterBitmap(Context c, Video v, int maxSide) {
        try (InputStream in = v.poster != null ? new FileInputStream(v.poster)
                : c.getAssets().open(DEFAULT_ASSETS + "/poster.jpg")) {
            return decodeSampled(in.readAllBytes(), maxSide);
        } catch (IOException e) {
            return null;
        }
    }

    /** The video's first frame at full size (the low-battery still), or null. */
    static Bitmap firstFrame(Context c, Video v) {
        try (MediaMetadataRetriever r = new MediaMetadataRetriever()) {
            if (v.file != null) {
                r.setDataSource(v.file.getPath());
            } else {
                try (AssetFileDescriptor fd = v.openAsset(c)) {
                    r.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength());
                }
            }
            return r.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
        } catch (IOException | RuntimeException e) {
            Log.w(LiveWallpaperService.TAG, "first frame of " + v.key() + ": " + e);
            return null;
        }
    }

    static Bitmap decodeSampled(byte[] data, int maxSide) {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(data, 0, data.length, o);
        int s = 1;
        while (Math.max(o.outWidth, o.outHeight) / (s * 2) >= maxSide) s *= 2;
        o = new BitmapFactory.Options();
        o.inSampleSize = s;
        return BitmapFactory.decodeByteArray(data, 0, data.length, o);
    }

    /** The orientation of video this device keeps: the screen's natural one (portrait on phones). */
    static String deviceOrientation(Context c) {
        Display d = c.getSystemService(DisplayManager.class).getDisplay(Display.DEFAULT_DISPLAY);
        Point p = new Point();
        d.getRealSize(p);
        boolean rotated = d.getRotation() == Surface.ROTATION_90 || d.getRotation() == Surface.ROTATION_270;
        boolean landscape = (p.x > p.y) != rotated;
        return landscape ? "landscape" : "portrait";
    }

    // ---- saving a look (from a preview or an import)

    /**
     * Installs a look: scene.json, the one video file (moved), the poster (moved, if any), replacing an older copy
     * (for every profile that plays it). If a profile already plays the look, that one is returned, never a second
     * one: with {@code activate} it becomes the active one, unless the active profile already plays this look.
     * Otherwise a profile is made for it, and it becomes the active one.
     */
    Profile install(JSONObject scene, String orientation, File video, File poster, boolean activate) throws IOException {
        String id = scene.optString("id");
        if (!id.matches("[a-z0-9-]+")) throw new IOException("bad look id: " + id);
        File tmp = new File(looksDir, "." + id + ".new");
        deleteTree(tmp);
        if (!tmp.mkdirs()) throw new IOException("can't create " + tmp);
        try {
            // keep only the entry for the file we have, so readers find what's on disk
            JSONObject s = new JSONObject(scene.toString());
            JSONObject e = scene.getJSONObject("videos").getJSONObject(orientation);
            JSONObject entry = new JSONObject(e.toString());
            entry.remove("url");
            entry.put("file", orientation + ".mp4");
            s.put("videos", new JSONObject().put(orientation, entry));
            s.remove("poster");
            if (!s.has("format")) s.put("format", 1);
            writeText(new File(tmp, "scene.json"), s.toString(2));
        } catch (JSONException e) {
            throw new IOException("bad scene: " + e.getMessage(), e);
        }
        move(video, new File(tmp, orientation + ".mp4"));
        if (poster != null && poster.isFile()) move(poster, new File(tmp, "poster.jpg"));

        Profile result;
        synchronized (this) {
            File dir = lookDir(id), old = new File(looksDir, "." + id + ".old");
            deleteTree(old);
            if (dir.exists() && !dir.renameTo(old)) throw new IOException("can't replace " + dir);
            if (!tmp.renameTo(dir)) throw new IOException("can't install " + dir);
            deleteTree(old);   // a player still reading the old file keeps it until it closes it
            List<Profile> using = profilesFor(id);
            Profile current = activeProfile();
            if (using.isEmpty()) {
                result = addProfile(id, 1f);
            } else {
                result = current != null && current.look.equals(id) ? current : using.get(0);
                if (activate) active = result.id;
                save();   // the file changed: playing wallpapers reload it
            }
        }
        Log.i(TAG, "installed look " + id + " (" + orientation + ")");
        return result;
    }

    /**
     * Imports the packs the SDK pushed to the external files dir's import/&lt;id&gt;/ (FORMAT.md), then removes them.
     * Returns a line per pack for the user.
     */
    private final Object importing = new Object();

    List<String> importPacks() {
        synchronized (importing) { return importPacksLocked(); }   // one import at a time (onResume can come twice)
    }

    private List<String> importPacksLocked() {
        List<String> report = new ArrayList<>();
        File dir = app.getExternalFilesDir("import");
        File[] packs = dir != null ? dir.listFiles(File::isDirectory) : null;
        if (packs == null) return report;
        String want = deviceOrientation(app);
        for (File pack : packs) {
            try {
                JSONObject scene = new JSONObject(readText(new File(pack, "scene.json")));
                if (!scene.has("id")) scene.put("id", pack.getName());
                JSONObject videos = scene.getJSONObject("videos");
                String o = null;
                for (String c : new String[]{want, want.equals("portrait") ? "landscape" : "portrait"}) {
                    JSONObject e = videos.optJSONObject(c);
                    if (e != null && new File(pack, e.optString("file", c + ".mp4")).isFile()) { o = c; break; }
                }
                if (o == null) throw new IOException("no video in the pack");
                JSONObject e = videos.getJSONObject(o);
                File video = new File(pack, e.optString("file", o + ".mp4"));
                String sha = e.optString("sha256", "");
                if (!sha.isEmpty() && !sha.equalsIgnoreCase(sha256(video))) throw new IOException(o + " video: sha256 mismatch");
                // copy to internal storage first: the import folder is on another file system
                File stage = new File(app.getCacheDir(), "import");
                deleteTree(stage);
                stage.mkdirs();
                File v = new File(stage, o + ".mp4");
                copy(video, v);
                File poster = new File(pack, "poster.jpg"), p = null;
                if (poster.isFile()) copy(poster, p = new File(stage, "poster.jpg"));
                install(scene, o, v, p, false);
                deleteTree(stage);
                report.add("Imported " + scene.optString("title", pack.getName()));
            } catch (IOException | JSONException e) {
                Log.e(TAG, "import of " + pack + " failed", e);
                String why = e.getMessage();
                if (why != null && why.contains("EACCES")) {
                    // adb push leaves the files owned by the shell user: the SDK has to open them up
                    why = "can't read the pushed files (after adb push, run: adb shell chmod -R a+rwX " + pack + ")";
                }
                report.add("Couldn't import " + pack.getName() + ": " + why);
            }
            deleteTree(pack);
        }
        return report;
    }

    // ---- files

    static String readText(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    static void writeText(File f, String s) throws IOException {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(s.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
        if (!tmp.renameTo(f)) throw new IOException("can't write " + f);
    }

    static void move(File from, File to) throws IOException {
        if (from.renameTo(to)) return;
        copy(from, to);
        from.delete();
    }

    static void copy(File from, File to) throws IOException {
        try (InputStream in = new FileInputStream(from); OutputStream out = new FileOutputStream(to)) {
            in.transferTo(out);
        }
    }

    static String sha256(File f) throws IOException {
        MessageDigest md = sha256();
        byte[] buf = new byte[1 << 16];
        try (InputStream in = new FileInputStream(f)) {
            for (int n; (n = in.read(buf)) > 0; ) md.update(buf, 0, n);
        }
        return hex(md.digest());
    }

    static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }

    static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    static long treeBytes(File f) {
        if (f.isFile()) return f.length();
        long n = 0;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) n += treeBytes(k);
        return n;
    }

    static float clamp01(float v) { return Math.max(0f, Math.min(1f, v)); }
}
