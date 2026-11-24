"""tall.py SRC.jpg FIGURE_RGBA.png EXTENDED.png OUT.jpg: the phone's picture. EXTENDED is tools/canvas.py's canvas
after the image model filled its blank top with more canopy (same size: 1088 x 1632, the painting's top edge at
row 896). OUT = those 896 new rows, then the painting's own columns 416..1504, all 1080 rows, untouched, except
that over the first rows the backdrop (not the figure) fades from the model's version into the painting's."""
import sys
import numpy as np, cv2
X0, W, BLANK, FADE = 416, 1088, 896, 40
im = cv2.imread(sys.argv[1]).astype(np.float32)
a = cv2.imread(sys.argv[2], cv2.IMREAD_UNCHANGED)[..., 3].astype(np.float32) / 255
ext = cv2.imread(sys.argv[3])[..., :3].astype(np.float32)
assert ext.shape[:2] == (1632, W), ext.shape
own = im[:, X0:X0 + W]
# the model's colours against the painting's, just under the join and away from the figure: match them
keep = cv2.dilate(a[:, X0:X0 + W], np.ones((61, 61), np.uint8))[:120] < 0.02
gain = np.array([own[:120][keep][:, c].mean() / ext[BLANK:BLANK + 120][keep][:, c].mean() for c in range(3)])
print('gain', gain.round(3))
ext *= gain
fig = cv2.GaussianBlur(cv2.dilate(a[:, X0:X0 + W], np.ones((9, 9), np.uint8)), (0, 0), 3)[:FADE, :, None]
w = (np.arange(FADE, dtype=np.float32) / FADE)[:, None, None]
w = np.maximum(w, np.clip(fig * 1.5, 0, 1))                       # the figure's own pixels are never mixed
own = own.copy()
own[:FADE] = ext[BLANK:BLANK + FADE] * (1 - w) + own[:FADE] * w
out = np.vstack([ext[:BLANK], own])
cv2.imwrite(sys.argv[4], np.clip(out, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 94])
print(out.shape)
