package com.designsos.livescenes;

import android.app.WallpaperColors;
import android.app.WallpaperInfo;
import android.app.WallpaperManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.database.ContentObserver;
import android.graphics.Bitmap;
import android.os.BatteryManager;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.service.wallpaper.WallpaperService;
import android.util.Log;
import android.view.Surface;
import android.view.SurfaceHolder;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * Live Scenes for Android: plays the active profile's look, a seamlessly looping video (sdk/FORMAT.md),
 * as the live wallpaper. Without a profile it plays the look bundled in the APK.
 * Decoding is in hardware straight to the wallpaper's surface (see {@link VideoLoop}); hidden = paused.
 * On low battery (below the level set in the app, and not charging) nothing plays: the player is released and
 * one frame of the look is drawn as a still image, so no decoder, thread or GL is left running.
 * The system theme gets the look's own theme (see {@link Theme}), or the poster's colors.
 */
public class LiveWallpaperService extends WallpaperService {
    static final String TAG = "LiveScenes";

    @Override
    public Engine onCreateEngine() { return new VideoEngine(); }

    // ---- developer option: keep the screen on while wireless debugging is on.
    // A screen wake lock only stops the timeout: the power button still turns the screen off, and
    // the lock does nothing while the screen is off. (Plugged in, Android's own "Stay awake" does this.)

    static final String ADB_WIFI = "adb_wifi_enabled";
    Prefs prefs;
    PowerManager.WakeLock awakeLock;
    final ContentObserver adbWifiObserver = new ContentObserver(new Handler(Looper.getMainLooper())) {
        @Override public void onChange(boolean self) { updateAwake(); }
    };
    final SharedPreferences.OnSharedPreferenceChangeListener prefListener = (sp, key) -> {
        if (Prefs.DEV_AWAKE.equals(key)) updateAwake();
        else if (Prefs.FREEZE_BELOW.equals(key)) updateFrozen();
        else if (Prefs.MATCH_THEME.equals(key) || Prefs.THEME_NOW.equals(key)) themeChanged();
    };

    // ---- low battery: a still frame instead of the video

