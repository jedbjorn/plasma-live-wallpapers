# Images and videos

The MIT licence in [LICENSE](LICENSE) covers the code in this repository only: the QML, JavaScript, GLSL, HTML and shell scripts.

It does not cover any image or video here. That includes:

- the artwork embedded in `package/contents/web/smoke-signal/assets.js` (the base image and the masks derived from it);
- `package/contents/web/hall/still.jpg`;
- everything under `docs/` (screenshots, previews and videos).

No licence is granted for these files. They are included so the scenes work and so you can see what they look like.

## Smoke Signal artwork

The Smoke Signal scene is built on a fan illustration of a character from Cyberpunk 2077. This is an unofficial fan work and is not approved or endorsed by CD PROJEKT RED. Cyberpunk 2077, its characters and the Samurai emblem belong to CD PROJEKT S.A. The illustration belongs to its original artist, who is not known to this project. It is used here non-commercially, in line with CD PROJEKT RED's [Fan Content Guidelines](https://www.cdprojektred.com/en/fan-content).

If you are the artist or a rights holder and want it credited or removed, open an issue on this repository and it will be done.

To use the scene with a different picture, replace the data in `assets.js`: `base` is a 1920x1080 image, `maskA` holds three masks in its channels (red: the red emblem area, green: white highlights, blue: the figure's silhouette) and `maskB` holds soft glows (red: around the emblem, green: around the white lettering).
