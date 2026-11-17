package com.designsos.livescenes;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.WallpaperManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.util.List;

import static com.designsos.livescenes.Ui.dp;

/**
 * The app: saved profiles, the catalog, settings, and updates of the app itself. Also the wallpaper picker's
 * settings screen.
 * Changes apply to the running wallpaper at once (it listens to {@link Store}).
 */
public class SettingsActivity extends Activity {
    Prefs prefs;
    Store store;
    LinearLayout box, statusBox, updateBox, profilesBox, catalogBox, batteryBox, themeBox;
    TextView catalogStatus, updateNote;
    Update.Info update;          // a newer release, if the last check found one
    String updateStatus;         // what the update is doing, or why it failed
    boolean updating, gone;
    String orientation;
    List<Catalog.Entry> catalog;
    int catalogRequest;
    /** The last catalog loaded, shown at once when the screen is recreated (a theme change does that). */
    static List<Catalog.Entry> lastCatalog;
    static String lastCatalogUrl;
    final Runnable onStore = () -> { renderProfiles(); renderCatalog(); };   // cards show what's saved

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = new Prefs(this);
        store = Store.get(this);
        orientation = Store.deviceOrientation(this);
        ScrollView scroll = new ScrollView(this);
        scroll.setId(android.R.id.list);   // an id keeps the scroll position when a theme change recreates the screen
        scroll.setClipToPadding(false);
        scroll.setOnApplyWindowInsetsListener((v, in) -> {
            v.setPadding(in.getSystemWindowInsetLeft(), in.getSystemWindowInsetTop(),
                    in.getSystemWindowInsetRight(), in.getSystemWindowInsetBottom());
            return in.consumeSystemWindowInsets();
        });
        box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(this, 20), dp(this, 8), dp(this, 20), dp(this, 32));
        scroll.addView(box);
        setContentView(scroll);

        statusBox = column();
        box.addView(statusBox);
        updateBox = column();
        box.addView(updateBox);
        heading("Profiles");
        profilesBox = column();
        box.addView(profilesBox);

        LinearLayout catHead = headingRow("Catalog");
        Button refresh = Ui.flatButton(this, "Refresh");
        refresh.setOnClickListener(v -> loadCatalog());
        catHead.addView(refresh);
        catalogStatus = note("");
        catalogBox = column();
        box.addView(catalogBox);

        heading("Battery");
        batteryBox = new LinearLayout(this);
        box.addView(batteryBox, Ui.wide(0));
        renderBattery();
        note("Below this battery level the wallpaper shows a still image and the video player is shut down, to save battery. "
                + "It plays again while charging or once the battery is back above the level.");

        heading("Theme");
        themeBox = column();
        box.addView(themeBox, Ui.wide(0));
        renderTheme();

        renderAdvanced();
        store.addListener(onStore);
        renderProfiles();
        if (prefs.catalogUrl().equals(lastCatalogUrl)) { catalog = lastCatalog; renderCatalog(); }
        loadCatalog();

        IntentFilter status = new IntentFilter(Update.ACTION_STATUS);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(onInstaller, status, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(onInstaller, status);
        String test = getIntent().getStringExtra("updateUrl");
        if (test != null && Update.debuggable(this)) Update.testManifest = test;
        checkUpdate(false);
    }

    @Override
    protected void onDestroy() {
        store.removeListener(onStore);
        unregisterReceiver(onInstaller);
        catalogRequest++;
        gone = true;
        super.onDestroy();
    }

    @Override
    protected void onResume() {
        super.onResume();
        renderStatus();
        renderProfiles();
        importPacks();
    }

    // ---- wallpaper status

    void renderStatus() {
        statusBox.removeAllViews();
        if (LiveWallpaperService.isWallpaper(this)) return;
        Ui.IO.execute(() -> Theme.restore(this, prefs));   // the theme is only ours while we're the wallpaper
        Button set = new Button(this);
        set.setText("Set as wallpaper");
        set.setOnClickListener(v -> setWallpaper());
        statusBox.addView(set, Ui.wide(dp(this, 8)));
    }

    void setWallpaper() {
        Intent i = new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER)
                .putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT,
                        new ComponentName(this, LiveWallpaperService.class));
        try {
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            try {
                startActivity(new Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER));
            } catch (ActivityNotFoundException e2) {
                Toast.makeText(this, "No live wallpaper picker on this device", Toast.LENGTH_LONG).show();
            }
        }
    }

    // ---- updates of the app

    /** Looks for a newer release: at most once a day, unless asked for with the button (Advanced). */
    void checkUpdate(boolean asked) {
        if (updating) return;
        if (asked) updateNote.setText("Checking…");
        Ui.NET.execute(() -> {
            try {
                Update.Info found = Update.check(this, asked);
                runOnUiThread(() -> {
                    if (updating) return;
                    update = found;
                    updateStatus = null;
                    renderUpdate();
                    if (asked) updateNote.setText(found != null ? "" : "This is the latest version.");
                });
            } catch (Exception e) {
                // offline, or no release to read: only worth telling someone who asked
                Log.i(LiveWallpaperService.TAG, "update check: " + e.getMessage());
                if (asked) runOnUiThread(() -> updateNote.setText("Couldn't check: " + e.getMessage()));
            }
        });
    }

    void renderUpdate() {
        updateBox.removeAllViews();
        if (update == null) return;
        LinearLayout card = column();
        card.setBackground(Ui.card(this, true));
        card.setPadding(dp(this, 16), dp(this, 12), dp(this, 8), dp(this, 4));
        card.addView(Ui.bold(this, "Live Scenes " + update.version + " is available", 17));
        TextView sub = Ui.text(this, updateStatus != null ? updateStatus
                : "You have " + Update.installed(this).versionName + ". The update is a " + Ui.size(this, update.bytes)
                        + " download; your profiles and saved looks are kept.", 14);
        sub.setAlpha(0.8f);
        card.addView(sub, Ui.wide(dp(this, 2)));
        LinearLayout actions = new LinearLayout(this);
        actions.setGravity(Gravity.END);
        if (update.notes.startsWith("https://")) {
            Button notes = Ui.flatButton(this, "What's new");
            notes.setOnClickListener(v -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(update.notes)));
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(this, "No browser to open " + update.notes, Toast.LENGTH_LONG).show();
                }
            });
            actions.addView(notes);
        }
        Button go = Ui.flatButton(this, "Update");
        go.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        go.setTextColor(Ui.attrColor(this, android.R.attr.colorAccent));
        go.setEnabled(!updating);
        go.setOnClickListener(v -> startUpdate());
        actions.addView(go);
        card.addView(actions, Ui.wide(0));
        updateBox.addView(card, Ui.wide(dp(this, 8)));
    }

    void showUpdate(String s, boolean busy) {
        updateStatus = s;
        updating = busy;
        renderUpdate();
    }

    /** Downloads the release's APK, checks it, and passes it to the system installer (which asks the user). */
    void startUpdate() {
        if (updating || update == null) return;
        Update.Info u = update;
        showUpdate("Downloading…", true);
        Ui.NET.execute(() -> {
            try {
                File apk = Update.download(this, u, (done, total) -> runOnUiThread(() -> {
                    if (updating) showUpdate("Downloading " + Ui.size(this, done) + " of " + Ui.size(this, u.bytes) + "…", true);
                }), () -> gone);
                String problem = Update.problem(this, apk);
                if (problem == null) Update.install(this, apk);
                runOnUiThread(() -> showUpdate(problem != null ? problem : "Waiting for Android to install it…", problem == null));
            } catch (Exception e) {
                runOnUiThread(() -> showUpdate("The update failed: " + e.getMessage(), false));
            }
        });
    }

    /** The system installer's answers (Update.install). After a successful install this process is replaced. */
    final BroadcastReceiver onInstaller = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            int status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) startActivity(confirm);   // Android's "update this app?" screen
            } else if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
                showUpdate(null, false);                     // cancelled by the user
            } else if (status != PackageInstaller.STATUS_SUCCESS) {
                String why = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                showUpdate("Android didn't install the update" + (why != null ? ": " + why : "."), false);
            }
        }
    };

    // ---- profiles

    void renderProfiles() {
        if (profilesBox == null) return;
        profilesBox.removeAllViews();
        List<Store.Profile> list = store.list();
        Store.Profile active = store.activeProfile();
        if (list.isEmpty()) {
            TextView t = Ui.text(this, "No saved looks yet: the wallpaper plays the built-in Living Water. "
                    + "Preview a look from the catalog below and save it as a profile.", 15);
            t.setAlpha(0.75f);
            profilesBox.addView(t, Ui.wide(dp(this, 8)));
            return;
        }
        for (Store.Profile p : list) profilesBox.addView(profileRow(p, active != null && p.id.equals(active.id)), Ui.wide(dp(this, 10)));
        TextView total = Ui.text(this, "Saved looks use " + Ui.size(this, store.totalBytes()) + " in total.", 14);
        total.setAlpha(0.7f);
        profilesBox.addView(total, Ui.wide(dp(this, 10)));
    }

    View profileRow(Store.Profile p, boolean active) {
        LinearLayout row = column();
        row.setBackground(Ui.card(this, active));
        row.setPadding(dp(this, 12), dp(this, 12), dp(this, 8), dp(this, 4));

        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        ImageView img = new ImageView(this);
        img.setScaleType(ImageView.ScaleType.CENTER_CROP);
        img.setClipToOutline(true);
        img.setBackground(Ui.card(this, false));
        Ui.poster(this, img, null, store.poster(p.look), dp(this, 64));
        top.addView(img, new LinearLayout.LayoutParams(dp(this, 56), dp(this, 56)));
        LinearLayout texts = column();
        texts.setPadding(dp(this, 14), 0, 0, 0);
        texts.addView(Ui.bold(this, p.name, 17));
        TextView sub = Ui.text(this, store.lookTitle(p.look) + " · " + Ui.size(this, store.lookBytes(p.look)), 14);
        sub.setAlpha(0.7f);
        texts.addView(sub);
        TextView state = Ui.text(this, active ? "Playing as the wallpaper" : "Tap to use", 13);
        if (active) state.setTextColor(Ui.attrColor(this, android.R.attr.colorAccent));
        else state.setAlpha(0.6f);
        texts.addView(state);
        top.addView(texts, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        row.addView(top);

        LinearLayout actions = new LinearLayout(this);
        actions.setGravity(Gravity.CENTER_VERTICAL);
        for (float s : Store.SPEEDS) {
            Button b = Ui.flatButton(this, speedLabel(s));
            if (s == p.speed) {
                b.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
                b.setTextColor(Ui.attrColor(this, android.R.attr.colorAccent));
            } else {
                b.setAlpha(0.6f);
            }
            b.setContentDescription("Speed " + speedLabel(s) + " for " + p.name);
            b.setOnClickListener(v -> store.setSpeed(p.id, s));
            actions.addView(b);
        }
        actions.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1));
        Button rename = Ui.flatButton(this, "Rename");
        rename.setOnClickListener(v -> rename(p));
        actions.addView(rename);
        if (!active) {
            Button del = Ui.flatButton(this, "Delete");
            del.setOnClickListener(v -> delete(p));
            actions.addView(del);
        }
        row.addView(actions);

        row.setOnClickListener(v -> store.setActive(p.id));
        return row;
    }

    static String speedLabel(float s) { return Store.speedLabel(s); }

    void rename(Store.Profile p) {
        EditText e = new EditText(this);
        e.setText(p.name);
        e.setSingleLine();
        e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        e.setSelection(p.name.length());
        LinearLayout pad = column();
        pad.setPadding(dp(this, 20), dp(this, 8), dp(this, 20), 0);
        pad.addView(e);
        new AlertDialog.Builder(this)
                .setTitle("Rename profile")
                .setView(pad)
                .setPositiveButton("Rename", (d, w) -> store.rename(p.id, e.getText().toString()))
                .setNegativeButton("Cancel", null)
                .show();
    }

    void delete(Store.Profile p) {
        int sharing = 0;
        for (Store.Profile q : store.list()) if (q.look.equals(p.look)) sharing++;
        String msg = sharing > 1 ? "The look stays saved: another profile uses it."
                : "This also deletes the look's video (" + Ui.size(this, store.lookBytes(p.look)) + ").";
        new AlertDialog.Builder(this)
                .setTitle("Delete " + p.name + "?")
                .setMessage(msg)
                .setPositiveButton("Delete", (d, w) -> store.delete(p.id))
                .setNegativeButton("Cancel", null)
                .show();
    }

    // ---- import (packs pushed by the SDK)

    void importPacks() {
        Ui.IO.execute(() -> {
            List<String> report = store.importPacks();
            if (report.isEmpty()) return;
            runOnUiThread(() -> Toast.makeText(this, String.join("\n", report), Toast.LENGTH_LONG).show());
        });
    }

    // ---- catalog

    void loadCatalog() {
        int req = ++catalogRequest;
        String url = prefs.catalogUrl();
        catalogStatus.setText("Loading the catalog…");
        catalogStatus.setVisibility(View.VISIBLE);
        Ui.NET.execute(() -> {
            try {
                List<Catalog.Entry> list = Catalog.fetch(url, orientation);
                store.syncThemes(list);
                runOnUiThread(() -> {
                    if (req != catalogRequest) return;
                    catalog = lastCatalog = list;
                    lastCatalogUrl = url;
                    renderCatalog();
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (req != catalogRequest) return;
                    catalog = null;
                    renderCatalog();
                    catalogStatus.setText("Couldn't load the catalog: " + e.getMessage());
                });
            }
        });
    }

    void renderCatalog() {
        if (catalogBox == null) return;
        catalogBox.removeAllViews();
        if (catalog == null) return;
        catalogStatus.setText(catalog.isEmpty() ? "The catalog is empty."
                : "Tap a look to preview it. Tap a saved one to use it or add a profile.");
        LinearLayout line = null;
        for (int i = 0; i < catalog.size(); i++) {
            if (i % 2 == 0) {
                line = new LinearLayout(this);
                catalogBox.addView(line, Ui.wide(dp(this, 12)));
            }
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
            if (i % 2 == 1) lp.leftMargin = dp(this, 12);
            line.addView(catalogCard(catalog.get(i)), lp);
        }
        if (catalog.size() % 2 == 1) line.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1));
    }

    View catalogCard(Catalog.Entry e) {
        LinearLayout card = column();
        card.setBackground(Ui.card(this, false));
        card.setClipToOutline(true);
        ImageView img = new ImageView(this);
        img.setScaleType(ImageView.ScaleType.CENTER_CROP);
        Ui.poster(this, img, e.poster, null, dp(this, 200));
        card.addView(img, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this, 200)));
        LinearLayout texts = column();
        texts.setPadding(dp(this, 12), dp(this, 8), dp(this, 12), dp(this, 12));
        texts.addView(Ui.bold(this, e.title, 16));
        boolean saved = store.isSaved(e.id);
        boolean newer = saved && Store.isNewer(Store.videoSha(store.scene(e.id), e.orientation), e.sha256);
        TextView sub;
        if (saved) {
            int n = store.profilesFor(e.id).size();
            sub = Ui.text(this, newer ? "Saved · update" : "Saved · " + profiles(n), 13);
            sub.setTextColor(Ui.attrColor(this, android.R.attr.colorAccent));
            card.setContentDescription(e.title + ", saved, " + profiles(n) + (newer ? ", update available" : ""));
            card.setOnClickListener(v -> savedLook(e));
        } else {
            String what = e.orientation.equals(orientation) ? "" : " (cropped)";
            sub = Ui.text(this, cap(e.orientation) + what + " · " + Ui.size(this, e.bytes), 13);
            sub.setAlpha(0.7f);
            card.setContentDescription("Preview " + e.title);
            card.setOnClickListener(v -> preview(e));
        }
        texts.addView(sub);
        card.addView(texts);
        return card;
    }

    static String profiles(int n) { return n == 1 ? "1 profile" : n + " profiles"; }

    void preview(Catalog.Entry e) {
        startActivity(new Intent(this, PreviewActivity.class)
                .putExtra(PreviewActivity.EXTRA_ENTRY, e.json.toString())
                .putExtra(PreviewActivity.EXTRA_ORIENTATION, e.orientation)
                .putExtra(PreviewActivity.EXTRA_VIDEO, e.video.toString())
                .putExtra(PreviewActivity.EXTRA_POSTER, e.poster != null ? e.poster.toString() : null));
    }

    /**
     * A catalog look that is already saved: nothing is downloaded. Use one of its profiles, add one at another
     * speed (from the saved files), or, if the catalog has a newer video, update it (via the preview).
     */
    void savedLook(Catalog.Entry e) {
        boolean newer = Store.isNewer(Store.videoSha(store.scene(e.id), e.orientation), e.sha256);
        List<Store.Profile> using = store.profilesFor(e.id);
        Store.Profile active = store.activeProfile();
        LinearLayout v = column();
        v.setPadding(dp(this, 24), dp(this, 4), dp(this, 24), 0);
        AlertDialog[] dialog = new AlertDialog[1];

        TextView intro = Ui.text(this, newer
                ? "Saved on this phone. The catalog has a newer video (" + Ui.size(this, e.bytes) + "): "
                        + "Update downloads it and replaces the saved one for " + (using.size() == 1 ? "its profile." : "all its profiles.")
                : "Saved on this phone: no download needed.", 15);
        intro.setAlpha(0.8f);
        v.addView(intro, Ui.wide(0));

        if (!using.isEmpty()) {
            v.addView(dialogHeading("Use"));
            for (Store.Profile p : using) {
                boolean playing = active != null && p.id.equals(active.id);
                Button b = Ui.flatButton(this, p.name + " · " + speedLabel(p.speed) + (playing ? " · playing" : ""));
                b.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
                if (playing) {
                    b.setEnabled(false);
                } else {
                    b.setOnClickListener(x -> {
                        store.setActive(p.id);
                        Toast.makeText(this, "“" + p.name + "” is the active profile now", Toast.LENGTH_SHORT).show();
                        dialog[0].dismiss();
                    });
                }
                v.addView(b, Ui.wide(0));
            }
        }

        LinearLayout speeds = new LinearLayout(this);
        for (float s : Store.SPEEDS) {
            if (Store.withSpeed(using, e.id, s) != null) continue;   // that profile exists: use it above
            Button b = Ui.flatButton(this, speedLabel(s));
            b.setContentDescription("Add a profile for " + e.title + " at " + speedLabel(s));
            b.setOnClickListener(x -> {
                Store.Profile p = store.addProfile(e.id, s);
                Toast.makeText(this, "Added “" + p.name + "”: it's the active profile now", Toast.LENGTH_LONG).show();
                dialog[0].dismiss();
            });
            speeds.addView(b);
        }
        if (speeds.getChildCount() > 0) {
            v.addView(dialogHeading(using.isEmpty() ? "Add a profile at speed" : "Add another profile at speed"));
            v.addView(speeds, Ui.wide(0));
        }

        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle(e.title)
                .setView(v)
                .setNegativeButton("Close", null);
        if (newer) b.setPositiveButton("Update", (d, w) -> preview(e));
        dialog[0] = b.show();
    }

    TextView dialogHeading(String s) {
        TextView t = Ui.text(this, s, 13);
        t.setAllCaps(true);
        t.setLetterSpacing(0.08f);
        t.setAlpha(0.7f);
        t.setPadding(0, dp(this, 16), 0, dp(this, 2));
        return t;
    }

    static String cap(String s) { return Character.toUpperCase(s.charAt(0)) + s.substring(1); }

    // ---- battery

    void renderBattery() {
        batteryBox.removeAllViews();
        TextView label = Ui.text(this, "Still frame below", 15);
        batteryBox.setGravity(Gravity.CENTER_VERTICAL);
        batteryBox.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        int current = prefs.freezeBelow();
        for (int level : Prefs.FREEZE_LEVELS) {
            Button b = Ui.flatButton(this, level + "%");
            if (level == current) {
                b.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
                b.setTextColor(Ui.attrColor(this, android.R.attr.colorAccent));
            } else {
                b.setAlpha(0.6f);
            }
            b.setContentDescription("Still frame below " + level + "% battery");
            b.setOnClickListener(v -> {
                prefs.p.edit().putInt(Prefs.FREEZE_BELOW, level).apply();
                renderBattery();
            });
            batteryBox.addView(b);
        }
    }

    // ---- theme

    void renderTheme() {
        themeBox.removeAllViews();
        Switch match = new Switch(this);
        match.setText("Match the phone's theme to the look");
        match.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        match.setChecked(prefs.matchTheme());
        match.setOnCheckedChangeListener((b, on) -> {
            prefs.p.edit().putBoolean(Prefs.MATCH_THEME, on).apply();
            if (!on) Ui.IO.execute(() -> Theme.restore(this, prefs));
            renderTheme();
        });
        themeBox.addView(match, Ui.wide(dp(this, 4)));
        boolean now = Theme.canApplyNow(this);
        TextView about = Ui.text(this, "Every look comes with colors made for it, and Android builds its theme (Material You) "
                + "from them. Off: Android picks the colors from the look's picture. "
                + (now && prefs.themeNow() && prefs.matchTheme() ? ""
                        : "Android changes the theme for a new look the next time the screen turns off."), 14);
        about.setAlpha(0.7f);
        themeBox.addView(about, Ui.wide(dp(this, 4)));
        // with WRITE_SECURE_SETTINGS (granted over adb) the theme can change at once; shown while the option can
        // still be turned off too, so the user's setting can always be put back
        if (now || prefs.themeNow()) {
            Switch at = new Switch(this);
            at.setText("Change it at once, in the look's color style");
            at.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            at.setChecked(prefs.themeNow());
            at.setEnabled(prefs.matchTheme() && (now || prefs.themeNow()));
            at.setOnCheckedChangeListener((b, on) -> {
                prefs.p.edit().putBoolean(Prefs.THEME_NOW, on).apply();
                if (!on) Ui.IO.execute(() -> Theme.restore(this, prefs));
                renderTheme();
            });
            themeBox.addView(at, Ui.wide(dp(this, 12)));
            TextView how = Ui.text(this, now ? "Writes the theme to the system setting that Wallpaper & style uses. "
                    + "Turning this off puts your own setting back."
                    : "The permission for this was taken away: grant it again to put your own setting back.", 14);
            how.setAlpha(0.7f);
            themeBox.addView(how, Ui.wide(dp(this, 4)));
        }
    }

    // ---- advanced + developer

    void renderAdvanced() {
        heading("Advanced");
        box.addView(Ui.text(this, "Catalog URL", 15), Ui.wide(dp(this, 8)));
        EditText url = new EditText(this);
        url.setSingleLine();
        url.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        url.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        url.setText(prefs.catalogUrl());
        box.addView(url, Ui.wide(0));
        LinearLayout buttons = new LinearLayout(this);
        Button save = Ui.flatButton(this, "Use this catalog");
        save.setOnClickListener(v -> {
            String u = url.getText().toString().trim();
            prefs.p.edit().putString(Prefs.CATALOG_URL, u.equals(Prefs.DEFAULT_CATALOG) ? "" : u).apply();
            url.setText(prefs.catalogUrl());
            loadCatalog();
        });
        Button reset = Ui.flatButton(this, "Official catalog");
        reset.setOnClickListener(v -> {
            prefs.p.edit().remove(Prefs.CATALOG_URL).apply();
            url.setText(prefs.catalogUrl());
            loadCatalog();
        });
        buttons.addView(save);
        buttons.addView(reset);
        box.addView(buttons);

        LinearLayout version = new LinearLayout(this);
        version.setGravity(Gravity.CENTER_VERTICAL);
        version.addView(Ui.text(this, "Version " + Update.installed(this).versionName, 15),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button check = Ui.flatButton(this, "Check for updates");
        check.setOnClickListener(v -> checkUpdate(true));
        version.addView(check);
        box.addView(version, Ui.wide(dp(this, 8)));
        updateNote = note("");

        // Recent Android reports Developer options and USB debugging as off to apps, but the wireless debugging
        // switch is readable: show this while it's on, or while the option is on (so it can be turned off)
        if (LiveWallpaperService.wirelessDebugging(this) || prefs.devAwake()) {
            heading("Developer");
            Switch awake = new Switch(this);
            awake.setText("Keep the screen on while wireless debugging is on");
            awake.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            awake.setChecked(prefs.devAwake());
            awake.setOnCheckedChangeListener((b, on) -> prefs.p.edit().putBoolean(Prefs.DEV_AWAKE, on).apply());
            box.addView(awake, Ui.wide(dp(this, 4)));
            note("Works while Live Scenes is your wallpaper. The power button still turns the screen off. "
                    + "For plugged in, use Developer options > Stay awake.");
            if (!Theme.canApplyNow(this)) {
                note("To change the theme at once when the look changes, grant: adb shell pm grant " + getPackageName()
                        + " android.permission.WRITE_SECURE_SETTINGS");
            }
        }
    }

    // ---- view helpers

    LinearLayout column() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    void heading(String s) { headingRow(s); }

    LinearLayout headingRow(String s) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(this, 40));
        TextView t = Ui.text(this, s, 14);
        t.setAllCaps(true);
        t.setLetterSpacing(0.08f);
        t.setAlpha(0.7f);
        row.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        box.addView(row, Ui.wide(dp(this, 20)));
        return row;
    }

    TextView note(String s) {
        TextView t = Ui.text(this, s, 14);
        t.setAlpha(0.7f);
        box.addView(t, Ui.wide(dp(this, 4)));
        return t;
    }
}
