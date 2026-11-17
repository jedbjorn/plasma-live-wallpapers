package com.designsos.livescenes;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.URL;

import static com.designsos.livescenes.Ui.dp;

/**
 * Preview of a catalog look: downloads the one video this device needs into the cache folder (checking its
 * sha256), plays it full screen, and either saves it as a profile or discards it. Leaving without saving
 * deletes the download. For a look that is already saved (the catalog has a newer video), saving updates it:
 * its files are replaced for all its profiles and no profile is added.
 */
public class PreviewActivity extends Activity implements TextureView.SurfaceTextureListener {
    static final String EXTRA_ENTRY = "entry", EXTRA_ORIENTATION = "orientation", EXTRA_VIDEO = "video", EXTRA_POSTER = "poster";

    JSONObject entry;
    String orientation, id, title;
    URL videoUrl, posterUrl;
    File dir, file;
    volatile boolean cancelled;
    boolean downloaded, saved, saving, update;
    Surface surface;
    int sw, sh;
    VideoLoop player;
    TextView status;
    ProgressBar bar;
    Button save, discard;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            entry = new JSONObject(getIntent().getStringExtra(EXTRA_ENTRY));
            orientation = getIntent().getStringExtra(EXTRA_ORIENTATION);
            videoUrl = new URL(getIntent().getStringExtra(EXTRA_VIDEO));
            String p = getIntent().getStringExtra(EXTRA_POSTER);
            posterUrl = p != null ? new URL(p) : null;
        } catch (JSONException | IOException | NullPointerException e) {
            finish();
            return;
        }
        id = entry.optString("id");
        title = entry.optString("title", id);
        dir = new File(getCacheDir(), "preview");
        dir.mkdirs();
        file = new File(dir, id + "-" + orientation + ".mp4");
        update = Store.get(this).isSaved(id);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        ImageView poster = new ImageView(this);
        poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
        if (posterUrl != null) Ui.poster(this, poster, posterUrl, null, 1024);
        root.addView(poster, new FrameLayout.LayoutParams(-1, -1));
        TextureView tv = new TextureView(this);
        tv.setOpaque(false);   // the poster shows through until the first frame
        tv.setSurfaceTextureListener(this);
        root.addView(tv, new FrameLayout.LayoutParams(-1, -1));

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackground(new GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, new int[]{0xcc000000, 0x00000000}));
        int pad = dp(this, 20);
        panel.setPadding(pad, dp(this, 48), pad, pad);
        TextView t = Ui.bold(this, title, 24);
        t.setTextColor(Color.WHITE);
        panel.addView(t);
        status = Ui.text(this, "", 14);
        status.setTextColor(0xddffffff);
        panel.addView(status, Ui.wide(dp(this, 4)));
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(1000);
        panel.addView(bar, Ui.wide(dp(this, 8)));
        LinearLayout buttons = new LinearLayout(this);
        buttons.setGravity(Gravity.END);
        discard = new Button(this);
        discard.setText("Discard");
        discard.setOnClickListener(v -> finish());
        save = new Button(this);
        save.setText(update ? "Update" : "Save as profile");
        save.setEnabled(false);
        save.setOnClickListener(v -> save());
        buttons.addView(discard);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = dp(this, 12);
        buttons.addView(save, lp);
        panel.addView(buttons, Ui.wide(dp(this, 12)));
        root.addView(panel, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
        panel.setOnApplyWindowInsetsListener((v, in) -> {
            v.setPadding(pad + in.getSystemWindowInsetLeft(), dp(this, 48), pad + in.getSystemWindowInsetRight(),
                    pad + in.getSystemWindowInsetBottom());
            return in;
        });
        setContentView(root);
        download();
    }

    void download() {
        long bytes = entry.optJSONObject("videos").optJSONObject(orientation).optLong("bytes");
        String sha = entry.optJSONObject("videos").optJSONObject(orientation).optString("sha256", "");
        status.setText("Downloading " + Ui.size(this, bytes) + "…");
        Ui.NET.execute(() -> {
            try {
                Catalog.download(videoUrl, file, sha, (done, total) -> runOnUiThread(() -> {
                    long all = total > 0 ? total : bytes;
                    if (all > 0) bar.setProgress((int) (done * 1000 / all));
                    status.setText("Downloading " + Ui.size(this, done) + " of " + Ui.size(this, all) + "…");
                }), () -> cancelled);
                runOnUiThread(() -> {
                    if (isDestroyed()) { file.delete(); return; }
                    downloaded = true;
                    bar.setVisibility(View.GONE);
                    status.setText(SettingsActivity.cap(orientation) + " video · " + Ui.size(this, file.length())
                            + (sha.isEmpty() ? "" : " · verified")
                            + (update ? "\nSaved already: Update replaces the saved video, no new profile." : ""));
                    save.setEnabled(true);
                    play();
                });
            } catch (InterruptedIOException e) {
                file.delete();
            } catch (IOException e) {
                runOnUiThread(() -> {
                    bar.setVisibility(View.GONE);
                    status.setText("Download failed: " + e.getMessage());
                });
            }
        });
    }

    void play() {
        if (!downloaded || surface == null || player != null || isDestroyed()) return;
        JSONObject e = entry.optJSONObject("videos").optJSONObject(orientation);
        Store.Video v = new Store.Video();
        v.look = id;
        v.title = title;
        v.orientation = orientation;
        v.file = file;
        v.width = e.optInt("width");
        v.height = e.optInt("height");
        JSONArray f = e.optJSONArray("focus");
        if (f != null && f.length() == 2) { v.focusX = (float) f.optDouble(0, .5); v.focusY = (float) f.optDouble(1, .5); }
        player = new VideoLoop(this, v, surface, sw, sh, isPaused, false,
                err -> runOnUiThread(() -> status.setText("Can't play this video: " + err.getMessage())));
    }

    void stopPlayer() {
        if (player != null) { player.release(); player = null; }
    }

    void save() {
        if (saving) return;
        saving = true;
        save.setEnabled(false);
        discard.setEnabled(false);
        status.setText(update ? "Updating…" : "Saving…");
        Ui.IO.execute(() -> {
            try {
                File poster = null;
                if (posterUrl != null) {
                    poster = new File(dir, id + "-poster.jpg");
                    Store.copy(Ui.cachedPoster(this, posterUrl), poster);
                }
                JSONObject scene = new JSONObject(entry.toString());
                if (!scene.has("format")) scene.put("format", 1);
                // a look saved already (here or meanwhile) is updated and keeps its profiles: never a duplicate.
                // An update only replaces the video; it doesn't change which profile is the wallpaper.
                boolean was = Store.get(this).isSaved(id);
                Store.Profile p = Store.get(this).install(scene, orientation, file, poster, !was);
                runOnUiThread(() -> {
                    saved = true;
                    Toast.makeText(this, was ? "Updated " + title
                            : "Saved “" + p.name + "”, the active profile now", Toast.LENGTH_LONG).show();
                    finish();
                });
            } catch (IOException | JSONException e) {
                runOnUiThread(() -> {
                    saving = false;
                    save.setEnabled(true);
                    discard.setEnabled(true);
                    status.setText("Couldn't save: " + e.getMessage());
                });
            }
        });
    }

    boolean isPaused;

    @Override
    protected void onPause() {
        super.onPause();
        isPaused = true;
        if (player != null) player.setPaused(true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        isPaused = false;
        if (player != null) player.setPaused(false);
    }

    @Override
    protected void onDestroy() {
        cancelled = true;
        stopPlayer();
        if (!saved && file != null) {
            // leaving without saving: nothing of the preview stays on disk
            long n = file.length();
            boolean gone = file.delete() | !file.exists();
            new File(dir, id + "-poster.jpg").delete();
            android.util.Log.i(LiveWallpaperService.TAG, "preview of " + id + " discarded: " + file.getName()
                    + " (" + n + " bytes) " + (gone ? "deleted" : "NOT deleted") + "; preview cache now "
                    + Store.treeBytes(dir) + " bytes");
        }
        super.onDestroy();
    }

    // ---- the TextureView

    @Override
    public void onSurfaceTextureAvailable(SurfaceTexture st, int w, int h) {
        surface = new Surface(st);
        sw = w;
        sh = h;
        play();
    }

    @Override
    public void onSurfaceTextureSizeChanged(SurfaceTexture st, int w, int h) {
        sw = w;
        sh = h;
        stopPlayer();
        play();
    }

    @Override
    public boolean onSurfaceTextureDestroyed(SurfaceTexture st) {
        stopPlayer();
        if (surface != null) { surface.release(); surface = null; }
        return true;
    }

    @Override
    public void onSurfaceTextureUpdated(SurfaceTexture st) {}
}
