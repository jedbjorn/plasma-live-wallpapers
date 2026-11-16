package com.designsos.livescenes;

import android.app.Activity;
import android.content.Context;
import android.content.res.TypedArray;
import android.graphics.Bitmap;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.format.Formatter;
import android.util.Log;
import android.util.LruCache;
import android.util.TypedValue;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.File;
import java.io.IOException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Little helpers for the programmatic views, and a background pool for files and network. */
final class Ui {
    static final ExecutorService IO = Executors.newFixedThreadPool(3);
    static final LruCache<String, Bitmap> BITMAPS = new LruCache<String, Bitmap>(16 << 20) {
        @Override protected int sizeOf(String k, Bitmap b) { return b.getByteCount(); }
    };

    static int dp(Context c, float v) { return Math.round(v * c.getResources().getDisplayMetrics().density); }

    static TextView text(Context c, CharSequence s, float sp) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        return t;
    }

    static TextView bold(Context c, CharSequence s, float sp) {
        TextView t = text(c, s, sp);
        t.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        t.setTextColor(attrColor(c, android.R.attr.textColorPrimary));
        return t;
    }

    static Button flatButton(Context c, CharSequence s) {
        Button b = new Button(c, null, android.R.attr.borderlessButtonStyle);
        b.setText(s);
        b.setAllCaps(false);
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setPadding(dp(c, 10), 0, dp(c, 10), 0);
        return b;
    }

    static int attrColor(Context c, int attr) {
        TypedArray a = c.obtainStyledAttributes(new int[]{attr});
        int color = a.getColor(0, 0xff4488ff);
        a.recycle();
        return color;
    }

    static GradientDrawable card(Context c, boolean highlight) {
        GradientDrawable d = new GradientDrawable();
        d.setCornerRadius(dp(c, 14));
        int fg = attrColor(c, android.R.attr.textColorPrimary);
        d.setColor((fg & 0x00ffffff) | 0x10000000);
        if (highlight) d.setStroke(dp(c, 2), attrColor(c, android.R.attr.colorAccent));
        return d;
    }

    static LinearLayout.LayoutParams wide(int top) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = top;
        return lp;
    }

    static String size(Context c, long bytes) { return Formatter.formatShortFileSize(c, bytes); }

    // ---- posters

    static File posterCache(Context c, URL url) {
        byte[] h = Store.sha256().digest(url.toString().getBytes(StandardCharsets.UTF_8));
        return new File(new File(c.getCacheDir(), "posters"), Store.hex(h).substring(0, 20) + ".jpg");
    }

    static final java.util.Map<String, Object> LOCKS = new java.util.concurrent.ConcurrentHashMap<>();

    /** A catalog poster from the cache folder, downloaded once (several views may ask for one at the same time). */
    static File cachedPoster(Context c, URL url) throws IOException {
        File f = posterCache(c, url);
        synchronized (LOCKS.computeIfAbsent(f.getPath(), k -> new Object())) {
            if (!f.isFile()) {
                f.getParentFile().mkdirs();
                Catalog.download(url, f, null, null, () -> false);
            }
        }
        return f;
    }

    /** Shows a catalog poster (downloaded once into the cache folder) or a saved one. */
    static void poster(Activity a, ImageView iv, URL url, File file, int maxPx) {
        String key = (url != null ? url.toString() : file + ":" + (file != null ? file.lastModified() : 0)) + "@" + maxPx;
        iv.setTag(key);
        Bitmap cached = BITMAPS.get(key);
        if (cached != null) { iv.setImageBitmap(cached); return; }
        if (url == null && file == null) return;
        IO.execute(() -> {
            try {
                File f = file;
                if (f == null) f = cachedPoster(a, url);
                Bitmap b = Store.decodeSampled(Files.readAllBytes(f.toPath()), maxPx);
                if (b == null) return;
                BITMAPS.put(key, b);
                a.runOnUiThread(() -> { if (key.equals(iv.getTag())) iv.setImageBitmap(b); });
            } catch (IOException e) {
                Log.w(LiveWallpaperService.TAG, "poster " + key + ": " + e.getMessage());
            }
        });
    }
}
