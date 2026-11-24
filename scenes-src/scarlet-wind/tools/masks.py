"""masks.py SRC.jpg FIGURE_RGBA.png OUTDIR: the scene's masks, all in the picture's own pixels (1920 x 1080).
  masks.png  R = the figure (matte)
             G = the streaming hair, by how free it is: 0 where it leaves her shoulder .. 1 at the tips
             B = the cape's free edge (right side and hem): 0 fixed .. 1 loose
  marks.png  R = the fur collar, G = the painted ring of sparks, B = the glowing embers by the blade
Prints the ring's ellipse (fitted to the painted sparks) and the hair's root, for index.html."""
import sys, json
import numpy as np, cv2
src, fig, out = sys.argv[1:4]
im = cv2.imread(src); H, W = im.shape[:2]
a = cv2.imread(fig, cv2.IMREAD_UNCHANGED)[..., 3].astype(np.float32) / 255
b, g, r = [im[..., i].astype(np.float32) for i in range(3)]
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
blur = lambda m, s: cv2.GaussianBlur(m, (0, 0), s)
grow = lambda m, k: cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
ss = lambda lo, hi, v: np.clip((v - lo) / (hi - lo), 0, 1) ** 2 * (3 - 2 * np.clip((v - lo) / (hi - lo), 0, 1))

mx = np.maximum(g, b)
red = np.clip((r - 1.3 * mx - 8) / 50, 0, 1)                       # hair, cape and sparks: red well above green and blue
spark = ((r > 110) & (r > 1.6 * g) & (r > 1.6 * b)).astype(np.float32)   # the sparks alone: bright and saturated
haze = np.clip((r - 1.25 * mx - 6) / 40, 0, 1)                    # and the faint red of the ring between them

# the ring: fit an ellipse to its red, away from the figure and from the hair
away = (grow(a, 31) < 0.05) & ~((xx > 380) & (xx < 720) & (yy > 440) & (yy < 640)) & (yy < 900)
ys, xs = np.nonzero(away & (haze > 0.3))
pts = np.stack([xs, ys], 1).astype(np.float64)
cx, cy, rx, ry = 955.0, 416.0, 415.0, 400.0
for tol in (0.14, 0.12, 0.10, 0.08, 0.06, 0.06, 0.06):            # a few rounds: keep the points near the last fit
    d = np.hypot((pts[:, 0] - cx) / rx, (pts[:, 1] - cy) / ry)
    P = pts[np.abs(d - 1) < tol]
    A = np.stack([P[:, 0] ** 2, P[:, 1] ** 2, P[:, 0], P[:, 1]], 1)
    k, *_ = np.linalg.lstsq(A / 1e6, np.ones(len(P)), rcond=None) # a x^2 + b y^2 + c x + d y = 1 (axes upright)
    k = k / 1e6
    cx, cy = -k[2] / (2 * k[0]), -k[3] / (2 * k[1])
    s_ = 1 + k[0] * cx ** 2 + k[1] * cy ** 2
    rx, ry = float(np.sqrt(s_ / k[0])), float(np.sqrt(s_ / k[1]))
dn = np.hypot((xx - cx) / rx, (yy - cy) / ry)
ring = blur(np.maximum(grow(spark, 3), haze) * (np.abs(dn - 1) < 0.075), 1.0)

# the hair that streams out to the left of her shoulder
ROOT = (880.0, 250.0)
rad = np.hypot(xx - ROOT[0], yy - ROOT[1])
zone = ((xx > 360) & (xx < 800) & (yy > np.where(xx < 700, 288 + (700 - xx) * 0.483, 225)) & (yy < 680)).astype(np.float32)
hairpix = ((red > 0.25) & (spark < 0.5)).astype(np.float32) * zone * (yy < 0.75 * (xx - 360) + 470) * (rad > 120)
n, lab, stats, _ = cv2.connectedComponentsWithStats(grow(hairpix, 5).astype(np.uint8))   # strands, not stray sparks
hairpix *= np.isin(lab, [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > 1500])
region = blur(grow(hairpix, 27), 10)
rigid = ((a > 0.6) & (red < 0.12)).astype(np.float32) * (xx > 560)   # armour and glove: they never move
region *= 1 - np.clip(blur(grow(rigid, 5), 4) * 1.4, 0, 1)
hair = np.clip(region, 0, 1) * ss(150, 500, rad)
ring *= 1 - np.clip(2 * blur(grow(hairpix, 9), 4), 0, 1)       # the ring's glow must not light the hair it crosses

# the cape's loose edge on her right, more toward the hem
edge = blur(grow((a > 0.5).astype(np.float32), 21), 8)
cape = edge * ss(1130, 1300, xx) * ss(380, 900, yy)

sat = (np.maximum(r, mx) - np.minimum(r, np.minimum(g, b))) / (np.maximum(r, mx) + 1)
fur = ((r > 150) & (sat < 0.22)).astype(np.float32) * (a > 0.5) * (xx > 800) * (xx < 1190) * (yy > 170) * (yy < 460)
fur *= np.hypot((xx - 968) / 88, (yy - 190) / 150) > 1          # not the helmet's highlights
fur = cv2.morphologyEx(fur, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n, lab, stats, _ = cv2.connectedComponentsWithStats(grow(fur, 7).astype(np.uint8))
fur *= lab == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))  # the collar: the largest light patch
fur = blur(grow(fur, 7), 5)
ember = np.clip((r - b - 60) / 80, 0, 1) * np.clip((g - b - 15) / 40, 0, 1) * (yy > 880) * (xx < 800)
ember = blur(ember, 1.5)

u8 = lambda m: (np.clip(m, 0, 1) * 255 + 0.5).astype(np.uint8)
cv2.imwrite(out + '/masks.png', np.dstack([u8(cape), u8(hair), u8(a)]))          # OpenCV writes B, G, R
cv2.imwrite(out + '/marks.png', np.dstack([u8(ember), u8(ring), u8(fur)]))
print(json.dumps({'ring': [round(cx, 1), round(cy, 1), round(rx, 1), round(ry, 1)], 'points': int(len(P)), 'root': ROOT}))
vis = (im * 0.5).astype(np.uint8)
cv2.ellipse(vis, (int(cx), int(cy)), (int(rx), int(ry)), 0, 0, 360, (0, 255, 0), 1)
vis[..., 1] = np.maximum(vis[..., 1], u8(hair)); vis[..., 2] = np.maximum(vis[..., 2], u8(ring)); vis[..., 0] = np.maximum(vis[..., 0], u8(np.maximum(fur, ember)))
cv2.imwrite(out + '/masks-check.jpg', cv2.resize(vis, (1440, 810), interpolation=cv2.INTER_AREA))