    final List<VideoEngine> engines = new ArrayList<>();
    int batteryPct = 100;
    boolean charging, frozen;
    final BroadcastReceiver batteryReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { readBattery(i); }
    };

    void readBattery(Intent i) {
        if (i == null) return;
        int level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
        if (level < 0 || scale <= 0) return;
        batteryPct = level * 100 / scale;
        charging = i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0;
        updateFrozen();
    }

    /** The theme options changed: every engine gives the system its colors again. */
    void themeChanged() { for (VideoEngine e : engines) e.themeChanged(); }

    void updateFrozen() {
        int below = prefs.freezeBelow();
        boolean f = below > 0 && !charging && batteryPct < below;
        if (f == frozen) return;
        frozen = f;
        Log.i(TAG, f ? "battery " + batteryPct + "% < " + below + "%: still frame" : "battery " + batteryPct + "%"
                + (charging ? ", charging" : "") + ": playing");
        for (VideoEngine e : engines) e.restart();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        prefs = new Prefs(this);
        prefs.p.registerOnSharedPreferenceChangeListener(prefListener);
        getContentResolver().registerContentObserver(Settings.Global.getUriFor(ADB_WIFI), false, adbWifiObserver);
        updateAwake();
        readBattery(registerReceiver(batteryReceiver, new IntentFilter(Intent.ACTION_BATTERY_CHANGED)));   // sticky: the current state
    }

    @Override
    public void onDestroy() {
        // another wallpaper was set: the theme setting goes back to the user's (not on a mere rebind)
        if (!isWallpaper(this)) Theme.restore(this, prefs);
        unregisterReceiver(batteryReceiver);
        getContentResolver().unregisterContentObserver(adbWifiObserver);
        prefs.p.unregisterOnSharedPreferenceChangeListener(prefListener);
        if (awakeLock != null && awakeLock.isHeld()) awakeLock.release();
        super.onDestroy();
    }

    /** Whether Live Scenes is the (home screen's) wallpaper. */
    static boolean isWallpaper(Context c) {
        WallpaperInfo info = WallpaperManager.getInstance(c).getWallpaperInfo();
        return info != null && c.getPackageName().equals(info.getPackageName());
    }

    static boolean wirelessDebugging(Context c) {
        try {
            return Settings.Global.getInt(c.getContentResolver(), ADB_WIFI, 0) == 1;
        } catch (SecurityException e) {
            Log.w(TAG, "can't read " + ADB_WIFI + ": " + e.getMessage());
            return false;
        }
    }

    @SuppressWarnings("deprecation")   // SCREEN_BRIGHT_WAKE_LOCK: a service has no window for FLAG_KEEP_SCREEN_ON
    void updateAwake() {
        boolean want = prefs.devAwake() && wirelessDebugging(this);
        if (awakeLock == null) {
            awakeLock = getSystemService(PowerManager.class)
                    .newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK, "LiveScenes:wireless-debugging");
            awakeLock.setReferenceCounted(false);
        }
        if (want && !awakeLock.isHeld()) { awakeLock.acquire(); Log.i(TAG, "screen kept on: wireless debugging"); }
        else if (!want && awakeLock.isHeld()) { awakeLock.release(); Log.i(TAG, "screen may time out again"); }
    }

    final class VideoEngine extends Engine {
        final Handler main = new Handler(Looper.getMainLooper());
        Store store;
        VideoLoop player;
        Store.Video video;
        int w, h;
        String colorsKey;      // the look and theme the colors are for
        WallpaperColors colors;
        Bitmap still;          // low battery: the frame on screen instead of the video
        int stillRequest;
        final Runnable onStore = this::update;

        @Override
        public void onCreate(SurfaceHolder holder) {
            super.onCreate(holder);
            setTouchEventsEnabled(false);
            setOffsetNotificationsEnabled(false);
            store = Store.get(LiveWallpaperService.this);
            store.addListener(onStore);
            engines.add(this);
        }

        @Override
        public void onDestroy() {
            engines.remove(this);
            store.removeListener(onStore);
            stop();
            super.onDestroy();
        }

        @Override
        public void onSurfaceChanged(SurfaceHolder holder, int format, int width, int height) {
            super.onSurfaceChanged(holder, format, width, height);
            if (width == w && height == h && player != null) return;
            w = width;
            h = height;
            start(playable());
        }

        /** What to play; the bundled look if anything about the saved one is off. */
        Store.Video playable() {
            try {
                return store.playable(w > h);
            } catch (RuntimeException e) {
                Log.e(TAG, "can't resolve the active look", e);
                return Store.bundledVideo(LiveWallpaperService.this);
            }
        }

        @Override
        public void onSurfaceRedrawNeeded(SurfaceHolder holder) {
            super.onSurfaceRedrawNeeded(holder);
            if (player != null) player.redraw();
            else if (still != null) drawStill(still);
        }

        @Override
        public void onSurfaceDestroyed(SurfaceHolder holder) {
            stop();
            w = h = 0;
            super.onSurfaceDestroyed(holder);
        }

        @Override
        public void onVisibilityChanged(boolean visible) {
            super.onVisibilityChanged(visible);
            updatePaused();
        }

        void updatePaused() { if (player != null) player.setPaused(!isVisible()); }

        /** Low battery started or ended: the same look, as a still or playing. */
        void restart() { if (w > 0 && h > 0) start(video != null ? video : playable()); }

        /** Profiles changed: another look restarts playback, a new speed just changes the clock. */
        void update() {
            if (w <= 0 || h <= 0) return;
            Store.Video v = playable();
            if (video != null && v.key().equals(video.key())) {
                if (v.speed != video.speed) {
                    video.speed = v.speed;
                    if (player != null) player.setSpeed(v.speed);
                    Log.i(TAG, "speed " + v.speed + "x");
                }
                if (!Objects.equals(v.themeJson, video.themeJson)) {   // the catalog brought a theme for it
                    video.theme = v.theme;
                    video.themeJson = v.themeJson;
                    updateColors();
                }
                return;
            }
            start(v);
        }

        void start(Store.Video v) {
            stop();
            if (w <= 0 || h <= 0 || !getSurfaceHolder().getSurface().isValid()) return;
            video = v;
            Log.i(TAG, "engine " + (isPreview() ? "(preview) " : "") + w + "x" + h + ": " + v.look
                    + (frozen ? " as a still (low battery)" : " at " + v.speed + "x"));
            if (frozen) showStill(v);
            else play(v, !isVisible());
            updateColors();
        }

        /** Tells the system about new colors if the look or its theme changed. */
        void updateColors() {
            String key = video.look + ":" + video.themeJson;
            if (key.equals(colorsKey)) return;
            colorsKey = key;
            themeChanged();
        }

        /** The colors to give the system changed (another look or theme, or the theme setting). */
        void themeChanged() {
            colors = null;
            notifyColorsChanged();
            if (!isPreview() && video != null) Theme.applyNow(LiveWallpaperService.this, video.theme);
        }

        void play(Store.Video v, boolean paused) {
            player = new VideoLoop(LiveWallpaperService.this, v, getSurfaceHolder().getSurface(), w, h,
                    paused, true, e -> main.post(() -> failed(v)));
        }

        /** Grabs the look's first frame off the main thread, then draws it once. */
        void showStill(Store.Video v) {
            int req = stillRequest;
            Ui.IO.execute(() -> {
                Bitmap b = Store.firstFrame(LiveWallpaperService.this, v);
                main.post(() -> {
                    if (req != stillRequest || video != v) return;   // stopped or replaced meanwhile
                    if (b != null && drawStill(b)) { still = b; return; }
                    Log.w(TAG, "no still for " + v.look + ": showing the paused video");
                    play(v, true);   // a paused player shows its first frame and then does nothing
                });
            });
        }

        /** Draws the still aspect-filled around the look's focus point, like the video (GL: leaves the surface free). */
        boolean drawStill(Bitmap b) {
            Surface s = getSurfaceHolder().getSurface();
            if (w <= 0 || h <= 0 || !s.isValid()) return false;
            try {
                GlCrop.drawStill(s, b, GlCrop.crop(b.getWidth(), b.getHeight(), w, h, video.focusX, video.focusY));
                return true;
            } catch (RuntimeException e) {
                Log.w(TAG, "can't draw the still", e);
                return false;
            }
        }

        void failed(Store.Video v) {
            if (video != v) return;
            stop();
            if (v.file != null) start(Store.bundledVideo(LiveWallpaperService.this));   // a broken saved file: play the bundled look
        }

        void stop() {
            if (player != null) { player.release(); player = null; }
            still = null;
            stillRequest++;
        }

        /**
         * Colors for the system theme: the look's own theme if it has one and the user wants it, else the poster's.
         * (Android applies new colors of a live wallpaper only at the next screen off, unless {@link Theme#applyNow}.)
         */
        @Override
        public WallpaperColors onComputeColors() {
            if (colors == null && video != null) {
                if (prefs.matchTheme() && video.theme != null) {
                    colors = video.theme.colors();
                } else {
                    Bitmap b = Store.posterBitmap(LiveWallpaperService.this, video, 256);
                    if (b != null) colors = WallpaperColors.fromBitmap(b);
                }
                Log.i(TAG, "colors for " + video.look + (prefs.matchTheme() && video.theme != null ? " (its theme)" : " (poster)")
                        + ": " + colors);
            }
            return colors;
        }
    }
}
