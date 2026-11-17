#!/usr/bin/env python3
"""Generate the helper texture for Avenue Flow (run from anywhere):
     python3 scenes-src/avenue-flow/tools/make_masks.py
   Reads ../still.jpg (never modified), writes next to it:
   lights.png  (half res RGB) the picture's own light sources isolated on black:
               small bright/warm features = image minus a blurred background, soft-thresholded.
   lamps.png   (half res RGB) one value per light blob, so every pixel of a blob twinkles together:
               the connected components of lights.png (joined across 2 px gaps) are labelled; R and G are two random phases per
               component (fixed seed), B is "lampness": 255 for point-sized lamps, falling to 0 for large
               lit roofs and facades (which only get a gentle swell). Labels are grown ~14 px outward so a
               lamp's halo shares its phase; B fades to 0 across that ring.
   Needs Pillow + numpy only."""
import os
import numpy as np
from PIL import Image, ImageFilter
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.dirname(here)
src = os.path.join(out, 'still.jpg')
im = Image.open(src).convert('RGB')
W, H = im.size
a = np.asarray(im).astype(np.float32)

# ---- lights.png ----
bg = np.asarray(im.filter(ImageFilter.GaussianBlur(14))).astype(np.float32)
lum = a.max(2); bl = bg.max(2)
diff = lum - bl
warm = a[..., 0] - a[..., 2]
# small + clearly brighter than surroundings, and either really bright or warm coloured
m = np.clip((diff - 44) / 40, 0, 1) * np.clip(np.maximum((lum - 150) / 50, (warm - 28) / 30), 0, 1)
# also keep saturated red/orange lights that are not much brighter than a lit neighbourhood
m = np.maximum(m, np.clip((warm - 70) / 40, 0, 1) * np.clip((diff - 15) / 25, 0, 1))
m[: int(H * 0.30)] = 0                       # nothing in the sky
mi = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.6))
m = np.clip(np.asarray(mi).astype(np.float32) / 255 * 1.6, 0, 1)
layer = np.clip(a - bg, 0, 255) * m[..., None]
half = Image.fromarray(layer.astype(np.uint8)).resize((W // 2, H // 2), Image.LANCZOS)
half.save(os.path.join(out, 'lights.png'), optimize=True)

# ---- lamps.png ----
core = np.asarray(half).max(2) > 22
# components are found on a slightly lower threshold grown by 2 px, so the fragments of one lit roof
# join into a single blob while separate street lamps stay separate
lit = np.asarray(Image.fromarray(((np.asarray(half).max(2) > 12) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 0
h2, w2 = lit.shape
# connected components (4-neighbour) by union-find over horizontal runs
parent = []
def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]; i = parent[i]
    return i
runs = []                       # (row, x0, x1, id)
prev = []
for y in range(h2):
    row = lit[y]
    d = np.diff(np.concatenate(([0], row.view(np.int8), [0])))
    starts, ends = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]
    cur = []
    j = 0
    for x0, x1 in zip(starts, ends):
        i = len(parent); parent.append(i)
        while j < len(prev) and prev[j][1] <= x0: j += 1
        k = j
        while k < len(prev) and prev[k][0] < x1:
            ra, rb = find(prev[k][2]), find(i)
            if ra != rb: parent[max(ra, rb)] = min(ra, rb)
            k += 1
        cur.append((x0, x1, i)); runs.append((y, x0, x1, i))
    prev = cur
roots = {}
labels = np.zeros((h2, w2), np.int32)
for (y, x0, x1, i) in runs:
    r = find(i)
    lab = roots.setdefault(r, len(roots) + 1)
    labels[y, x0:x1] = lab
n = len(roots)
area = np.bincount(labels.ravel(), minlength=n + 1).astype(np.float32)
ys, xs = np.nonzero(labels)
lab = labels[ys, xs]
x0 = np.full(n + 1, 1e9); x1 = np.full(n + 1, -1.0); y0 = np.full(n + 1, 1e9); y1 = np.full(n + 1, -1.0)
np.minimum.at(x0, lab, xs); np.maximum.at(x1, lab, xs); np.minimum.at(y0, lab, ys); np.maximum.at(y1, lab, ys)
extent = np.maximum(x1 - x0, y1 - y0) + 1
# point lamp: small in area and in extent (half-res px); big roof/facade highlights fall to 0
lampness = np.clip((420 - area) / 260, 0, 1) * np.clip((46 - extent) / 24, 0, 1)
lampness[0] = 0.0                # unlabelled background: no twinkle
rng = np.random.default_rng(20261117)
ph1 = rng.integers(0, 256, n + 1); ph2 = rng.integers(0, 256, n + 1)
# grow labels outward into unlit pixels (nearest-ish component wins) so halos follow their lamp
grown = labels.copy()
step = np.zeros(labels.shape, np.float32)          # how many px outside its blob a pixel is
for it in range(1, 15):
    p = np.pad(grown, 1)
    nb = np.maximum.reduce([p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]])
    new = (grown == 0) & (nb > 0)
    step[new] = it
    grown = np.where(grown == 0, nb, grown)
# lampness fades to 0 across the grown ring, so a halo's twinkle has no edge where the label ends
fall = np.clip((14 - step) / 10, 0, 1)
fall = np.asarray(Image.fromarray((fall * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))).astype(np.float32) / 255
fall = np.where(labels > 0, 1.0, fall)
lam = np.stack([ph1[grown], ph2[grown], (lampness[grown] * fall * 255)], 2).astype(np.uint8)
Image.fromarray(lam).save(os.path.join(out, 'lamps.png'), optimize=True)
print('ok: %d light blobs, %d point lamps, %d large' % (n, int((lampness[1:] > 0.5).sum()), int((lampness[1:] < 0.05).sum())))
