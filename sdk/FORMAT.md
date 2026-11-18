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
- `options` and `variants` (optional): choices the user makes for the look, each combination its own render.
  See [Options](#options).
- Unknown keys must be ignored by readers. `format` changes only for incompatible changes.

### Options

A look may offer **options**: choices the user makes for it, such as how strongly the city lights of Avenue
Flow twinkle. Each option is a row in the apps (its label, then its values to pick from). Every combination
of values is its own render of the same loop, a **variant**, with its own landscape and portrait videos;
the poster is shared (it shows the default variant). Nothing is blended at play time: a variant is just
another video. The apps draw the rows from this data, so a new option or value needs no app change.

```json
"videos": { "landscape": { "file": "landscape-strong.mp4", … }, "portrait": { "file": "portrait-strong.mp4", … } },
"options": [
  { "label": "Twinkle", "default": "strong",
    "values": [ { "id": "weak", "label": "Weak" }, { "id": "medium", "label": "Medium" },
                { "id": "strong", "label": "Strong" } ] }
],
"variants": {
  "weak":   { "landscape": { "file": "landscape-weak.mp4", … },   "portrait": { "file": "portrait-weak.mp4", … } },
  "medium": { "landscape": { "file": "landscape-medium.mp4", … }, "portrait": { "file": "portrait-medium.mp4", … } },
  "strong": { "landscape": { "file": "landscape-strong.mp4", … }, "portrait": { "file": "portrait-strong.mp4", … } }
}
```

- `options`: a list, one entry per row, in the order shown. `label`: the row's name. `values`: two or more,
  in the order shown; `id` is `[a-z0-9]+` (unique within the option), `label` is what the apps show.
  `default`: the value id saved first.
- A **variant key** is the chosen value ids of the video options (all options but
  [theme options](#theme-options)) in option order, joined with `-`: `strong` for one option, `strong-heavy`
  for Twinkle = strong and a second option Rain = heavy. The default variant's key is those options'
  defaults joined the same way.
- `variants`: one entry per combination (all of them), each a `videos` object as above (same orientations,
  sizes and `loop` for every variant).
- The plain `videos` are always the default variant's (the same entries), so a reader that ignores `options`
  plays the default.
- Pack files: `<orientation>-<key>.mp4`. The catalog entry carries `options` and `variants` the same way,
  with `url`s (`<id>-<orientation>-<key>.mp4`).
- Apps (Android, Plasma) show one row per option for saved looks that have `options`. A saved look keeps one
  variant (see [On the device](#on-the-device-previews-and-profiles)); changing a value downloads that
  variant's video from the catalog and deletes the old one. All profiles of the look play the chosen
  variant. macOS doesn't read `options` yet (it still reads the older `levels`, which catalogs no longer
  have) and plays the default variant.
- Android: when the catalog loads, a saved look takes the catalog entry's `options` if its video's file name is one
  of the entry's variant files (`<orientation>-<key>.mp4`), or its plain video has a variant's sha256 (a look saved
  before it had options): it becomes that variant; no download.

#### Theme options

An option whose values each carry a `theme` (see [Themes](#themes)) chooses the look's Android theme instead of
a video: no render and no download per value.

```json
{ "label": "Color", "default": "indigo",
  "values": [ { "id": "indigo",  "label": "Indigo",  "theme": { "primary": "#3f63c8", … } },
              { "id": "seafoam", "label": "Seafoam", "theme": { "primary": "#6fbfa8", … } } ] }
```

- It takes no part in variant keys. The look's plain `theme` is its default value's theme, so a reader that
  ignores options uses the default colors.
- Android shows its row like any other; choosing a value writes that value's theme as the saved look's
  `theme` (nothing else changes). The value shown as chosen is the one whose theme equals the saved `theme`,
  else the default. When the catalog loads, and when a video option changes or the look is updated or
  imported again, Android keeps a saved theme that is one of these values' themes.
- Plasma and macOS don't use themes, so they don't show theme options.
- The SDK adds them with `livescenes theme <pack> --option <label> --value <id>[=<label>] --set <colors>`.

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
- Speed presets: **0.5×, 1×, 2×** (playback rate). Besides, a look with `options` plays the chosen variant's
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
[options](#options) has `<id>-<orientation>-<key>.mp4` for every variant instead, listed under its entry's
`variants` (the plain `videos` repeat the default variant's).

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
  leftovers in the preview cache are deleted at every launch. A look with options is previewed and saved as
  its default variant.
- **Options** (looks with `options`): the saved look's values are changed in its profile's settings: the app
  downloads that variant's video for this device from the catalog (sha256 checked), puts it in place of the
  old one and deletes the old one. Only the chosen variant's video is ever on disk.
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
looks/<id>/landscape-<key>.mp4 or portrait-<key>.mp4   (instead, for a look with options)
looks/<id>/poster.jpg
profiles.json   { "format": 1, "active": "<profile id>", "profiles": [ { "id": "…", "name": "Hall", "look": "hall", "speed": 1.0 } ] }
```

A saved look's `scene.json` lists only the video on disk under `videos`. A look with options keeps its
`options` (to show the rows), drops `variants`, and adds `"choice": "<key>"`, the variant that file is; its
file is named `<orientation>-<key>.mp4`, so a change is a new file to the players.

Android imports: packs pushed to the app's external files dir `import/<id>/` (reachable with
`adb push` without root) are imported on the next launch, then removed from `import/`. Files pushed by
adb belong to the shell user and the app gets EACCES on them, so the pusher must make them accessible
afterwards: `adb shell chmod -R a+rwX /sdcard/Android/data/com.designsos.livescenes/files/import/<id>`
(`livescenes add --android` does this).
