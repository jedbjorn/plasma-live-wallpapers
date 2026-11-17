# Live Scenes formats

This is the contract between the SDK (`sdk/livescenes`), the catalog, and the apps (Android, Plasma, macOS).
A wallpaper is a **look**: a seamlessly looping video. Apps only play videos; nothing is rendered live.

## Look pack

A look pack is a folder named after the look's id (`[a-z0-9-]+`):

```
hall/
  scene.json
  landscape.mp4    optional if portrait.mp4 exists
  portrait.mp4     optional if landscape.mp4 exists
  poster.jpg       640 px on the long side, from the landscape video if there is one
```

For distribution it is zipped as `<id>.zip` with the folder at the zip root.

### scene.json

```json
{
  "format": 1,
  "id": "hall",
  "title": "Hall",
  "author": "designs-os.com",
  "license": "MIT",
  "description": "A raymarched concrete hall through one day.",
  "loop": 84.0,
  "videos": {
    "landscape": { "file": "landscape.mp4", "width": 2560, "height": 1440, "fps": 30,
                   "bytes": 12345678, "sha256": "…", "focus": [0.5, 0.5] },
    "portrait":  { "file": "portrait.mp4",  "width": 1080, "height": 2400, "fps": 30,
                   "bytes": 2345678,  "sha256": "…", "focus": [0.5, 0.5] }
  },
  "theme": { "primary": "#6f8db0", "secondary": "#9aa6b2", "tertiary": "#e0a458", "dark": true,
             "style": "TONAL_SPOT" }
}
```

- `loop`: the video's length in seconds.
- `focus`: the point of that video, as fractions of its width and height (0..1), that cropping keeps
  in view. Default `[0.5, 0.5]`.
- `rotate` (optional, informational): `90` or `-90` when the video is a landscape picture turned 90°
  clockwise or counter-clockwise to fill a portrait screen (it reads upright with the phone turned
  sideways). Players ignore it and play the video as it is. Copied into the catalog entry too.
- `theme` (optional for readers; the SDK requires it for new looks): the look's Android theme, colors chosen
  by hand so the phone's Material You theme matches the look. See [Themes](#themes). Copied into the catalog entry.
- `levels` (optional): the look's one level knob, three renders of it to choose from. See [Levels](#levels).
- Unknown keys must be ignored by readers. `format` changes only for incompatible changes.

### Levels

A look may have **one** knob with exactly three levels, `weak`, `medium` and `strong` (for example how strongly
the city lights of Avenue Flow twinkle). Each level is a separate render of the same loop, with its own
landscape and portrait videos; the poster is shared (it shows the default level). Nothing is blended at play
time: a level is just another video.

```json
"videos": { "landscape": { "file": "landscape-strong.mp4", … }, "portrait": { "file": "portrait-strong.mp4", … } },
"levels": {
  "label": "Twinkle",
  "default": "strong",
  "videos": {
    "weak":   { "landscape": { "file": "landscape-weak.mp4", … },   "portrait": { "file": "portrait-weak.mp4", … } },
    "medium": { "landscape": { "file": "landscape-medium.mp4", … }, "portrait": { "file": "portrait-medium.mp4", … } },
    "strong": { "landscape": { "file": "landscape-strong.mp4", … }, "portrait": { "file": "portrait-strong.mp4", … } }
  }
}
```

- `label`: the knob's name in the apps. `default`: the level downloaded first.
- `videos.<level>`: a `videos` object as above (same orientations, sizes and `loop` for every level).
- The plain `videos` are always the default level's (the same entries), so a reader that ignores `levels`
  plays the default level.
- Pack files: `<orientation>-<level>.mp4`. The catalog entry carries `levels` the same way, with `url`s
  (`<id>-<orientation>-<level>.mp4`).
