package com.designsos.livescenes;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.WallpaperInfo;
import android.app.WallpaperManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
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

import java.util.List;

import static com.designsos.livescenes.Ui.dp;

/**
 * The app: saved profiles, the catalog, and settings. Also the wallpaper picker's settings screen.
 * Changes apply to the running wallpaper at once (it listens to {@link Store}).
 */
public class SettingsActivity extends Activity {
    Prefs prefs;
    Store store;
    LinearLayout box, statusBox, profilesBox, catalogBox;
    TextView catalogStatus;
    String orientation;
    List<Catalog.Entry> catalog;
    int catalogRequest;
    final Runnable onStore = this::renderProfiles;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = new Prefs(this);
        store = Store.get(this);
        orientation = Store.deviceOrientation(this);
        ScrollView scroll = new ScrollView(this);
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

        renderAdvanced();
        store.addListener(onStore);
        renderProfiles();
        loadCatalog();
    }

    @Override
    protected void onDestroy() {
        store.removeListener(onStore);
        catalogRequest++;
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

    boolean isWallpaper() {
        WallpaperInfo info = WallpaperManager.getInstance(this).getWallpaperInfo();
        return info != null && getPackageName().equals(info.getPackageName());
    }

    void renderStatus() {
        statusBox.removeAllViews();
        if (isWallpaper()) return;
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

    static String speedLabel(float s) { return (s == 0.5f ? "0.5" : String.valueOf((int) s)) + "×"; }

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
        Ui.IO.execute(() -> {
            try {
                List<Catalog.Entry> list = Catalog.fetch(url, orientation);
                runOnUiThread(() -> { if (req == catalogRequest) { catalog = list; renderCatalog(); } });
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
        catalogBox.removeAllViews();
        if (catalog == null) return;
        catalogStatus.setText(catalog.isEmpty() ? "The catalog is empty." : "Tap a look to preview it.");
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
        String what = e.orientation.equals(orientation) ? "" : " (cropped)";
        TextView size = Ui.text(this, cap(e.orientation) + what + " · " + Ui.size(this, e.bytes), 13);
        size.setAlpha(0.7f);
        texts.addView(size);
        card.addView(texts);
        card.setContentDescription("Preview " + e.title);
        card.setOnClickListener(v -> startActivity(new Intent(this, PreviewActivity.class)
                .putExtra(PreviewActivity.EXTRA_ENTRY, e.json.toString())
                .putExtra(PreviewActivity.EXTRA_ORIENTATION, e.orientation)
                .putExtra(PreviewActivity.EXTRA_VIDEO, e.video.toString())
                .putExtra(PreviewActivity.EXTRA_POSTER, e.poster != null ? e.poster.toString() : null)));
        return card;
    }

    static String cap(String s) { return Character.toUpperCase(s.charAt(0)) + s.substring(1); }

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
