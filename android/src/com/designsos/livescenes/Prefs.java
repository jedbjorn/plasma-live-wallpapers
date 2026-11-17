package com.designsos.livescenes;

import android.content.Context;
import android.content.SharedPreferences;

/** App settings (profiles live in {@link Store}). */
final class Prefs {
    static final String CATALOG_URL = "catalogUrl", DEV_AWAKE = "devAwake", FREEZE_BELOW = "freezeBelow";
    /** The last update check: when (ms), and the manifest it got (see {@link Update}). */
    static final String UPDATE_CHECKED = "updateChecked", UPDATE_MANIFEST = "updateManifest";
    /** Battery levels (%) the wallpaper can freeze below; 0 = never. */
    static final int[] FREEZE_LEVELS = {0, 20, 30, 50};
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

    /** Below this battery level (%), unless charging, the wallpaper stops on a still frame; 0 = never. */
    int freezeBelow() { return p.getInt(FREEZE_BELOW, DEFAULT_FREEZE_BELOW); }
}
