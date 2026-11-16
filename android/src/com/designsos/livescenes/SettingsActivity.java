package com.designsos.livescenes;

import android.app.Activity;
import android.app.WallpaperInfo;
import android.app.WallpaperManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.util.function.IntConsumer;

/** Settings: the launcher icon, and the wallpaper picker's settings button. Changes apply to the running wallpaper at once. */
public class SettingsActivity extends Activity {
    Prefs prefs;
    LinearLayout box;
    Button setButton;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = new Prefs(this);

        ScrollView scroll = new ScrollView(this);
        scroll.setClipToPadding(false);
        scroll.setOnApplyWindowInsetsListener((v, in) -> {
            v.setPadding(in.getSystemWindowInsetLeft(), in.getSystemWindowInsetTop(),
                    in.getSystemWindowInsetRight(), in.getSystemWindowInsetBottom());
            return in.consumeSystemWindowInsets();
        });
        box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(20), dp(16), dp(20), dp(32));
        scroll.addView(box);
        setContentView(scroll);
        render();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (setButton != null) updateSetButton();
    }

    void render() {
        box.removeAllViews();

        setButton = new Button(this);
        setButton.setOnClickListener(v -> setWallpaper());
        box.addView(setButton, wrap(dp(12)));
        updateSetButton();

        heading("Scene");
        RadioGroup scenes = new RadioGroup(this);
        for (int i = 0; i < Prefs.SCENES.length; i++) {
            String folder = Prefs.SCENES[i];
            RadioButton b = radio(Prefs.TITLES[i], folder.equals(prefs.scene()));
            b.setOnClickListener(v -> { prefs.p.edit().putString(Prefs.SCENE, folder).apply(); render(); });
            scenes.addView(b);
        }
        box.addView(scenes);

        heading("Performance");
        note("Lower values save battery. The wallpaper stops drawing whenever it is hidden.");
        slider("Frames per second", "", 5, 120, 1, prefs.fps(), v -> prefs.p.edit().putInt(Prefs.FPS, v).apply());
        slider("Render resolution", "%", 25, 100, 5, prefs.scale(), v -> prefs.p.edit().putInt(Prefs.SCALE, v).apply());

        switch (prefs.scene()) {
            case "hall": {
                heading("Daylight");
                RadioGroup mode = new RadioGroup(this);
                String[] modes = {"Loop through a day", "Follow the real clock"};
                for (int i = 0; i < modes.length; i++) {
                    int m = i;
                    RadioButton b = radio(modes[i], prefs.mode() == i);
                    b.setOnClickListener(v -> { prefs.p.edit().putInt(Prefs.MODE, m).apply(); render(); });
                    mode.addView(b);
                }
                box.addView(mode);
                if (prefs.mode() == 0) {
                    heading("One day lasts");
                    RadioGroup loop = new RadioGroup(this);
                    int[] secs = {84, 300, 900, 3600, 86400};
                    String[] names = {"84 seconds", "5 minutes", "15 minutes", "1 hour", "24 hours"};
                    for (int i = 0; i < secs.length; i++) {
                        int s = secs[i];
                        RadioButton b = radio(names[i], prefs.loopSeconds() == s);
                        b.setOnClickListener(v -> prefs.p.edit().putInt(Prefs.LOOP, s).apply());
                        loop.addView(b);
                    }
                    box.addView(loop);
                }
                break;
            }
            case "smoke-signal": {
                heading("Smoke Signal");
                Switch gun = new Switch(this);
                gun.setText("Gun fires now and then");
                gun.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
                gun.setChecked(prefs.shots());
                gun.setOnCheckedChangeListener((b, on) -> prefs.p.edit().putBoolean(Prefs.SHOTS, on).apply());
                box.addView(gun, wrap(dp(4)));
                break;
            }
            case "living-water": {
                heading("Living Water");
                slider("Swim speed", "%", 10, 400, 10, prefs.swimSpeed(), v -> prefs.p.edit().putInt(Prefs.SWIM, v).apply());
                break;
            }
        }

        // Recent Android reports Developer options and USB debugging as off to apps, but the wireless debugging
        // switch is readable: show this while it's on, or while the option is on (so it can be turned off)
        if (LiveWallpaperService.wirelessDebugging(this) || prefs.devAwake()) {
            heading("Developer");
            Switch awake = new Switch(this);
            awake.setText("Keep the screen on while wireless debugging is on");
            awake.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            awake.setChecked(prefs.devAwake());
            awake.setOnCheckedChangeListener((b, on) -> prefs.p.edit().putBoolean(Prefs.DEV_AWAKE, on).apply());
            box.addView(awake, wrap(dp(4)));
            note("Works while Live Scenes is your wallpaper. The power button still turns the screen off. "
                    + "For plugged in, use Developer options > Stay awake.");
        }
    }

    // ---- wallpaper

    boolean isActive() {
        WallpaperInfo info = WallpaperManager.getInstance(this).getWallpaperInfo();
        return info != null && getPackageName().equals(info.getPackageName());
    }

    void updateSetButton() {
        setButton.setText(isActive() ? "Live Scenes is your wallpaper" : "Set as wallpaper");
        setButton.setEnabled(!isActive());
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

    // ---- little view helpers

    void slider(String label, String unit, int min, int max, int step, int value, IntConsumer save) {
        TextView t = text(label + ": " + value + unit, 16);
        box.addView(t, wrap(dp(12)));
        SeekBar bar = new SeekBar(this);
        bar.setMax((max - min) / step);
        bar.setProgress((Math.max(min, Math.min(max, value)) - min) / step);
        bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            int now = value;
            @Override public void onProgressChanged(SeekBar s, int p, boolean user) {
                now = min + p * step;
                t.setText(label + ": " + now + unit);
            }
            @Override public void onStartTrackingTouch(SeekBar s) {}
            @Override public void onStopTrackingTouch(SeekBar s) { save.accept(now); }   // reload the page once, on release
        });
        box.addView(bar, wrap(dp(4)));
    }

    void heading(String s) {
        TextView t = text(s, 14);
        t.setAllCaps(true);
        t.setLetterSpacing(0.08f);
        t.setAlpha(0.7f);
        box.addView(t, wrap(dp(28)));
    }

    void note(String s) {
        TextView t = text(s, 14);
        t.setAlpha(0.7f);
        box.addView(t, wrap(dp(4)));
    }

    RadioButton radio(String s, boolean on) {
        RadioButton b = new RadioButton(this);
        b.setText(s);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setId(View.generateViewId());
        b.setChecked(on);
        return b;
    }

    TextView text(String s, int sp) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        return t;
    }

    LinearLayout.LayoutParams wrap(int top) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = top;
        return lp;
    }

    int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
