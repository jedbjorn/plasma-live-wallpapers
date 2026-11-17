package com.designsos.livescenes;

import android.app.Application;
import android.content.SharedPreferences;
import android.util.Log;

import java.io.File;

/**
 * Process start: clears previews and level downloads left over from an earlier run (sdk/FORMAT.md), the APK of an update
 * (installed or abandoned by now), and settings of the old WebView version.
 */
public class App extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        // nothing can be previewing yet: a PreviewActivity only exists in a running process
        File preview = new File(getCacheDir(), "preview");
        long n = Store.treeBytes(preview);
        Store.deleteTree(preview);
        if (n > 0) Log.i(LiveWallpaperService.TAG, "cleared " + n + " bytes of old previews");
        Store.deleteTree(Update.dir(this));
        Store.deleteTree(new File(getCacheDir(), "level"));   // a level download cut short

        SharedPreferences p = new Prefs(this).p;
        if (p.contains("scene") || p.contains("fps")) {
            SharedPreferences.Editor e = p.edit();
            for (String k : new String[]{"scene", "fps", "scale", "mode", "loop", "shots", "swim"}) e.remove(k);
            e.apply();
        }
    }
}
