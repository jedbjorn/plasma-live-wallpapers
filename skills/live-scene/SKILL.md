---
name: live-scene
description: Make a Live Scenes wallpaper ("look") from a video and install it on Linux/Plasma, macOS or an Android phone, using the livescenes SDK. Use when the user wants to turn a clip, render or footage into a looping live wallpaper, check a look pack, or publish looks as a catalog.
---

# Making a Live Scenes look

A **look** is a seamlessly looping video that the Live Scenes apps play as the wallpaper. The SDK is one
script, `sdk/livescenes` in the plasma-live-wallpapers repo (Python 3 + ffmpeg with libx265). The pack
format is in `sdk/FORMAT.md`; read it if anything below is unclear.

```
livescenes pack SRC -o packs/<id> --id <id> --title "…" [options]   make a pack
livescenes theme packs/<id> --set '#..,#..,#..' [--style S]          its Android theme
livescenes check packs/<id>                                         validate it
livescenes add packs/<id> [--android]                               install it
livescenes catalog packs/* -o release/                              publish (optional)
```

Run `livescenes <command> --help` for every option before relying on one.

## 1. Get the facts first

- **Source**: the user's file, or footage they can make (a Blender render with `blender -b file.blend -a`,
  an After Effects export, an AI video tool they use, phone footage). The SDK needs a video; it does not
  generate one. Don't invent a source.
- **Rights**: ask who made it and under what licence, and put the real answer in `--author` / `--license`.
  Don't pack footage the user has no rights to share if they intend to publish it.
- **Where it will run**: desktop (landscape 2560×1440), phone (portrait 1080×2400), or both.

## 2. Look at the source

```
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate,color_transfer -of default=nw=1 SRC
ffmpeg -v error -ss 5 -i SRC -frames:v 1 /tmp/frame-5s.png      # repeat for a few times, then view them
```

View the extracted frames (read the image files) to choose the loop window and the focus point. Note:
camera cuts, a moving camera, and things that enter or leave the frame make seams visible.

## 3. Choose the loop

- `--start` / `--length`: a calm stretch, usually 20–90 s. Longer loops repeat less but cost more storage.
- `--fade` (default 1.5 s): the SDK renders `start + length + fade` seconds and crossfades the extra tail
  into the start, so the source must be that long. Use 1.5–2 s; avoid fading across a cut or a big
  movement (it ghosts). Use `--fade 0` only if the source is already a perfect cycle.
- `--focus X,Y` (0..1 of the source frame): what crops must keep in view.
- Phones: a landscape source gives only a narrow vertical slice. Choose one:
  - `--portrait-focus X,Y` to aim that slice;
  - `--portrait SRC2` for a separately rendered portrait version (same timing);
  - `--portrait-rotate cw` to turn the whole landscape picture sideways (it reads upright with the phone
    turned to landscape, top to the left) — good for wide compositions;
  - `--no-portrait` for desktop-only looks.

## 4. Pack and check

```
livescenes pack SRC -o packs/<id> --id <id> --title "Title" --author "Name" --license CC-BY-4.0 \
  --description "One sentence." --start 12 --length 40 --fade 2 --focus 0.6,0.45 --portrait-rotate cw
livescenes check packs/<id>
```

- `check` must print no FAIL (the theme one goes away in step 5). A seam failure means the end doesn't flow
  into the start: move `--start`, change `--length`, or lengthen `--fade`.
- Then look at the result yourself: extract the last and first frames of each mp4 and view them, plus a
  frame mid-crossfade (`length - fade/2` seconds), and view `poster.jpg`. Look for ghosting, cut-off
  subjects and banding.
- Sizes: aim for ≤ 30 MB landscape and ≤ 15 MB portrait. Lower quality with a higher `--crf` (default 24;
  +2 ≈ 30 % smaller); grain and noise cost the most.

### A level setting (optional)

A look may offer **one** setting at three levels, weak / medium / strong (for example how strongly lights
twinkle), when the user wants that choice. There is no live blending: each level is its own render of the
same loop (same length, framing and timing), and the apps download only the level the user picks. Only
offer it when the source can be rendered three times (a scene page with a strength parameter, a Blender
value); never fake a level by filtering one video.

```
livescenes pack strong.mkv --portrait strong-p.mkv --fade 0 -o packs/<id> --id <id> --title "…" \
  --level strong --level-label Twinkle --level-default strong
livescenes pack medium.mkv --portrait medium-p.mkv --fade 0 -o packs/<id> --id <id> --title "…" --level medium
livescenes pack weak.mkv --portrait weak-p.mkv --fade 0 -o packs/<id> --id <id> --title "…" --level weak
```

Use the same pack options (focus, crf, …) for every level. `--level-default` is what the apps save first
and what the poster shows. `check` fails until all three levels are packed. Look at a frame of each level:
they must be clearly different from one another, with medium halfway in feel.

## 5. Design its Android theme (every look ships one)

The Android app turns the phone's Material You theme to the look's own theme while it plays. Design it by
eye; it is part of the look, not an afterthought.

- Look at the poster and a few frames (portrait too: that's what phones show). Name the look's one
  recognisable color: the light in the room, the glowing koi, the logo, the neon. That's `primary`.
- Android seeds the whole palette from `primary` and makes its own tones of it (pastel accents on dark
  backgrounds), so the **hue** is what survives, not the exact shade. Avoid muddy averages of the frame and
  greys: a seed without color becomes Android blue. Keep it apart from the other looks' hues.
- `secondary`, `tertiary`: two more colors from the look, offered as alternatives in Wallpaper & style.
- `--light` only if the look is light (dark text suits it); looks are dark by default.
- `--style` (optional, used only where the user lets the app change the system style): `MONOCHROMATIC` for
  black-and-white art, `VIBRANT` for saturated looks, `TONAL_SPOT` for calm ones; leave it out to keep the
  user's style.

```
livescenes theme packs/<id>                                        # a suggestion from the poster
livescenes theme packs/<id> --set '#e2441f,#a3283a,#8c7b72' --style VIBRANT
```

If the look's source lives in a repository (like `scenes-src/<id>/` in plasma-live-wallpapers), keep the
theme next to it as `theme.json` and set it with `--set scenes-src/<id>/theme.json`. Re-packing keeps the
pack's theme. If you have an Android phone with the app, check the result there (the theme follows at the
next screen off). `check` fails until the look has a theme.

## 6. Install

- This desktop: `livescenes add packs/<id>`. It appears as a profile in the Live Scenes settings
  (Plasma: Configure Desktop and Wallpaper; macOS: the menu bar app).
- Android over adb (USB or wireless debugging): `livescenes add packs/<id> --android`, then open the Live
  Scenes app once to import it. Set `$ADB` if adb isn't on PATH or in `~/Android/Sdk`.

Report what you made: the pack path, loop length, sizes, focus points, the theme (colors and the idea), and
anything you weren't sure about.

## 7. Publish (only when asked)

`livescenes catalog packs/* -o release/` writes flat assets and `catalog.json` with relative URLs (themes
included; it warns about a pack without one). Upload
the whole folder as one release or to any static host; the apps take a catalog URL override. Uploading
is public: confirm with the user before running `gh release` or any upload.
