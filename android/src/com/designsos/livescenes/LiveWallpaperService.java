package com.designsos.livescenes;

import android.app.Presentation;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.ContentObserver;
import android.graphics.Point;
import android.graphics.drawable.ColorDrawable;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.service.wallpaper.WallpaperService;
import android.util.Log;
import android.view.Display;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Live Scenes for Android: runs the scene pages from package/contents/web as the live wallpaper.
 *
 * A wallpaper engine only gets a Surface, not a place for views. So each engine makes a private
 * VirtualDisplay that draws into the wallpaper's surface and shows a WebView on it in a Presentation.
 * The render resolution applies to every scene: the page renders fewer pixels at the same CSS size,
 * and the result is scaled up to the screen (see build()).
 *
 * The pages are served from the APK's assets at https://appassets.androidplatform.net/web/...
 * Every other request is refused, and the app has no INTERNET permission.
 */
public class LiveWallpaperService extends WallpaperService {
    static final String TAG = "LiveScenes";
    static final String HOST = "appassets.androidplatform.net";
    static final int BG = 0xff050608;

    @Override
    public Engine onCreateEngine() { return new SceneEngine(); }

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

    final class SceneEngine extends Engine implements SharedPreferences.OnSharedPreferenceChangeListener {
        final Handler main = new Handler(Looper.getMainLooper());
        Prefs prefs;
        DisplayManager dm;
        VirtualDisplay vd;
        Presentation pres;
        WebView web;
        String loaded;
        int winW, winH;                 // the wallpaper surface: always the window's full size
        int builtW, builtH;             // the virtual display: the surface scaled by the render resolution
        int crashes;

        @Override
        public void onCreate(SurfaceHolder holder) {
            super.onCreate(holder);
            setTouchEventsEnabled(false);
            setOffsetNotificationsEnabled(false);
            prefs = new Prefs(LiveWallpaperService.this);
            prefs.p.registerOnSharedPreferenceChangeListener(this);
            dm = getSystemService(DisplayManager.class);
        }

        @Override
        public void onDestroy() {
            prefs.p.unregisterOnSharedPreferenceChangeListener(this);
            main.removeCallbacksAndMessages(null);
            teardown();
            super.onDestroy();
        }

        // ---- surface

        @Override
        public void onSurfaceChanged(SurfaceHolder holder, int format, int w, int h) {
            super.onSurfaceChanged(holder, format, w, h);
            winW = w; winH = h;
            build();
        }

        @Override
        public void onSurfaceDestroyed(SurfaceHolder holder) {
            teardown();
            winW = winH = 0;
            super.onSurfaceDestroyed(holder);
        }

        // ---- the page

        /**
         * Render resolution: a wallpaper (unlike its preview) may not shrink its own surface, and the system
         * doesn't scale a smaller virtual display up to fill it. So the display is full size, the WebView is laid
         * out at the scaled size and stretched back up as a view: the page renders w x h pixels, and the GPU
         * scales that picture when it composites the view.
         */
        void build() {
            if (winW <= 0 || winH <= 0) return;
            float s = prefs.scale() / 100f;
            int w = Math.max(2, Math.round(winW * s)), h = Math.max(2, Math.round(winH * s));
            if (vd != null && builtW == w && builtH == h) return;
            teardown();
            Surface surface = getSurfaceHolder().getSurface();
            if (surface == null || !surface.isValid()) return;

            // density so the page keeps the full screen's CSS size: fewer device pixels per CSS pixel.
            // Measured against the real screen, so a small preview card shows the whole scene, shrunk.
            Point screen = new Point();
            dm.getDisplay(Display.DEFAULT_DISPLAY).getRealSize(screen);
            int fullW = (winW > winH) == (screen.x > screen.y) ? screen.x : screen.y;
            int dpi = Math.max(20, Math.round(getResources().getDisplayMetrics().densityDpi * (float) w / fullW));

            vd = dm.createVirtualDisplay("LiveScenes", winW, winH, dpi, surface, 0);
            if (vd == null) { Log.e(TAG, "no virtual display"); return; }
            builtW = w; builtH = h;

            pres = new Presentation(LiveWallpaperService.this, vd.getDisplay(),
                    android.R.style.Theme_Black_NoTitleBar_Fullscreen);
            pres.getWindow().setBackgroundDrawable(new ColorDrawable(BG));
            web = makeWebView(pres.getContext());
            FrameLayout box = new FrameLayout(pres.getContext());
            box.addView(web, new FrameLayout.LayoutParams(w, h));
            web.setPivotX(0);
            web.setPivotY(0);
            web.setScaleX((float) winW / w);
            web.setScaleY((float) winH / h);
            pres.setContentView(box);
            try {
                pres.show();
            } catch (WindowManager.InvalidDisplayException e) {
                Log.e(TAG, "can't show on the virtual display", e);
                teardown();
                return;
            }
            Log.i(TAG, "page " + w + "x" + h + " @" + dpi + "dpi on " + winW + "x" + winH
                    + (isPreview() ? " (preview)" : ""));
            load();
            if (!isVisible()) web.onPause();
        }

