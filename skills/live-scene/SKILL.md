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

- `check` must print no FAIL. A seam failure means the end doesn't flow into the start: move `--start`,
  change `--length`, or lengthen `--fade`.
- Then look at the result yourself: extract the last and first frames of each mp4 and view them, plus a
  frame mid-crossfade (`length - fade/2` seconds), and view `poster.jpg`. Look for ghosting, cut-off
  subjects and banding.
- Sizes: aim for ≤ 30 MB landscape and ≤ 15 MB portrait. Lower quality with a higher `--crf` (default 24;
  +2 ≈ 30 % smaller); grain and noise cost the most.

## 5. Install

- This desktop: `livescenes add packs/<id>`. It appears as a profile in the Live Scenes settings
  (Plasma: Configure Desktop and Wallpaper; macOS: the menu bar app).
- Android over adb (USB or wireless debugging): `livescenes add packs/<id> --android`, then open the Live
  Scenes app once to import it. Set `$ADB` if adb isn't on PATH or in `~/Android/Sdk`.

Report what you made: the pack path, loop length, sizes, focus points, and anything you weren't sure about.

## 6. Publish (only when asked)

`livescenes catalog packs/* -o release/` writes flat assets and `catalog.json` with relative URLs. Upload
the whole folder as one release or to any static host; the apps take a catalog URL override. Uploading
is public: confirm with the user before running `gh release` or any upload.
