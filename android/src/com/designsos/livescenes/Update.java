package com.designsos.livescenes;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * In-app updates: the update manifest of the latest release (sdk/FORMAT.md) says which version it holds; a newer
 * APK is downloaded, checked, and handed to the system installer, which asks the user before installing it.
 */
final class Update {
    static final String MANIFEST =
            "https://github.com/jedbjorn/plasma-live-wallpapers/releases/latest/download/update.json";
    static final long DAY = 24 * 60 * 60 * 1000L;
    /** Broadcast (to this app only) with the installer's progress, see {@link #install}. */
    static final String ACTION_STATUS = "com.designsos.livescenes.UPDATE_STATUS";
    /** Another manifest, for testing; only debuggable builds take one (SettingsActivity). */
    static String testManifest;

    /** A release newer than this app. */
    static final class Info {
        String version, sha256, notes;
        long versionCode, bytes;
        URL apk;
    }

    static boolean debuggable(Context c) {
        return (c.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    static PackageInfo installed(Context c) {
        try {
            return c.getPackageManager().getPackageInfo(c.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
        } catch (PackageManager.NameNotFoundException e) {
            throw new IllegalStateException(e);
        }
    }

    static File dir(Context c) { return new File(c.getCacheDir(), "update"); }

    /**
     * The newer release, or null if there is none. The manifest is downloaded at most once a day unless
     * {@code force}; a failed download is not remembered, so the next check tries again.
     */
    static Info check(Context c, boolean force) throws IOException {
        Prefs prefs = new Prefs(c);
        if (testManifest != null) return parse(c, new URL(testManifest), fetch(new URL(testManifest)));
        long age = System.currentTimeMillis() - prefs.p.getLong(Prefs.UPDATE_CHECKED, 0);
        String text = prefs.p.getString(Prefs.UPDATE_MANIFEST, null);
        if (force || text == null || age < 0 || age > DAY) {
            text = fetch(new URL(MANIFEST));
            prefs.p.edit().putLong(Prefs.UPDATE_CHECKED, System.currentTimeMillis())
                    .putString(Prefs.UPDATE_MANIFEST, text).apply();
        }
        return parse(c, new URL(MANIFEST), text);
    }

    static String fetch(URL url) throws IOException {
        return new String(Catalog.get(url), StandardCharsets.UTF_8);
    }

    static Info parse(Context c, URL base, String text) throws IOException {
        try {
            JSONObject o = new JSONObject(text), a = o.optJSONObject("android");
            if (a == null) return null;                                   // a release without an Android app
            Info i = new Info();
            i.version = o.optString("version");
            i.notes = o.optString("notes");
            i.versionCode = a.optLong("versionCode");
            i.bytes = a.optLong("bytes");
            i.sha256 = a.optString("sha256");
            i.apk = new URL(base, a.optString("url"));
            if (i.versionCode <= installed(c).getLongVersionCode()) return null;
            if (i.version.isEmpty() || !i.sha256.matches("[0-9a-f]{64}") || i.bytes <= 0)
                throw new IOException("the update manifest is incomplete");
            if (!debuggable(c) && !"https".equals(i.apk.getProtocol()))
                throw new IOException("the update is not served over https");
            return i;
        } catch (JSONException e) {
            throw new IOException("not an update manifest: " + e.getMessage());
        }
    }

    /** Downloads the release's APK into the cache folder (cleared at the next process start) and checks its sha256. */
    static File download(Context c, Info i, Catalog.Progress progress, java.util.function.BooleanSupplier cancelled) throws IOException {
        File apk = new File(dir(c), "LiveScenes.apk");
        Store.deleteTree(dir(c));
        dir(c).mkdirs();
        Catalog.download(i.apk, apk, i.sha256, progress, cancelled);
        return apk;
    }

    /** Why Android would refuse this APK as an update of the installed app, or null if it shouldn't. */
    static String problem(Context c, File apk) {
        PackageInfo now = installed(c);
        PackageInfo next = c.getPackageManager().getPackageArchiveInfo(apk.getPath(), PackageManager.GET_SIGNING_CERTIFICATES);
        if (next == null || !c.getPackageName().equals(next.packageName)) return "The download is not Live Scenes.";
        if (next.getLongVersionCode() <= now.getLongVersionCode()) return "The download is not newer than this version.";
        // (if the signers can't be read, or the key was rotated, the system installer decides)
        if (now.signingInfo != null && next.signingInfo != null && !next.signingInfo.hasPastSigningCertificates()
                && !Arrays.equals(now.signingInfo.getApkContentsSigners(), next.signingInfo.getApkContentsSigners()))
            return "The release is signed with a different key than this copy of the app (one built from the source, "
                    + "for example), so Android won't install it over this one. To switch, uninstall Live Scenes and "
                    + "install the release; saved looks go with the uninstall.";
        return null;
    }

    /**
     * Hands the APK to the system installer. Its answers arrive as {@link #ACTION_STATUS} broadcasts: first
     * STATUS_PENDING_USER_ACTION with the confirmation screen to show, then a failure, or nothing: a successful
     * install replaces this process.
     */
    static void install(Context c, File apk) throws IOException {
        PackageInstaller installer = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(c.getPackageName());
        params.setSize(apk.length());
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("LiveScenes.apk", 0, apk.length())) {
                byte[] buf = new byte[1 << 16];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                session.fsync(out);
            }
            // the system adds its extras, so the PendingIntent is mutable; it stays inside this app
            Intent status = new Intent(ACTION_STATUS).setPackage(c.getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            session.commit(PendingIntent.getBroadcast(c, id, status, flags).getIntentSender());
        } catch (IOException | RuntimeException e) {
            try { installer.abandonSession(id); } catch (RuntimeException ignored) { }
            throw new IOException("can't hand the update to Android: " + e.getMessage());
        }
    }
}
