"""How this scene's pictures are made (made with a local image model, Qwen-Image, and a local image-to-video model, Wan 2.2):

  still.jpg            the picture it all comes from: a photograph of the statue, its sky replaced by blue, white and
                       red smoke, then repainted as a devotional image (Qwen-Image edits). 672 x 1536.
  statue.png           the figure cut out of still.jpg enlarged to 1080 x 2400 (bottom rows kept), with a segmentation
                       model (rembg, birefnet-general)
  vest.png             python3 tools/vestmask.py statue.png vest.png
  plate-*.jpg          the smoke and the sunburst without her: Qwen-Image edits of still.jpg (figure removed; smoke
                       made darker and sootier; for the wide one, extended sideways), then
                       python3 tools/plate.py PAINTING plate-portrait.jpg 1080 2400 0.547 0.44
                       python3 tools/plate.py PAINTING plate-landscape.jpg 2560 1440 0.514 0.328
  motion.png           three Wan image-to-video clips (121 frames, 480 x 832) of the crop named in tools/flowatlas.py,
                       the cloth streaming in a strong wind, then
                       python tools/flowatlas.py statue.png vest.png motion.png 121 CLIP1 CLIP2 CLIP3
                       and its printed numbers copied into index.html
"""
# vestmask.py STATUE_RGBA OUT: R = where the yellow cloth is (with its lettering and strips), G = how free it is
# (a little on her chest, 1 at the tips of the cloth flying out to the left), B unused.
import sys
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
a = np.asarray(Image.open(sys.argv[1]).convert('RGBA')).astype(np.float32)
R, G, B, A = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
yellow = (B < 0.5 * R) & (R > 105) & (G > 0.62 * R) & (A > 128)
m = Image.fromarray((yellow * 255).astype(np.uint8))
m = m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))                    # drop specks
c = m.filter(ImageFilter.MaxFilter(41)).filter(ImageFilter.MinFilter(41)).copy()           # close the lettering
ys, xs = np.nonzero(np.asarray(m) > 0)
ImageDraw.floodfill(c, (int(np.median(xs)), int(np.median(ys))), 128)
# the key misses cloth in deep shade: add its outline, drawn by hand (pixels of the 1080 x 2400 picture)
POLY = [(440, 1215), (600, 1225), (815, 1265), (850, 1500), (862, 1665), (700, 1645), (600, 1700), (480, 1765),
        (340, 1995), (200, 2095), (70, 2095), (50, 1990), (120, 1900), (150, 1805), (58, 1795), (45, 1700), (150, 1640),
        (330, 1560), (390, 1450), (410, 1300)]
pm = Image.new('L', c.size, 0)
ImageDraw.Draw(pm).polygon(POLY, fill=255)
keep = ((np.asarray(c) == 128) | (np.asarray(pm) > 0)) & (A > 128)
r = np.asarray(Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2)))
H, W = r.shape
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
free = 0.10 + 0.90 * ss(640, 150, xx) * ss(1480, 1640, yy)
g = (np.clip(free, 0, 1) * 255).astype(np.uint8)
Image.fromarray(np.dstack([r, g, np.zeros_like(r)]), 'RGB').save(sys.argv[2])
ys, xs = np.nonzero(keep)
print('cloth box', xs.min(), ys.min(), xs.max(), ys.max())
