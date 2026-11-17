package com.designsos.livescenes;

import android.content.Context;
import android.content.SharedPreferences;

/** App settings (profiles live in {@link Store}). */
final class Prefs {
    static final String CATALOG_URL = "catalogUrl", DEV_AWAKE = "devAwake", FREEZE_BELOW = "freezeBelow";
    /** The phone's theme follows the playing look's; and applied at once (needs WRITE_SECURE_SETTINGS, see {@link Theme}). */
    static final String MATCH_THEME = "matchTheme", THEME_NOW = "themeNow";
    /** The system theme setting before our first write, and what we last wrote (see {@link Theme#restore}). */
    static final String THEME_ORIGINAL = "themeOriginal", THEME_WRITTEN = "themeWritten";
    /** The last update check: when (ms), and the manifest it got (see {@link Update}). */
    static final String UPDATE_CHECKED = "updateChecked", UPDATE_MANIFEST = "updateManifest";
    /** Battery levels (%) the wallpaper can freeze below: one of these, always. */
    static final int[] FREEZE_LEVELS = {25, 50, 75};
    static final int DEFAULT_FREEZE_BELOW = 50;
    static final String DEFAULT_CATALOG =
            "https://github.com/jedbjorn/plasma-live-wallpapers/releases/latest/download/catalog.json";

    final SharedPreferences p;

    Prefs(Context c) { p = c.getSharedPreferences("settings", Context.MODE_PRIVATE); }

    /** The catalog to browse: the official one unless overridden (Advanced). */
    String catalogUrl() {
        String u = p.getString(CATALOG_URL, "");
        return u.isEmpty() ? DEFAULT_CATALOG : u;
    }

    /** Developer option: keep the screen from timing out while wireless debugging is on. */
    boolean devAwake() { return p.getBoolean(DEV_AWAKE, false); }

    /** Match the phone's theme to the look: its hand-made theme instead of the poster's colors. */
    boolean matchTheme() { return p.getBoolean(MATCH_THEME, true); }

    /** Apply the look's theme at once through the system setting (only works with WRITE_SECURE_SETTINGS). */
    boolean themeNow() { return p.getBoolean(THEME_NOW, false); }

    /**
     * Below this battery level (%), unless charging, the wallpaper stops on a still frame. A level saved by an
     * older version that is no longer offered (0 = never, 20, 30) reads as the nearest one offered.
     */
    int freezeBelow() {
        int v = p.getInt(FREEZE_BELOW, DEFAULT_FREEZE_BELOW), best = FREEZE_LEVELS[0];
        for (int l : FREEZE_LEVELS) if (Math.abs(l - v) < Math.abs(best - v)) best = l;
        return best;
    }
}
