#!/usr/bin/env python3
"""Generate the mask textures for The Surge from still.jpg.

Run from this folder:  python3 gen_masks.py      (needs Pillow + numpy)

Outputs (1920x1200, same framing as the picture):
  masks.png  R = subject (the boy: hair, face, shirt; holes filled)
             G = glow lines (eyes + the white cracks on the face/hair)
             B = debris weight (dark rocks/shards in the background, dilated + feathered)
  wide.jpg   R = aura very wide blur, G = debris tight, B = subject dilated+blurred (parallax depth)
  soft.jpg   R = bloom (glow lines, wide blur)
             G = aura (the white flame around the boy, slightly feathered)
             B = subject, wide blur (cheap "depth" for parallax)
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1920, 1200
src = Image.open('still.jpg').convert('L').resize((W, H), Image.LANCZOS)
lum = np.asarray(src, dtype=np.float32) / 255.0
lumb = np.asarray(src.filter(ImageFilter.GaussianBlur(3)), dtype=np.float32) / 255.0

def img(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), 'L')
def arr(i):
    return np.asarray(i, dtype=np.float32) / 255.0
def smooth(a, lo, hi):
    x = np.clip((a - lo) / (hi - lo), 0, 1)
    return x * x * (3 - 2 * x)

# --- subject: flood fill the non-white region from a seed on the face -------------
dark = img((lumb < 0.80).astype(np.float32))
dark = dark.filter(ImageFilter.MinFilter(3))            # cut hairline bridges into the background
ff = dark.copy()
ImageDraw.floodfill(ff, (960, 560), 128, thresh=10)     # seed: neck
subj = img((np.asarray(ff) == 128).astype(np.float32))
subj = subj.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.MinFilter(13))  # close cracks/eyes
# fill remaining holes: anything not reachable from the border is inside
inv = subj.copy()
pad = Image.new('L', (W + 2, H + 2), 0); pad.paste(inv, (1, 1))
ImageDraw.floodfill(pad, (0, 0), 128, thresh=10)
subj_a = (np.asarray(pad.crop((1, 1, W + 1, H + 1))) != 128).astype(np.float32)
subj_soft = arr(img(subj_a).filter(ImageFilter.GaussianBlur(1.5)))

# --- glow lines: bright pixels well inside the subject -----------------------------
inner = arr(img(subj_a).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.GaussianBlur(2)))
glow = smooth(lum, 0.55, 0.9) * inner
# only the head/neck area carries cracks; the shirt has bright halftone we must not light up
yy, xx = np.mgrid[0:H, 0:W]
head = smooth(-(yy.astype(np.float32)), -640, -590)
glow = glow * head
# the closing above also swallowed slivers of aura between the hair spikes; they are not cracks.
# Find white that is connected to the outside once thin lines (the cracks) are eroded away, and drop it.
br = img((lumb > 0.6).astype(np.float32)).filter(ImageFilter.MinFilter(5))
padb = Image.new('L', (W + 2, H + 2), 255); padb.paste(br, (1, 1))
ImageDraw.floodfill(padb, (0, 0), 128, thresh=10)
intr = img((np.asarray(padb.crop((1, 1, W + 1, H + 1))) == 128).astype(np.float32))
intr = arr(intr.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.GaussianBlur(1.5)))
glow = glow * (1 - intr)
glow_i = img(glow).filter(ImageFilter.GaussianBlur(0.8))

# --- debris: dark blobs outside the subject -----------------------------------------
outside = 1 - arr(img(subj_a).filter(ImageFilter.MaxFilter(31)).filter(ImageFilter.GaussianBlur(6)))
deb = smooth(-lumb, -0.36, -0.22) * outside
deb_w = img(deb).filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(14))

# --- aura: white flame outside the subject ------------------------------------------
aura = smooth(lumb, 0.72, 0.93) * (1 - subj_soft)
aura_i = img(aura).filter(ImageFilter.GaussianBlur(4))

bloom = arr(glow_i.filter(ImageFilter.GaussianBlur(26))) * 3.2 + arr(glow_i.filter(ImageFilter.GaussianBlur(7))) * 0.8
depth = img(subj_a).filter(ImageFilter.GaussianBlur(24))

Image.merge('RGB', (img(subj_soft), glow_i, deb_w)).save('masks.png', optimize=True)
Image.merge('RGB', (img(bloom), aura_i, depth)).save('soft.jpg', quality=90)

# wide.jpg: R = aura, very wide blur (where extra flame may live)
#           G = debris, tight (for shading the rocks themselves)
#           B = subject dilated then blurred (parallax depth that is 1 over the whole figure incl. its edge)
aura_w = arr(aura_i.filter(ImageFilter.GaussianBlur(45))) * 1.6
deb_t = img(deb).filter(ImageFilter.GaussianBlur(2))
depth2 = img(subj_a).filter(ImageFilter.MaxFilter(41)).filter(ImageFilter.GaussianBlur(10))
Image.merge('RGB', (img(aura_w), deb_t, depth2)).save('wide.jpg', quality=90)
print('ok')
