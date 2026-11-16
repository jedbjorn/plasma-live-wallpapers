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
  }
}
```

- `loop`: the video's length in seconds.
- `focus`: the point of that video, as fractions of its width and height (0..1), that cropping keeps
  in view. Default `[0.5, 0.5]`.
- `rotate` (optional, informational): `90` or `-90` when the video is a landscape picture turned 90°
  clockwise or counter-clockwise to fill a portrait screen (it reads upright with the phone turned
  sideways). Players ignore it and play the video as it is. Copied into the catalog entry too.
- Unknown keys must be ignored by readers. `format` changes only for incompatible changes.

### Videos

- HEVC (H.265) Main profile, 8-bit, yuv420p, MP4 container with the `hvc1` tag, `+faststart`, no audio.
- Constant 30 fps, a keyframe at least every 2 s.
- Seamless: the last frame flows into the first. The SDK makes this with a crossfade.
- Landscape 2560×1440, portrait 1080×2400. Other sizes are allowed; players never assume them.

### Playing

- Scale to **fill** the screen (aspect fill), then shift the crop so the focus point is as close to the
  screen centre as the video's edges allow.
- Pick the video whose orientation matches the screen; if missing, crop the other one.
- Speed presets: **0.5×, 1×, 2×** (playback rate). Nothing else is configurable per look.
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
`<id>-landscape.mp4`, `<id>-portrait.mp4`, `<id>-poster.jpg`, plus `catalog.json`.

## On the device: previews and profiles

Apps keep storage clean: only looks the user saves stay on disk.

- **Browse**: the catalog and posters only (posters may be cached in the cache folder).
- **Preview**: download only the one video this device needs (portrait on phones, landscape on desktops)
  into the **cache** folder, verify its sha256, play it. Leaving the preview without saving deletes it;
  leftovers in the preview cache are deleted at every launch.
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
looks/<id>/poster.jpg
profiles.json   { "format": 1, "active": "<profile id>", "profiles": [ { "id": "…", "name": "Hall", "look": "hall", "speed": 1.0 } ] }
```

Android imports: packs pushed to the app's external files dir `import/<id>/` (reachable with
`adb push` without root) are imported on the next launch, then removed from `import/`. Files pushed by
adb belong to the shell user and the app gets EACCES on them, so the pusher must make them accessible
afterwards: `adb shell chmod -R a+rwX /sdcard/Android/data/com.designsos.livescenes/files/import/<id>`
(`livescenes add --android` does this).
