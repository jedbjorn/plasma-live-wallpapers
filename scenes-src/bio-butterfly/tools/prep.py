#!/usr/bin/env python3
"""prep.py: cut ../still.jpg (1920x1080) into the scene's layers. Run from anywhere:
    python3 scenes-src/bio-butterfly/tools/prep.py

  plate.png   the picture without the butterfly and without the head: the finger rebuilt where the
              butterfly stood and its shadow lay, the butterfly's blue light taken off the hand, the neck
              continued up under the jaw
  hand.png    the hand (HAND box) twice, one above the other: with the butterfly's light but no shadow,
              and as painted (light and the shadow under the butterfly)
  wing.png    one side's pair of wings as a flat sheet, premultiplied RGBA (see WSHEET)
  head.png    the head (HEAD box), premultiplied RGBA
  headB.png   the head with her far cheek painted on, for when she has turned to the viewer
  band.png    for that turn (HEAD box): R = how soon the new cheek shows, G = the dark it comes out of,
              B = the far cheek and jaw (what the scene trims to the line it keeps there)
  depth.png   the head's depth for the turn (HEAD box): R,G = 16 bit depth, B = hair that sways
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
W, H = 1920, 1080

src = np.asarray(Image.open(os.path.join(OUT, 'still.jpg')).convert('RGB')).astype(np.float32)
lum = src.sum(2) / 3
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)


def blur(a, s):
    """gaussian blur of a float array (any range), one or three channels"""
    if a.ndim == 3:
        return np.dstack([blur(a[..., i], s) for i in range(a.shape[2])])
    r = int(3 * s) + 1
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / s) ** 2)
    k /= k.sum()
    p = np.pad(a.astype(np.float32), r, mode='edge')
    p = np.apply_along_axis(lambda v: np.convolve(v, k, mode='valid'), 1, p)
    return np.apply_along_axis(lambda v: np.convolve(v, k, mode='valid'), 0, p).astype(np.float32)


def grow(m, r):
    return np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * r + 1))) > 127


def shrink(m, r):
    return np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(2 * r + 1))) > 127


def poly(pts):
    im = Image.new('L', (W, H), 0)
    ImageDraw.Draw(im).polygon(pts, fill=255)
    return np.asarray(im) > 127


def smooth(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def save(name, a):
    Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8)).save(os.path.join(OUT, name), optimize=True)


# ------------------------------------------------------------------ the butterfly and the finger under it
# top edge of the finger and the hand, read off the picture: everything above it near the butterfly is butterfly
TOP = [(1040, 430), (1117, 430), (1118, 431), (1135, 431), (1136, 433), (1175, 433), (1176, 437), (1179, 437),
       (1180, 440), (1181, 441), (1197, 441), (1198, 442), (1201, 442), (1202, 443), (1204, 444), (1206, 446),
       (1208, 447), (1210, 448), (1212, 450), (1214, 452), (1216, 453), (1218, 455), (1220, 456), (1240, 460)]
top = np.interp(np.arange(W), [p[0] for p in TOP], [p[1] for p in TOP])
fly = (xx >= 1040) & (xx <= 1240) & (yy >= 280) & (yy < top[None, :].repeat(H, 0))

plate = src.copy()
plate[fly] = 0

# the shadow the butterfly casts on the finger: rows from the top edge down to the lit band. Rebuilt per column
# from the unshadowed finger to its left (same distance below the edge) fading into the column's own lit band.
lit = src.copy()
ktop = top.copy()                                             # the rebuilt edge runs smoothly down to the knuckle
ktop[1150:1201] = np.interp(np.arange(1150, 1201), [1150, 1165, 1180, 1192, 1200], [433, 434.3, 437.3, 440.4, 442])
REFX = np.arange(1120, 1131)                                  # clean columns, top edge at 431
ref = np.array([src[431 + k, REFX].mean(0) for k in range(14)])   # colour k rows below the edge
for x in range(1131, 1201):
    e = ktop[x]                                                # the edge, fractional
    bot = max(443, int(round(top[x])) + 2)                     # first row that is fully lit
    own = src[bot:bot + 2, x].mean(0)
    w = smooth(1131, 1150, x)                                  # how much of the column was in shadow
    for y in range(int(np.floor(min(e, top[x]))) - 2, bot):
        k = y - e
        f = np.clip((y + 0.5 - e) / (bot - e), 0, 1)
        c = ref[int(np.clip(round(k + 0.5), 0, 13))] * (1 - f) + own * f
        c = c * np.clip(y + 1 - e, 0, 1)                       # antialiased edge
        lit[y, x] = src[y, x] * (1 - w) + c * w
m = np.zeros((H, W), bool)
m[428:446, 1131:1202] = True
sm = lit.copy()
sm[420:452, 1120:1210] = blur(lit[420:452, 1120:1210], 0.8)
lit[m] = sm[m]
lit[fly] = 0

# the butterfly's light on the hand: strongest on the finger it stands on. Without it the skin there is the
# pale grey-green of the rest of her.
d = np.hypot(xx - 1160, (yy - 440) * 1.25)
near = 1 - smooth(55, 150, d)
cyan = np.clip((lit[..., 2] - lit[..., 0]) / 90, 0, 1)        # how blue-green a pixel is
l = lit.sum(2) / 3
pale = np.dstack([l * 0.97, l * 1.02, l * 0.84]) * 0.66
k = (near * (0.25 + 0.75 * cyan))[..., None]
unlit = lit * (1 - k) + pale * k
unlit[fly] = 0

HAND = (1088, 416, 1288, 536)                                 # x0, y0, x1, y1
hx0, hy0, hx1, hy1 = HAND
plate[hy0:hy1, hx0:hx1] = unlit[hy0:hy1, hx0:hx1]
hand = np.vstack([lit[hy0:hy1, hx0:hx1], np.where(fly[..., None], 0, src)[hy0:hy1, hx0:hx1]])
save('hand.png', hand)

# ------------------------------------------------------------------ the wings
# The butterfly in the picture: heading 30 degrees towards the viewer, its near pair of wings 75 degrees up
# from level, the far pair 52. Both pairs are the same flat sheet; it is read off the near pair by undoing
# that view. Sheet coordinates: u forward along the body, v out from the hinge, origin at the wing root
# (picture 1163, 407); wing.png covers WSHEET at WRES texels per unit.
ROOT = (1163.0, 407.0)
PSI0, PHI_NEAR = np.radians(30), np.radians(75)
WSHEET = (-138.0, -8.0, 62.0, 128.0)                          # u0, v0, u1, v1
WRES = 4
blue = src[..., 2] - src[..., 0]
memb = (blue > 26) & (xx >= 1046) & (xx < 1198) & (yy >= 286) & (yy < 414)   # the coloured membrane
# the far wing shows right of the near one: cut along the near wing's front edge
front = np.interp(yy, [286, 294, 300, 330, 360, 384, 400, 414], [1164, 1171, 1177, 1181, 1180, 1177, 1171, 1166])
memb &= xx < front
memb = shrink(grow(memb, 2), 2)                               # close the dark veins
wa = blur(grow(memb, 2).astype(np.float32), 1.0) * (xx < front + 1.5)          # the wing with its black rim
wc = src * np.where(grow(memb, 1), 1.0, 0.25)[..., None]      # the faint drawn outline around it goes dark
wrgba = np.dstack([wc * wa[..., None], wa * 255])
nu, nv = int((WSHEET[2] - WSHEET[0]) * WRES), int((WSHEET[3] - WSHEET[1]) * WRES)
uu = WSHEET[0] + (np.arange(nu) + 0.5) / WRES
vv = WSHEET[3] - (np.arange(nv) + 0.5) / WRES                 # v up = row 0
U_, V_ = np.meshgrid(uu, vv)
sx = ROOT[0] + U_ * np.cos(PSI0) - V_ * np.cos(PHI_NEAR) * np.sin(PSI0)
sy = ROOT[1] - V_ * np.sin(PHI_NEAR)
x0, y0 = np.floor(sx).astype(int), np.floor(sy).astype(int)
fx, fy = (sx - x0)[..., None], (sy - y0)[..., None]
x0, y0 = np.clip(x0, 0, W - 2), np.clip(y0, 0, H - 2)
wing = (wrgba[y0, x0] * (1 - fx) * (1 - fy) + wrgba[y0, x0 + 1] * fx * (1 - fy)
        + wrgba[y0 + 1, x0] * (1 - fx) * fy + wrgba[y0 + 1, x0 + 1] * fx * fy)
wing = blur(wing, 1.9)                                        # 4x magnified: smooth the stair steps
save('wing.png', wing)

# ------------------------------------------------------------------ the head
# CUT: everything of the head lies inside it; it follows the jaw where the head meets the neck and stays in
# the black elsewhere. SOLID: the head's own outline (the hair is as black as the background, so it cannot
# be keyed), a little inside the drawn outline; strands outside it are keyed by their brightness.
JAW = [(1549, 438), (1561, 430), (1571, 420), (1583, 410), (1591, 400), (1598, 380), (1602, 360), (1604, 335)]
CUT = [(1335, 45), (1790, 45), (1790, 434), (1700, 434), (1658, 428), (1642, 408), (1628, 404), (1628, 340),
       (1618, 338)] + JAW[::-1] + [(1541, 441), (1500, 441), (1430, 432), (1335, 432)]
SOLID = [(1468, 108), (1440, 126), (1420, 141), (1402, 159), (1388, 175), (1375, 195), (1366, 218), (1362, 245),
         (1366, 285), (1380, 300), (1392, 300), (1397, 340), (1412, 370), (1437, 400), (1465, 420), (1500, 435),
         (1541, 439)] + JAW + [(1618, 338), (1628, 340), (1630, 368), (1642, 380), (1655, 392), (1668, 378),
         (1682, 392), (1692, 382), (1702, 396), (1714, 384), (1722, 378), (1734, 345), (1744, 318), (1738, 290),
         (1728, 262), (1724, 225), (1708, 196), (1692, 168), (1672, 150), (1650, 140), (1640, 110), (1560, 95),
         (1500, 98)]
cut = poly(CUT)
key = smooth(3, 16, blur(lum, 0.6))
alpha = np.maximum(blur(poly(SOLID).astype(np.float32), 0.7), key) * blur(cut.astype(np.float32), 0.6)
alpha[~grow(cut, 1)] = 0

HEAD = (1330, 44, 1790, 444)
kx0, ky0, kx1, ky1 = HEAD
head = np.dstack([src * alpha[..., None], alpha * 255])[ky0:ky1, kx0:kx1]
save('head.png', head)

# the plate without the head: black, and the neck continued up behind the jaw (it shows when the chin lifts)
plate[grow(cut, 1)] = 0
jx = np.interp(np.arange(H), [p[1] for p in JAW[::-1]], [p[0] for p in JAW[::-1]])
fill = np.zeros_like(plate)
for y in range(326, 444):
    xj = jx[min(max(y, 335), 438)]
    c = src[min(max(y, 338), 436), int(xj) + 3:int(xj) + 8].mean(0)
    fill[y, 1500:int(xj) + 6] = c
fill[300:470, 1490:1640] = blur(fill[300:470, 1490:1640], 5)
edge = 1541 - 0.10 * (441 - yy)                               # the neck's left side, straight up from where it shows
under = grow(cut, 1) & (yy >= 326) & (yy < 444) & (xx > 1500) & (xx < 1612)
plate[under] = (fill * (0.5 + 0.35 * smooth(0, 60, xx - edge))[..., None] * np.clip(xx - edge + 0.5, 0, 1)[..., None]
                * smooth(326, 348, yy)[..., None])[under]

# depth of the head (towards the viewer, in picture pixels), for turning it. In the head's own frame (it leans
# 15 degrees towards the butterfly): a to her left (picture right), b down to the chin, origin at the middle of
# the skull. The face's far edge in the picture is the edge of an egg: half width 140, 180 up, 154.5 down; the
# egg used is 11 wider on the far side, so that the painted edge itself comes round when she turns.
ROLL = np.radians(15)
CX, CY = 1525.0, 285.0
a_ = (xx - CX) * np.cos(ROLL) - (yy - CY) * np.sin(ROLL)
b_ = (xx - CX) * np.sin(ROLL) + (yy - CY) * np.cos(ROLL)
A = np.where(a_ < 0, 151.0, 118.0)
Bh = np.where(b_ < 0, 180.0, 154.5)
r = np.sqrt((a_ / A) ** 2 + (b_ / Bh) ** 2)
N, RZ = 2.5, 150.0
z = RZ * np.clip(1 - np.minimum(r, 1) ** N, 0, 1) ** (1 / N)
out = np.maximum(r - 1, 0) * np.hypot(a_, b_) / np.maximum(r, 1e-3)      # how far outside the egg, in pixels
z = np.where(r > 1, -np.minimum(0.8 * out, 90), z)
z = blur(z, 2.5)


def bump(x, y, sx, sy, h, rot=0.0):
    c, s_ = np.cos(rot), np.sin(rot)
    u = (xx - x) * c + (yy - y) * s_
    v = -(xx - x) * s_ + (yy - y) * c
    return h * np.exp(-0.5 * ((u / sx) ** 2 + (v / sy) ** 2))


z += bump(1462, 344, 13, 12, 26)                   # tip of the nose
z += bump(1457, 322, 9, 16, 10)                    # its bridge
z += bump(1512, 293, 26, 17, -9)                   # eye sockets
z += bump(1421, 320, 17, 17, -7)
z += bump(1489, 386, 26, 11, 6, -0.17)             # lips
z += bump(1492, 420, 30, 14, 5)                    # chin
# hair that sways: loose strands outside the skull, more towards their tips
sway = (smooth(0, 40, out) * smooth(150, 330, yy) * (1 - smooth(55, 75, 135 - yy)))[ky0:ky1, kx0:kx1]


def sample(img, x, y):
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    if img.ndim == 3:
        fx, fy = fx[..., None], fy[..., None]
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy)
            + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)


# ------------------------------------------------------------------ her far cheek, for when she faces the viewer
# Where a point of the head (picture x, y and depth) is once she has turned: the same turn as scene.js makes
# (headMatrix) with story.js's full turn. Keep the three in step.
TURN = dict(yaw=27.0, pitch=3.2, roll=6.5)
CEN3, NECK3 = np.array([CX, CY, 0.0]), np.array([1585.0, 440.0, 0.0])


def rod(k, a):
    x, y, z_ = k
    c, s_, v = np.cos(a), np.sin(a), 1 - np.cos(a)
    return np.array([[c + x * x * v, x * y * v - z_ * s_, x * z_ * v + y * s_], [y * x * v + z_ * s_, c + y * y * v, y * z_ * v - x * s_],
                     [z_ * x * v - y * s_, z_ * y * v + x * s_, c + z_ * z_ * v]])


R1 = rod((np.sin(ROLL), np.cos(ROLL), 0), np.radians(TURN['yaw'])) @ rod((np.cos(ROLL), -np.sin(ROLL), 0), np.radians(TURN['pitch']))
R2 = rod((0, 0, 1), np.radians(TURN['roll']))


def turned(x, y, dep):
    q = (np.stack([x, y, dep], -1) - CEN3) @ R1.T + CEN3 - NECK3
    return (q @ R2.T + NECK3)[..., :2]


# The turned face has a middle line (between the eyes, at right angles to them). Every turned point is so far
# down it (h, from the eyes) and so far out from it (w). Her near cheek and jaw, as painted, give the face's
# half width at every h: WIDE(h). The far side is sculpted against that.
eyes = turned(np.array([1421.0, 1512.0]), np.array([320.0, 293.0]), sample(z, np.array([1421.0, 1512.0]), np.array([320.0, 293.0])))
MID = eyes.mean(0)
EX = (eyes[1] - eyes[0]) / np.hypot(*(eyes[1] - eyes[0]))
DN = np.array([-EX[1], EX[0]])
NEAR = [(1611, 262), (1612, 280), (1610, 300), (1606, 320), (1604, 335), (1602, 360), (1598, 380), (1591, 400),
        (1583, 410), (1571, 420), (1561, 430), (1549, 438), (1541, 440), (1520, 438)]
nr = np.array(NEAR, np.float32)
tn = np.linspace(0, 1, 400)
nx, ny = np.interp(tn, np.linspace(0, 1, len(nr)), nr[:, 0]), np.interp(tn, np.linspace(0, 1, len(nr)), nr[:, 1])
nl = turned(nx, ny, sample(z, nx, ny)) - MID
nh, nw = nl @ DN, nl @ EX
keep = np.r_[True, np.diff(np.maximum.accumulate(nh)) > 0]
WIDE = lambda h: np.interp(h, nh[keep], nw[keep])

# The far edge of her face in the picture, from the forehead round to the chin. The new cheek starts at TOP.
FARC = [(1398, 205), (1397, 232), (1396, 258), (1394, 286), (1392, 300), (1394, 320), (1397, 340), (1404, 357), (1412, 370), (1424, 386),
        (1437, 400), (1450, 411), (1465, 420), (1482, 429), (1500, 435), (1520, 438), (1541, 440)]
EXT = 10.0                                                    # the band of new cheek painted outside it, in the picture
fc = np.array(FARC, np.float32)
seg = np.r_[0, np.cumsum(np.hypot(*np.diff(fc, axis=0).T))]
tt_ = np.arange(0, seg[-1], 0.5)
cpts = np.c_[np.interp(tt_, seg, fc[:, 0]), np.interp(tt_, seg, fc[:, 1])]
dd_ = np.gradient(cpts, axis=0)
dd_ /= np.hypot(dd_[:, 0], dd_[:, 1])[:, None]
nrm = np.c_[dd_[:, 1], -dd_[:, 0]]                            # into the face
zc = sample(z, cpts[:, 0], cpts[:, 1])                        # the edge's own depth
ch = (turned(cpts[:, 0], cpts[:, 1], zc) - MID) @ DN          # and where it lands
cw = -(turned(cpts[:, 0], cpts[:, 1], zc) - MID) @ EX
TOP, S0, CHIN = seg[2], seg[4], seg[13]                       # along the edge: the temple, where the hair above stops
                                                              # hanging outside it, and the corner of the chin

# the skin's colour along the edge: 9 pixels inside, bridged where that is in the eye's shadow, and smoothed
soft = blur(src, 2.0)
S_ = sample(soft, cpts[:, 0] + nrm[:, 0] * 9, cpts[:, 1] + nrm[:, 1] * 9)
ok = S_.sum(1) / 3 > 34
idx = np.arange(len(S_))
S_ = np.c_[[np.interp(idx, idx[ok], S_[ok, k]) for k in range(3)]].T
ker = np.exp(-0.5 * (np.arange(-40, 41) / 14.0) ** 2)
ker /= ker.sum()
gsm = lambda v, k=ker: np.convolve(np.pad(v, len(k) // 2, mode='edge'), k, mode='valid')
S_ = np.c_[[gsm(S_[:, k]) for k in range(3)]].T

bx0, by0, bx1, by1 = 1332, 190, 1560, 444
PX, PY = np.meshgrid(np.arange(bx0, bx1, dtype=np.float32), np.arange(by0, by1, dtype=np.float32))
d2 = (PX[..., None] - cpts[:, 0]) ** 2 + (PY[..., None] - cpts[:, 1]) ** 2
ni = d2.argmin(2)
cn, nn = cpts[ni], nrm[ni]
sd = (PX - cn[..., 0]) * nn[..., 0] + (PY - cn[..., 1]) * nn[..., 1]          # signed distance, + inside
par = tt_[ni]                                                              # how far along the edge, from its top
ends = smooth(TOP, TOP + 16, par) * smooth(0, 12, seg[-1] - par)            # nothing at the ends of the line
# the lock of hair that hangs over the temple in the picture, down to its tip: it stays in front of the new cheek
LOCK = [(1360, 236), (1366, 250), (1368, 270), (1373, 286), (1379, 300), (1384, 311), (1388, 322), (1392, 323),
        (1394, 300), (1395, 258), (1397, 236)]
lock = (blur(poly(LOCK).astype(np.float32), 0.8) * smooth(3, 12, blur(lum, 0.8)))[by0:by1, bx0:bx1]
# the picture without the thin strands that hang in front of the far cheek (they would smear when it widens)
crop = Image.fromarray(src[by0:by1, bx0:bx1].astype(np.uint8))
closed = np.asarray(crop.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7)).filter(ImageFilter.GaussianBlur(1.3))).astype(np.float32)
ker2 = np.exp(-0.5 * (np.arange(-18, 19) / 6.0) ** 2)
ker2 /= ker2.sum()
# her mouth: the far cheek's dark stops short of it
LIPS = [(1458, 383), (1468, 369), (1500, 365), (1527, 371), (1515, 394), (1493, 405), (1472, 403)]
lips = blur(poly(LIPS).astype(np.float32), 5)[by0:by1, bx0:bx1]

# How the far side of the turned face runs: as the mirror image of the near side (WIDE). And it comes out of the
# dark: black at its new edge, the light back in full DARK (turned) pixels in from it, by height (h = 0 at the
# eyes, about 150 at the chin): short beside the eye (the eye stays as it is), long down the cheek, short again
# where the cheek runs out into the lit chin.
DARK = [(-80, 54), (22, 54), (45, 70), (70, 98), (112, 98), (134, 90), (148, 60)]
BANDW = 40.0                                                  # about how wide the band is once turned, and how much
INW = 1.7                                                     # a picture pixel inside the edge is, turned
hs = np.arange(-80.0, 181.0)
want = WIDE
# how wide the band is along the edge: no wider than the painted edge is short of the wanted line, and
# nothing where it already is as far out as wanted (round the chin)
line = MID + np.outer(hs, DN) - np.outer(want(hs), EX)
pc = turned(cpts[:, 0], cpts[:, 1], zc)
need = np.sqrt(((pc[:, None, :] - line[None, :, :]) ** 2).sum(2).min(1)) * np.sign(want(ch) - cw)
ext = gsm(np.minimum(EXT * smooth(1, 9, need), np.maximum(0.9 * need, 0)), ker2) * smooth(TOP, TOP + 16, tt_) * smooth(0, 12, seg[-1] - tt_)
# the depth of the band's outer edge, so that it lands on the wanted line (depth moves a turned point sideways)
ex, ey = cpts[:, 0] - nrm[:, 0] * ext, cpts[:, 1] - nrm[:, 1] * ext
lo, hi = np.full(len(tt_), -220.0), zc + 40
for _ in range(40):
    m_ = (lo + hi) / 2
    q = turned(ex, ey, m_) - MID
    inside = want(q @ DN) + q @ EX > 0                                     # not out to the line yet: go deeper
    hi = np.where(inside, m_, hi)
    lo = np.where(inside, lo, m_)
ze = gsm(np.minimum((lo + hi) / 2, zc), ker2)
# depth: from the painted edge's own depth down to that across the band, falling away beyond it
t_ = np.maximum(-sd, 0)
e_ = np.maximum(ext[ni], 0.5)
zb = np.where(t_ <= e_, zc[ni] + (ze[ni] - zc[ni]) * t_ / e_, ze[ni] - 0.8 * (t_ - e_))
wz = (sd < 0) * smooth(TOP, TOP + 16, par) * smooth(0, 3, seg[-1] - par)
zz = z.copy()
zz[by0:by1, bx0:bx1] = zz[by0:by1, bx0:bx1] * (1 - wz) + zb * wz
zz[by0 - 4:by1 + 4, bx0 - 4:bx1 + 4] = blur(zz[by0 - 4:by1 + 4, bx0 - 4:bx1 + 4], 1.0)
dz = zz[ky0:ky1, kx0:kx1]
v = np.clip((dz + 128) * 128, 0, 65535).astype(np.uint16)               # depth -128 .. 384 in 1/128 px
save('depth.png', np.dstack([v >> 8, v & 255, np.clip(sway * 255, 0, 255).astype(np.uint16)]).astype(np.float32))

# paint: the band of skin outside the edge, fading out 13 pixels inside it; the painted lock stays on top
band = S_[ni]
a_out = np.where(sd < 0, np.clip((e_ - t_) / 1.2, 0, 1), 1.0) * smooth(1.0, 3.0, ext[ni]) * (sd < 6)
below = smooth(S0 - 8, S0 + 6, par)
w_in = (1 - smooth(5, 13, sd)) * (sd >= 0) * ends * (0.35 + 0.65 * below) * np.clip(ext[ni] / 4, 0.3, 1)
wk = (np.clip(w_in + (sd < 0) * (a_out > 0), 0, 1) * (1 - lock))[..., None]
tidy = ((sd >= 0) * (1 - smooth(16, 26, sd)) * smooth(S0 + 16, S0 + 30, par) * smooth(0, 16, CHIN + 16 - par) * (1 - lock))[..., None]
Bp = src.copy()
Bb = Bp[by0:by1, bx0:bx1]
Bb[:] = Bb * (1 - tidy) + closed * tidy
Bb[:] = Bb * (1 - wk) + band * wk
aB = alpha.copy()
aB[by0:by1, bx0:bx1] = np.maximum(aB[by0:by1, bx0:bx1], blur(a_out, 0.5))
save('headB.png', np.dstack([Bp * aB[..., None], aB * 255])[ky0:ky1, kx0:kx1])
# band.png, R: how soon each bit of the new cheek shows as she turns: 255 at the painted edge (and
# everywhere else), falling to 0 at the band's outer edge, so the cheek grows out from the edge instead of
# fading in. G: the dark she comes out of (255 = full light): the scene lays it on as she turns.
rv = np.ones((H, W), np.float32)
rv[by0:by1, bx0:bx1] = blur(np.where((sd < 0) & (a_out > 0), 1 - np.clip(t_ / e_, 0, 1) * smooth(1.5, 4.5, ext[ni]), 1), 0.7)
wide = BANDW * np.clip(ext / EXT, 0, 1)                                   # the band's turned width along the edge
reach = np.maximum(gsm(np.interp(ch, [p[0] for p in DARK], [p[1] for p in DARK]), ker2), 1)
u_ = np.where(sd < 0, wide[ni] * (1 - np.clip(t_ / e_, 0, 1)), wide[ni] + INW * sd)   # turned pixels in from the new edge
lit = smooth(0, 1, u_ / reach[ni]) ** 1.2
# no band, no dark; but above the temple the hair and the forehead's edge go some of the way with it
there = np.maximum(smooth(0.5, 6, ext[ni]) * smooth(TOP, TOP + 16, par), np.where(sd < 0, 0.75, 0.3) * smooth(0, TOP + 8, par))
dk = np.ones((H, W), np.float32)
dk[by0:by1, bx0:bx1] = blur(1 - (1 - lit) * there * (1 - lips), 1.0)
# B: the far cheek and jaw themselves (skin and the new band, not the hair): what the scene may trim to the
# straight line it keeps from beside her eye to her chin while she is turned (index.html `jaw`)
jw = np.zeros((H, W), np.float32)
jw[by0:by1, bx0:bx1] = blur(((sd > -(e_ + 2)) & (sd < 70) & (par > S0 - 6)) * (1 - lock), 1.0)
Image.fromarray(np.clip(np.dstack([rv, dk, jw])[ky0:ky1, kx0:kx1] * 255 + 0.5, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'band.png'), optimize=True)

save('plate.png', plate)
print('ok')
