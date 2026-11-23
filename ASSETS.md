# Images and videos

Everything in this project is MIT licensed ([LICENSE](LICENSE)) wherever we are able to license it: the code, and the images and videos we made. That includes the Hall and Living Water looks (their videos and posters, published as release assets), `scenes-src/hall/still.jpg`, and the Hall and Living Water images and videos under `docs/`.

The README and website gallery under `docs/` contains posters, animated previews and video recordings of all thirteen looks. These reproduce the corresponding look assets and do not change or add to the licensing of the underlying artwork.

The one exception is the **Smoke Signal artwork**, which is not ours to license. It covers:

- the artwork embedded in `scenes-src/smoke-signal/assets.js` (the base image and the masks derived from it);
- the Smoke Signal look's videos and poster (release assets);
- the Smoke Signal images and videos under `docs/` (`docs/smoke-signal.*`).

The code that animates it (the smoke simulation, glitches and effects in `scenes-src/smoke-signal/`) is MIT like the rest.

## Smoke Signal artwork

The Smoke Signal scene is built on a fan illustration of a character from Cyberpunk 2077. This is an unofficial fan work and is not approved or endorsed by CD PROJEKT RED. Cyberpunk 2077, its characters and the Samurai emblem belong to CD PROJEKT S.A. The illustration belongs to its original artist, who is not known to this project. It is used here non-commercially, in line with CD PROJEKT RED's [Fan Content Guidelines](https://www.cdprojektred.com/en/fan-content), which allow this kind of fan content. No licence is granted for it, MIT or otherwise.

If you are the artist or a rights holder and want it credited or removed, open an issue on this repository and it will be done.

To use the scene with a different picture, replace the data in `assets.js`: `base` is a 1920x1080 image, `maskA` holds three masks in its channels (red: the red emblem area, green: white highlights, blue: the figure's silhouette) and `maskB` holds soft glows (red: around the emblem, green: around the white lettering).
