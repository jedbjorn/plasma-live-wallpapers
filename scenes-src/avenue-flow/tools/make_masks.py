#!/usr/bin/env python3
"""Generate the helper texture for Avenue Flow (run from anywhere):
     python3 scenes-src/avenue-flow/tools/make_masks.py
   Reads ../still.jpg (never modified), writes next to it:
   lights.png  (half res RGB) the picture's own light sources isolated on black:
               small bright/warm features = image minus a blurred background, soft-thresholded.
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
Image.fromarray(layer.astype(np.uint8)).resize((W // 2, H // 2), Image.LANCZOS).save(
    os.path.join(out, 'lights.png'), optimize=True)
print('ok')
