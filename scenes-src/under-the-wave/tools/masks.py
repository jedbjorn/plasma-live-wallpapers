#!/usr/bin/env python3
"""Cut the medallion out of the source picture and make its silhouette.

  python3 tools/masks.py source.jpg      (run in scenes-src/under-the-wave/)

Writes still.png (the 1024x1024 crop at source pixel 1420,566) and sil.png (white where the print
is, its slate-coloured darks included).
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ORIGIN, SIZE, SLATE = (1420, 566), 1024, (46, 52, 64)
src = Image.open(sys.argv[1]).convert('RGB')
x0, y0 = ORIGIN
crop = src.crop((x0, y0, x0 + SIZE, y0 + SIZE))
crop.save('still.png', optimize=True)
a = np.asarray(crop).astype(int)
ink = np.abs(a - np.array(SLATE)).max(2) > 14
# The print's darks are the slate itself, so ink alone does not give the shape: close the gaps
# between dots, hooks and stripes first, then flood the slate from the corner (the hollow under the
# crest is open to the left, so it floods too).
K = 19
m = Image.fromarray((ink * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(K)).filter(ImageFilter.MinFilter(K))
ImageDraw.floodfill(m, (0, 0), 128)
sil = Image.fromarray(((np.asarray(m) != 128) * 255).astype(np.uint8))
sil.save('sil.png', optimize=True)
print('print pixels:', int((np.asarray(sil) > 0).sum()))
