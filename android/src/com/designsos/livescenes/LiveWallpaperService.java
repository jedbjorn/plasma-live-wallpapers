package com.designsos.livescenes;

import android.app.WallpaperColors;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.ContentObserver;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.service.wallpaper.WallpaperService;
import android.util.Log;
import android.view.SurfaceHolder;

/**
 * Live Scenes for Android: plays the active profile's look, a seamlessly looping video (sdk/FORMAT.md),
 * as the live wallpaper. Without a profile it plays the look bundled in the APK.
 * Decoding is in hardware straight to the wallpaper's surface (see {@link VideoLoop}); hidden = paused.
 */
public class LiveWallpaperService extends WallpaperService {
    static final String TAG = "LiveScenes";

    @Override
    public Engine onCreateEngine() { return new VideoEngine(); }

    // ---- developer option: keep the screen on while wireless debugging is on.
    // A screen wake lock only stops the timeout: the power button still turns the screen off, and
    // the lock does nothing while the screen is off. (Plugged in, Android's own "Stay awake" does this.)

    static final String ADB_WIFI = "adb_wifi_enabled";
    Prefs awakePrefs;
    PowerManager.WakeLock awakeLock;
    final ContentObserver adbWifiObserver = new ContentObserver(new Handler(Looper.getMainLooper())) {
        @Override public void onChange(boolean self) { updateAwake(); }
    };
    final SharedPreferences.OnSharedPreferenceChangeListener awakePrefListener = (sp, key) -> {
        if (Prefs.DEV_AWAKE.equals(key)) updateAwake();
    };

    @Override
    public void onCreate() {
        super.onCreate();
        awakePrefs = new Prefs(this);
        awakePrefs.p.registerOnSharedPreferenceChangeListener(awakePrefListener);
        getContentResolver().registerContentObserver(Settings.Global.getUriFor(ADB_WIFI), false, adbWifiObserver);
        updateAwake();
    }

    @Override
    public void onDestroy() {
        getContentResolver().unregisterContentObserver(adbWifiObserver);
        awakePrefs.p.unregisterOnSharedPreferenceChangeListener(awakePrefListener);
        if (awakeLock != null && awakeLock.isHeld()) awakeLock.release();
        super.onDestroy();
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
        boolean want = awakePrefs.devAwake() && wirelessDebugging(this);
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
        String colorsLook;
        WallpaperColors colors;
        final Runnable onStore = this::update;

        @Override
        public void onCreate(SurfaceHolder holder) {
            super.onCreate(holder);
            setTouchEventsEnabled(false);
            setOffsetNotificationsEnabled(false);
            store = Store.get(LiveWallpaperService.this);
            store.addListener(onStore);
        }

        @Override
        public void onDestroy() {
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
            if (player != null) player.setPaused(!visible);
        }

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
                return;
            }
            start(v);
        }

        void start(Store.Video v) {
            stop();
            if (w <= 0 || h <= 0 || !getSurfaceHolder().getSurface().isValid()) return;
            video = v;
            Log.i(TAG, "engine " + (isPreview() ? "(preview) " : "") + w + "x" + h + ": " + v.look + " at " + v.speed + "x");
            player = new VideoLoop(LiveWallpaperService.this, v, getSurfaceHolder().getSurface(), w, h,
                    !isVisible(), true, e -> main.post(() -> failed(v)));
            if (!v.look.equals(colorsLook)) {
                colorsLook = v.look;
                colors = null;
                notifyColorsChanged();
            }
        }

        void failed(Store.Video v) {
            if (video != v) return;
            stop();
            if (v.file != null) start(Store.bundledVideo(LiveWallpaperService.this));   // a broken saved file: play the bundled look
        }

        void stop() {
            if (player != null) { player.release(); player = null; }
        }

        /** Colors for the system theme, from the look's poster. */
        @Override
        public WallpaperColors onComputeColors() {
            if (colors == null && video != null) {
                Bitmap b = Store.posterBitmap(LiveWallpaperService.this, video, 256);
                if (b != null) colors = WallpaperColors.fromBitmap(b);
            }
            return colors;
        }
    }
}
