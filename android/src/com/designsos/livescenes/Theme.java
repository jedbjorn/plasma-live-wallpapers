package com.designsos.livescenes;

import android.Manifest;
import android.app.WallpaperColors;
import android.content.ContentResolver;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

/**
 * A look's Android theme (sdk/FORMAT.md, "theme"): hand-picked colors the system's Material You palette is made
 * from while the look plays. Android seeds the palette from the first color (WallpaperColors without populations
 * keep their order), so {@code primary} is the one that counts; the other two are offered in Wallpaper &amp; style.
 * <p>
 * Android applies a live wallpaper's new colors only the next time the screen turns off (SystemUI's
 * ThemeOverlayController accepts one color change per wallpaper set from an app, and defers the rest). With
 * WRITE_SECURE_SETTINGS (granted over adb) the theme can be applied at once instead, through the setting the
 * Wallpaper &amp; style app writes: its seed ({@code system_palette}) and, if the theme has one, its style.
 * The user's value is saved before the first write and put back when that option is turned off.
 */
final class Theme {
    static final String TAG = LiveWallpaperService.TAG;
    /** The Monet styles a theme may ask for (the names SystemUI reads from the setting). */
    static final List<String> STYLES = Arrays.asList("TONAL_SPOT", "VIBRANT", "EXPRESSIVE", "SPRITZ", "RAINBOW",
            "FRUIT_SALAD", "MONOCHROMATIC");

    final int primary;
    final Integer secondary, tertiary;
    final boolean dark;
    final String style;   // or null: the user's style is kept

    private Theme(int primary, Integer secondary, Integer tertiary, boolean dark, String style) {
        this.primary = primary;
        this.secondary = secondary;
        this.tertiary = tertiary;
        this.dark = dark;
        this.style = style;
    }

    /** The theme in a scene.json or catalog entry, or null if it has none (or a broken one). */
    static Theme of(JSONObject scene) {
        JSONObject t = scene != null ? scene.optJSONObject("theme") : null;
        Integer p = t != null ? color(t.optString("primary")) : null;
        if (p == null) return null;
        String style = t.optString("style", "").toUpperCase(Locale.ROOT);
        return new Theme(p, color(t.optString("secondary")), color(t.optString("tertiary")),
                t.optBoolean("dark", true), STYLES.contains(style) ? style : null);
    }

    static Integer color(String s) {
        if (s == null || !s.matches("#[0-9a-fA-F]{6}")) return null;
        return 0xff000000 | Integer.parseInt(s.substring(1), 16);
    }

    static String hex(int c) { return String.format("#%06X", c & 0xffffff); }

    /** For the system: our colors in order, and whether the look is dark (light text on it) or light. */
    WallpaperColors colors() {
        return new WallpaperColors(Color.valueOf(primary), secondary != null ? Color.valueOf(secondary) : null,
                tertiary != null ? Color.valueOf(tertiary) : null,
                dark ? WallpaperColors.HINT_SUPPORTS_DARK_THEME : WallpaperColors.HINT_SUPPORTS_DARK_TEXT);
    }

    // ---- applying at once (WRITE_SECURE_SETTINGS)

    static final String SETTING = "theme_customization_overlay_packages";
    static final String PALETTE = "android.theme.customization.system_palette",
            STYLE = "android.theme.customization.theme_style",
            SOURCE = "android.theme.customization.color_source";

    static boolean canApplyNow(Context c) {
        return c.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * Makes the system theme follow {@code t} at once if the user asked for that (and the permission is granted),
     * else puts the user's setting back if we changed it. {@code t} null: a look without a theme, which goes back
     * to the user's seed and style (Android then uses the poster's colors, at the next screen off).
     */
    static synchronized void applyNow(Context c, Theme t) {
        Prefs prefs = new Prefs(c);
        if (!prefs.matchTheme() || !prefs.themeNow() || !canApplyNow(c)) { restore(c, prefs); return; }
        ContentResolver r = c.getContentResolver();
        try {
            String cur = Settings.Secure.getString(r, SETTING);
            String orig = prefs.p.getString(Prefs.THEME_ORIGINAL, null);
            if (orig == null) {
                orig = cur != null ? cur : "";
                prefs.p.edit().putString(Prefs.THEME_ORIGINAL, orig).commit();
                Log.i(TAG, "saved the theme setting before changing it: " + orig);
            }
            JSONObject o = json(cur), before = json(orig);
            if ("preset".equals(o.optString(SOURCE))) {   // the user picked fixed colors in Wallpaper & style
                Log.i(TAG, "the system theme uses preset colors: not changing it");
                return;
            }
            put(o, PALETTE, t != null ? hex(t.primary) : before.optString(PALETTE, null));
            put(o, STYLE, t != null && t.style != null ? t.style : before.optString(STYLE, null));
            String next = o.toString();
            if (next.equals(json(cur).toString())) return;
            Settings.Secure.putString(r, SETTING, next);
            prefs.p.edit().putString(Prefs.THEME_WRITTEN, next).commit();   // on disk now: restore() needs it after a process death
            Log.i(TAG, "theme applied at once: " + next);
        } catch (SecurityException e) {
            Log.w(TAG, "can't write the theme setting: " + e.getMessage());
        }
    }

    /**
     * Puts the setting back as it was before our first write. If something else changed it since (the user in
     * Wallpaper &amp; style, say), only our keys go back, so their change stays.
     */
    static synchronized void restore(Context c, Prefs prefs) {
        String orig = prefs.p.getString(Prefs.THEME_ORIGINAL, null);
        if (orig == null) return;
        if (!canApplyNow(c)) { Log.w(TAG, "can't restore the theme setting: no permission"); return; }
        ContentResolver r = c.getContentResolver();
        try {
            String cur = Settings.Secure.getString(r, SETTING);
            String written = prefs.p.getString(Prefs.THEME_WRITTEN, null);
            String next;
            if (cur == null || cur.equals(written)) {
                next = orig.isEmpty() ? null : orig;
            } else {
                JSONObject o = json(cur), w = json(written), b = json(orig);
                for (String k : new String[]{PALETTE, STYLE}) {
                    if (Objects.equals(o.optString(k, null), w.optString(k, null))) put(o, k, b.optString(k, null));
                }
                next = o.toString();
            }
            if (!Objects.equals(next, cur)) Settings.Secure.putString(r, SETTING, next);
            prefs.p.edit().remove(Prefs.THEME_ORIGINAL).remove(Prefs.THEME_WRITTEN).commit();
            Log.i(TAG, "theme setting restored: " + next);
        } catch (SecurityException e) {
            Log.w(TAG, "can't restore the theme setting: " + e.getMessage());
        }
    }

    static JSONObject json(String s) {
        try {
            return s == null || s.isEmpty() ? new JSONObject() : new JSONObject(s);
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    static void put(JSONObject o, String k, String v) {
        try {
            if (v == null) o.remove(k);
            else o.put(k, v);
        } catch (JSONException ignored) {
            // a null key: not ours
        }
    }
}
