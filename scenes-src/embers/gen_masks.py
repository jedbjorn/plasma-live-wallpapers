#!/usr/bin/env python3
"""Generates masks.png (1280x720) for Embers from still.jpg.
Run from this folder:  python3 gen_masks.py      (needs Pillow + numpy)
  R = light map: soft luminance, where there is lit air/mist behind the trees
  G = occluder:  dark foreground silhouettes (trunks, branches), 1 = solid
  B = depth:     0 = near, 1 = far (tunnel geometry around the vanishing point + brightness)
"""
import numpy as np
from PIL import Image, ImageFilter

W, H = 1280, 720
VP = (0.502, 0.66)

im = Image.open('still.jpg').convert('RGB').resize((W, H), Image.LANCZOS)
a = np.asarray(im).astype(np.float32) / 255
lum = a.max(2)

def blur(x, r):
    return np.asarray(Image.fromarray((np.clip(x, 0, 1) * 255).astype('uint8'))
                      .filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255

def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

light = np.clip(blur(lum, 7) / 0.62, 0, 1)
occ = 1 - sstep(0.05, 0.20, blur(lum, 1.2))

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
u, v = xx / W, yy / H
dx, dy = (u - VP[0]) * 16 / 9, (v - VP[1])
r = np.sqrt(dx * dx + (dy * 1.5) ** 2)
geo = 1 - sstep(0.0, 0.85, r)
depth = blur(0.6 * geo + 0.4 * np.clip(blur(lum, 5) / 0.6, 0, 1), 9)
depth = (depth - depth.min()) / (depth.max() - depth.min())

out = np.stack([light, occ, depth], 2)
Image.fromarray((out * 255 + 0.5).astype('uint8')).save('masks.png', optimize=True)
print('masks.png written')
