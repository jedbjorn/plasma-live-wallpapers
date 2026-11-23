"""plate.py IN OUT W H SUNX SUNY: scale and crop a background painting to W x H so that its sunburst (the brightest
place in it) sits at SUNX, SUNY (shares of the width and height), enlarging it as little as that takes."""
import sys
import numpy as np
from PIL import Image, ImageFilter
src, out, W, H, sx, sy = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6])
im = Image.open(src).convert('RGB')
g = np.asarray(im.convert('L').filter(ImageFilter.GaussianBlur(im.width / 25))).astype(np.float32)
cy, cx = np.unravel_index(int(g.argmax()), g.shape)
u, v = cx / im.width, cy / im.height                       # where the sun is in the painting
k = max(W / im.width, H / im.height)
while True:                                                # grow until the crop that puts the sun right fits inside
    w, h = round(im.width * k), round(im.height * k)
    x0, y0 = u * w - sx * W, v * h - sy * H
    if 0 <= x0 <= w - W and 0 <= y0 <= h - H: break
    k *= 1.01
im.resize((w, h), Image.LANCZOS).crop((round(x0), round(y0), round(x0) + W, round(y0) + H)).save(out, quality=93)
print(out, 'sun found at', round(u, 3), round(v, 3), 'enlarged', round(k, 2))