        void load() {
            if (web == null) return;
            String url = "https://" + HOST + "/web/" + prefs.scene() + "/index.html?" + prefs.query();
            if (url.equals(loaded)) return;
            loaded = url;
            Log.i(TAG, "load " + url);
            web.loadUrl(url);
        }

        void teardown() {
            if (pres != null) { pres.dismiss(); pres = null; }
            if (web != null) { web.destroy(); web = null; }
            if (vd != null) { vd.release(); vd = null; }
            loaded = null;
            builtW = builtH = 0;
        }

        @Override
        public void onVisibilityChanged(boolean visible) {
            super.onVisibilityChanged(visible);
            // a paused WebView reports the page hidden: the scenes stop their frame loop
            if (web != null) { if (visible) web.onResume(); else web.onPause(); }
        }

        @Override
        public void onSharedPreferenceChanged(SharedPreferences sp, String key) {
            if (Prefs.SCALE.equals(key)) build();   // a new display size
            else load();
        }

        WebView makeWebView(Context ctx) {
            WebView v = new WebView(ctx);
            v.setBackgroundColor(BG);
            v.setVerticalScrollBarEnabled(false);
            v.setHorizontalScrollBarEnabled(false);
            v.setOverScrollMode(View.OVER_SCROLL_NEVER);
            v.setFocusable(false);
            WebSettings s = v.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setAllowFileAccess(false);
            s.setAllowContentAccess(false);
            s.setGeolocationEnabled(false);
            s.setSupportZoom(false);
            v.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                    return serve(req.getUrl());
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                    return !HOST.equals(req.getUrl().getHost());
                }

                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    // returning true keeps the app alive; start the page over, slower each time it keeps dying
                    Log.w(TAG, "page renderer gone (crashed: " + detail.didCrash() + "), restarting");
                    if (view == web) {
                        teardown();
                        long delay = Math.min(60_000, 1000L << Math.min(6, crashes++));
                        main.postDelayed(() -> { if (vd == null) build(); }, delay);
                    }
                    return true;
                }
            });
            v.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onConsoleMessage(ConsoleMessage m) {
                    Log.i(TAG, "page: " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                    return true;
                }
            });
            return v;
        }
    }

    // ---- assets

    WebResourceResponse serve(Uri u) {
        String path = u.getPath();
        if ("https".equals(u.getScheme()) && HOST.equals(u.getHost())
                && path != null && path.startsWith("/web/") && !path.contains("..")) {
            try {
                InputStream in = getAssets().open(path.substring(1));
                String mime = mime(path);
                return new WebResourceResponse(mime, mime.startsWith("text/") ? "utf-8" : null, in);
            } catch (IOException e) {
                Log.w(TAG, "no asset " + path);
            }
        } else {
            Log.w(TAG, "refused " + u);
        }
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null,
                new ByteArrayInputStream(new byte[0]));
    }

    static String mime(String path) {
        String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
        switch (ext) {
            case "html": return "text/html";
            case "js": return "text/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "jpg": case "jpeg": return "image/jpeg";
            case "png": return "image/png";
            case "webp": return "image/webp";
            case "svg": return "image/svg+xml";
            case "woff2": return "font/woff2";
            case "webm": return "video/webm";
            case "mp4": return "video/mp4";
            default: return "application/octet-stream";
        }
    }
}