- Apps (Android, Plasma) show a Weak / Medium / Strong picker with the label for saved looks that have
  `levels`. A saved look keeps one level (see [On the device](#on-the-device-previews-and-profiles)); changing
  it downloads that level's video from the catalog and deletes the old one. All profiles of the look play
  the chosen level. macOS ignores `levels` for now and plays the default level.
- When the catalog loads, Android gives a saved look without `levels` the catalog entry's `levels` if its
  video is the catalog's default level (a look that got levels later); no download.

### Themes

```json
"theme": { "primary": "#e2441f", "secondary": "#a3283a", "tertiary": "#8c7b72", "dark": true, "style": "VIBRANT" }
```

- `primary` (required in a theme), `secondary`, `tertiary` (optional): `#rrggbb`. Android seeds its whole
  palette from `primary` and makes its own tones of it, so its hue is what shows; pick it on purpose, with
  some color in it (Android replaces a grey seed with blue). `secondary` and `tertiary` are offered as
  alternatives in Android's Wallpaper & style.
- `dark` (default `true`): the look is dark, light text and a dark theme suit it. `false`: a light look
  (dark text on it).
- `style` (optional): the Material You style that suits the look: `TONAL_SPOT`, `VIBRANT`, `EXPRESSIVE`,
  `SPRITZ`, `RAINBOW`, `FRUIT_SALAD` or `MONOCHROMATIC` (grey, for black-and-white looks). Android only uses
  it where the user lets the app change the system theme setting (below); otherwise the user's style stays.
- A look without a theme, or a player that ignores themes, gets colors from the poster as before. Players
  other than Android ignore it for now.
- Android: "Match the phone's theme to the look" (on by default) gives the system the theme's colors instead
  of the poster's. Android applies a live wallpaper's new colors the next time the screen turns off (SystemUI
  accepts one color change per wallpaper set, then defers them). If the user grants `WRITE_SECURE_SETTINGS`
  over adb, "Change it at once" writes `system_palette` (= `primary`) and `theme_style` into
  `Settings.Secure.theme_customization_overlay_packages`, the setting Wallpaper & style uses, so the theme
  changes immediately; the user's value is saved first and put back when the option is turned off.
- When the catalog loads, Android copies a changed `theme` of a saved look into its `scene.json` (no download).

### Videos

- HEVC (H.265) Main profile, 8-bit, yuv420p, MP4 container with the `hvc1` tag, `+faststart`, no audio.
- Constant 30 fps, a keyframe at least every 2 s.
- Seamless: the last frame flows into the first. The SDK makes this with a crossfade.
- Landscape 2560×1440, portrait 1080×2400. Other sizes are allowed; players never assume them.

### Playing

- Scale to **fill** the screen (aspect fill), then shift the crop so the focus point is as close to the
  screen centre as the video's edges allow.
- Pick the video whose orientation matches the screen; if missing, crop the other one.
- Speed presets: **0.5×, 1×, 2×** (playback rate). Besides, a look with `levels` plays the chosen level's
  video. Nothing else is configurable per look.
- Pause whenever the wallpaper is hidden (apps over it, screen off, locked without it showing).

## Catalog

One JSON file listing looks to browse. The official one is a GitHub Release asset:
`https://github.com/jedbjorn/plasma-live-wallpapers/releases/latest/download/catalog.json`.
Every app must let the catalog URL be overridden (for testing and for third-party catalogs).

```json
{
  "format": 1,
  "looks": [
    {
      "id": "hall", "title": "Hall", "author": "designs-os.com", "license": "MIT",
      "description": "…", "loop": 84.0,
      "poster": "hall-poster.jpg",
      "theme": { "primary": "#6f8db0", "secondary": "#9aa6b2", "tertiary": "#e0a458", "dark": true },
      "videos": {
        "landscape": { "url": "hall-landscape.mp4", "width": 2560, "height": 1440,
                       "bytes": 12345678, "sha256": "…", "focus": [0.5, 0.5] },
        "portrait":  { "url": "hall-portrait.mp4", "width": 1080, "height": 2400,
                       "bytes": 2345678, "sha256": "…", "focus": [0.5, 0.5] }
      }
    }
  ]
}
```

URLs may be relative; they resolve against the catalog's own URL. Release assets are flat:
`<id>-landscape.mp4`, `<id>-portrait.mp4`, `<id>-poster.jpg`, plus `catalog.json`. A look with
[levels](#levels) has `<id>-<orientation>-<level>.mp4` for all three levels instead, listed under its entry's
`levels.videos` (the plain `videos` repeat the default level's).

## App updates

The apps update themselves from the same release as the catalog. `update.json`, next to `catalog.json`
(`…/releases/latest/download/update.json`), says which version the release holds and where each
platform's app is:

```json
{
  "format": 1,
  "version": "2.1.0",
  "notes": "https://github.com/jedbjorn/plasma-live-wallpapers/releases/tag/v2.1.0",
  "plasma":  { "url": "live-scenes-plasma-2.1.0.tar.gz", "bytes": 19875, "sha256": "…" },
  "android": { "versionCode": 20100, "url": "LiveScenes-2.1.0.apk", "bytes": 4854697, "sha256": "…" }
}
```

- `version` is `<major>.<minor>.<patch>`, the content of the `VERSION` file the release was built from.
  Versions compare number by number (2.10.0 is newer than 2.9.1). Android compares `versionCode`
  instead (`major * 10000 + minor * 100 + patch`), which is what the system installer goes by.
- A platform's key is missing when the release has nothing for it; its app then offers no update.
  `notes` (optional, https) is opened in the browser by "What's new".
- URLs may be relative, like the catalog's. Apps accept https only, and verify `sha256` before installing.
- `plasma` is a `.tar.gz` holding the wallpaper package as `package/` (`metadata.json`, `contents/`),
  without a look: the update keeps the installed one. It is installed with `kpackagetool6 --upgrade`;
  plasmashell keeps the old version loaded until it restarts, and the app says so.
- `android` is the APK. Android only installs it over an app signed with the same key, and asks the user.
- The check: when the settings are opened, at most once a day, plus a "Check for updates" button. The
  wallpaper itself never checks. Offline, or a release without `update.json`, means "no update" without
  an error (unless the user pressed the button). Nothing is sent but the request for `update.json`.

`release.sh` builds the two apps and `update.json` (see the README).

## On the device: previews and profiles

Apps keep storage clean: only looks the user saves stay on disk.

- **Browse**: the catalog and posters only (posters may be cached in the cache folder).
- **Preview**: download only the one video this device needs (portrait on phones, landscape on desktops)
  into the **cache** folder, verify its sha256, play it. Leaving the preview without saving deletes it;
  leftovers in the preview cache are deleted at every launch. A look with levels is previewed and saved at
  its default level.
- **Level** (looks with `levels`): the saved look's level is changed in its profile's settings: the app
  downloads that level's video for this device from the catalog (sha256 checked), puts it in place of the
  old one and deletes the old one. Only the chosen level's video is ever on disk.
- **Save as profile**: move the previewed video into permanent storage and create a profile.
  A profile is `{ "id", "name", "look", "speed" }`. Several profiles may share one look; the look's
  files are deleted when no profile uses it any more. The active profile cannot be deleted.
- **Import**: a look pack from the SDK becomes a saved look plus a profile, the same way.
- **Bundled default**: the app ships one small look (Living Water) inside its package, used when no
  profile exists. It is never copied to storage.

Storage layout:

| | Saved looks and profiles | Previews |
| --- | --- | --- |
| Linux | `~/.local/share/live-scenes/` | `~/.cache/live-scenes/preview/` |
| macOS | `~/Library/Application Support/LiveScenes/` | `~/Library/Caches/LiveScenes/preview/` |
| Android | the app's files dir | the app's cache dir |

Inside the saved-data folder:

```
looks/<id>/scene.json
looks/<id>/landscape.mp4 or portrait.mp4   (only the orientation this device uses)
looks/<id>/landscape-<level>.mp4 or portrait-<level>.mp4   (instead, for a look with levels)
looks/<id>/poster.jpg
profiles.json   { "format": 1, "active": "<profile id>", "profiles": [ { "id": "…", "name": "Hall", "look": "hall", "speed": 1.0 } ] }
```

A saved look's `scene.json` lists only the video on disk under `videos`. A look with levels keeps its
`levels` (to show the picker) and adds `"level": "<level>"`, the level that file is; its file is named
`<orientation>-<level>.mp4`, so a level change is a new file to the players.

Android imports: packs pushed to the app's external files dir `import/<id>/` (reachable with
`adb push` without root) are imported on the next launch, then removed from `import/`. Files pushed by
adb belong to the shell user and the app gets EACCES on them, so the pusher must make them accessible
afterwards: `adb shell chmod -R a+rwX /sdcard/Android/data/com.designsos.livescenes/files/import/<id>`
(`livescenes add --android` does this).
