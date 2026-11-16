package com.designsos.livescenes;

import android.content.Context;
import android.content.SharedPreferences;

/** The settings, shared by the wallpaper and the settings screen. Same names and query string as the other platforms. */
final class Prefs {
    static final String[] SCENES = {"hall", "smoke-signal", "living-water"};
    static final String[] TITLES = {"Hall", "Smoke Signal", "Living Water"};

    static final String SCENE = "scene", FPS = "fps", SCALE = "scale", MODE = "mode",
            LOOP = "loop", SHOTS = "shots", SWIM = "swim", DEV_AWAKE = "devAwake";

    // phones get a lighter default than the desktop (30 fps, 100 %): this is a battery
    static final int DEF_FPS = 20, DEF_SCALE = 50, DEF_LOOP = 84, DEF_SWIM = 100;

    final SharedPreferences p;

    Prefs(Context c) { p = c.getSharedPreferences("settings", Context.MODE_PRIVATE); }

    String scene() { return p.getString(SCENE, "hall"); }
    int fps() { return p.getInt(FPS, DEF_FPS); }
    /** Render resolution, % of the screen's. Applies to every scene (the WebView renders smaller and is scaled up). */
    int scale() { return p.getInt(SCALE, DEF_SCALE); }
    int mode() { return p.getInt(MODE, 0); }
    int loopSeconds() { return p.getInt(LOOP, DEF_LOOP); }
    boolean shots() { return p.getBoolean(SHOTS, true); }
    int swimSpeed() { return p.getInt(SWIM, DEF_SWIM); }
    /** Developer option: keep the screen from timing out while wireless debugging is on. */
    boolean devAwake() { return p.getBoolean(DEV_AWAKE, false); }

    /** The page's query string, as main.qml and LiveScenes.swift build it. */
    String query() {
        StringBuilder q = new StringBuilder("fps=").append(fps());
        switch (scene()) {
            case "hall":
                // scale=100: the resolution is already lowered for the whole surface; Hall still steps down on its own if late
                q.append("&mode=").append(mode() == 1 ? "clock" : "loop")
                 .append("&loop=").append(loopSeconds()).append("&scale=100");
                break;
            case "smoke-signal":
                if (!shots()) q.append("&shots=0");
                break;
            case "living-water":
                q.append("&speed=").append(swimSpeed() / 100.0);
                break;
        }
        return q.toString();
    }
}
