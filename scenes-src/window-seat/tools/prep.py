#!/usr/bin/env python3
"""prep.py still.jpg OUTDIR: turn the 1620x1040 picture (4 px art pixels) into the scene's native assets.
  bg.png    405x260, the cat painted out (sill, water, lamps and mullion rebuilt from the neighbours)
"""
import sys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
a = np.asarray(Image.open(src).convert('RGB')).astype(float)
H, W = a.shape[0] // 4, a.shape[1] // 4
n = np.median(a.reshape(H, 4, W, 4, 3)[:, 1:3, :, 1:3, :].transpose(0, 2, 1, 3, 4).reshape(H, W, 4, 3), axis=2)
n = n.round().astype(np.uint8)
orig = n.copy()

# the cat: the very dark navy blob on the sill, grown by one pixel to take its soft edge too
lum = n.astype(int).sum(axis=2)
m = np.zeros((H, W), bool)
m[162:211, 226:340] = lum[162:211, 226:340] < 112
m[160:205, 288:296] &= False                      # the mullion above the cat's back is not cat
m[185:205, 291:296] = lum[185:205, 291:296] < 75
cat = m.copy()
g = m.copy()
g[1:] |= m[:-1]; g[:-1] |= m[1:]; g[:, 1:] |= m[:, :-1]; g[:, :-1] |= m[:, 1:]
g[211:] = False

def clone(mask, dx, dy=0):
    ys, xs = np.nonzero(mask)
    n[ys, xs] = n[ys + dy, xs + dx]

# 1. glass left of the mullion: the lamps along the quay repeat every 29 px, so take the view 87 px to the right
r = g.copy(); r[:, 275:] = False; r[208:] = False
clone(r, 87)
# 2. the strip next to the mullion: from what was just rebuilt, one period to the left
r = g.copy(); r[:, :275] = False; r[:, 287:] = False; r[208:] = False
clone(r, -29)
# 3. the mullion itself: its own columns from higher up
for x in range(287, 294):
    col = np.median(orig[120:176, x].astype(float), axis=0)
    for y in range(176, 208):
        n[y, x] = col
# 4. glass right of the mullion: one period to the right
r = g.copy(); r[:, :294] = False; r[208:] = False
clone(r, 29)
# 5. bottom rail of the frame (rows 208..210): repeat a clean stretch of it
# and the last rows of glass above it, where every neighbour is under the cat's tail too
for y in range(203, 211):
    for x in range(224, 342):
        if g[y, x] and not (y < 208 and 287 <= x < 294):
            n[y, x] = orig[y, 342 + (x - 224) % 24]
Image.fromarray(n).save(out + '/bg.png')
