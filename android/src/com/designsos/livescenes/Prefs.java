package com.designsos.livescenes;

import android.content.Context;
import android.content.SharedPreferences;

/** App settings (profiles live in {@link Store}). */
final class Prefs {
    static final String CATALOG_URL = "catalogUrl", DEV_AWAKE = "devAwake";
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
}
