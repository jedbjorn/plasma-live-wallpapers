"""canvas.py SRC.jpg FIGURE_RGBA.png OUT.png: the canvas for extending the backdrop upward (for the phone layout).
The figure is painted out first (roughly: only the backdrop goes to the image model). The picture's columns
X0..X0+W and rows 0..KEEP sit at the bottom; above them BLANK rows of flat grey for the model to fill with more of
the same canopy and fog."""
import sys
import numpy as np, cv2
X0, W, KEEP, BLANK = 416, 1088, 736, 896
im = cv2.imread(sys.argv[1])
a = cv2.imread(sys.argv[2], cv2.IMREAD_UNCHANGED)[..., 3]
hole = cv2.dilate((a > 8).astype(np.uint8), np.ones((41, 41), np.uint8))
# the red ring of sparks goes too: it belongs to her, and would be continued upward as an arc
b, g, r = [im[..., i].astype(np.int32) for i in range(3)]
red = ((r > 90) & (r > 1.5 * g) & (r > 1.5 * b)).astype(np.uint8)
hole |= cv2.dilate(red, np.ones((15, 15), np.uint8))
small = cv2.resize(im, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
sh = cv2.resize(hole, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
fill = cv2.inpaint(small, sh * 255, 9, cv2.INPAINT_TELEA)
fill = cv2.GaussianBlur(cv2.resize(fill, (im.shape[1], im.shape[0]), interpolation=cv2.INTER_CUBIC), (0, 0), 6)
fill = np.clip(fill.astype(np.float32) + np.random.default_rng(1).normal(0, 3.0, fill.shape), 0, 255)
w = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 8)[..., None]
bg = (im * (1 - w) + fill * w).astype(np.uint8)
cv2.imwrite(sys.argv[3].replace('.png', '-bg.png'), bg)
out = np.full((BLANK + KEEP, W, 3), 128, np.uint8)
out[BLANK:] = bg[:KEEP, X0:X0 + W]
cv2.imwrite(sys.argv[3], out)
print(out.shape)
