#!/usr/bin/env python3
"""Cut the two pictures into the scene's assets.

  python3 tools/prep.py                  (run in scenes-src/bio-skip/; reads still.jpg and still-flat.jpg)
  python3 tools/prep.py STILL FLAT OUTDIR [CHECKDIR]

still.jpg       1920x1200, the pair on the left facing right, on textured paper with a vignette and grain
still-flat.jpg  1920x1080, the same drawing mirrored and smaller on one flat colour: an exact matte

Writes into OUTDIR (default: here):
  paper.jpg      2560x1440  the empty paper, vignette and grain taken out (the scene puts them back on top)
  vignette.png   320x180    the paper's light falloff (multiplied over everything)
  grain.png      512x512    the paper's grain, mid grey = none (added over everything, mirror-tiled)
  parts.png      atlas of the puppets' pieces, flattened (vignette divided out) and denoised
                 giant: body, upper arm, forearm, thigh, shin, far leg
                 girl:  body, head, skirt, leg (near and far), two pigtails, the arm with the syringe
  drops.png      atlas of the picture's own droplets and the fan of ink thrown forward by the giant's foot
  rig.js         window.BIO = { parts, drops, piv ... }: atlas rectangles and pivots in source pixels
With CHECKDIR it also writes each piece on magenta and the puppet put together again, to check the cuts.

Needs numpy and opencv (pip install numpy opencv-python-headless).
"""
import sys, json
import numpy as np
import cv2

args = sys.argv[1:]
src1, src2, out = (args + ['still.jpg', 'still-flat.jpg', '.'][len(args):])[:3]
dbg = args[3] if len(args) > 3 else None
A8 = cv2.imread(src1)
A = A8.astype(np.float32)                                   # BGR
B = cv2.imread(src2)[:, ::-1].astype(np.float32)            # mirrored: now it faces right too
H, W = A.shape[:2]
LUM = np.array([0.114, 0.587, 0.299], np.float32)
REF = np.array([136, 150, 146], np.float32)                 # the paper at its brightest (BGR)
INK = np.array([27, 39, 50], np.float32)                    # the ink, flattened (BGR)


def sstep(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def poly_mask(pts, ss=4):
    m = np.zeros((H * ss, W * ss), np.uint8)
    cv2.fillPoly(m, [np.round(np.array(pts, np.float32) * ss).astype(np.int32)], 255)
    return cv2.resize(m, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255


def grow(m, r):
    return cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))


def shrink(m, r):
    return cv2.erode(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))


# ---------------------------------------------------------------- register bio2 onto bio.jpg
# bio.jpg (x, y) -> mirrored bio2 (x, y); from an ECC alignment of the two ink maps (correlation 0.994)
ia = cv2.GaussianBlur((cv2.cvtColor(A8, cv2.COLOR_BGR2GRAY) < 60).astype(np.float32), (0, 0), 1.5)
ib = cv2.GaussianBlur((cv2.cvtColor(B.astype(np.uint8), cv2.COLOR_BGR2GRAY) < 70).astype(np.float32), (0, 0), 1.07)
M = np.array([[1 / 1.405, 0, -3 / 1.405], [0, 1 / 1.405, 400 / 1.405]], np.float32)
_, M = cv2.findTransformECC(ia, ib, M, cv2.MOTION_AFFINE,
                            (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-7), None, 5)
valid = cv2.warpAffine(np.ones(B.shape[:2], np.float32), M, (W, H),
                       flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP, borderValue=0) > 0.5

# ---------------------------------------------------------------- bio2's matte (its background is one colour)
bg2 = np.array([174, 185, 177], np.float32)
d = np.sqrt(((B - bg2) ** 2).sum(2))
hard = (d > 16).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(hard, connectivity=8)
mx = np.zeros(n); np.maximum.at(mx, lab.ravel(), d.ravel())
keep = (mx > 45) & (st[:, cv2.CC_STAT_AREA] >= 3); keep[0] = False
hard = keep[lab].astype(np.uint8)
# pinholes: background-like specks inside the figure that are only anti-aliasing between cream and ink
n, lab, st, _ = cv2.connectedComponentsWithStats(1 - hard, connectivity=4)
core = np.zeros(n); np.add.at(core, lab.ravel(), (d.ravel() < 7).astype(float))
fill = core < 8; fill[0] = False
fill &= ~(st[:, cv2.CC_STAT_AREA] > 400)
hard = np.where(fill[lab], 1, hard).astype(np.uint8)
# the rim next to the background is part ink, part background
k3 = np.ones((3, 3), np.uint8)
rim = (cv2.dilate(1 - hard, k3) > 0) & (hard > 0)
dmax = cv2.dilate(d, np.ones((5, 5), np.uint8))
a2 = hard.astype(np.float32)
a2[rim] = np.clip(d[rim] / np.maximum(dmax[rim], 1), 0, 1)
rim_o = (cv2.dilate(hard, k3) > 0) & (hard == 0)
a2[rim_o] = np.clip((d[rim_o] - 8) / np.maximum(dmax[rim_o], 60), 0, 1)
m2 = np.clip(cv2.warpAffine(a2, M, (W, H), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP, borderValue=0), 0, 1)

# ---------------------------------------------------------------- the paper's light falloff
D = cv2.fastNlMeansDenoisingColored(A8, None, 12, 6, 5, 21).astype(np.float32)
near = cv2.dilate((m2 > 0.02).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))) > 0
Y = A @ LUM


def fit(mask, deg=6, step=4):
    ys, xs = np.mgrid[0:H:step, 0:W:step]
    m = mask[::step, ::step]
    x = xs[m] / W * 2 - 1; y = ys[m] / H * 2 - 1
    T = np.stack([x ** i * y ** j for i in range(deg + 1) for j in range(deg + 1 - i)], 1)
    gy, gx = np.mgrid[0:H, 0:W]
    X = (gx / W * 2 - 1).astype(np.float32); Yy = (gy / H * 2 - 1).astype(np.float32)
    o = np.zeros((H, W, 3), np.float32)
    for c in range(3):
        co = np.linalg.lstsq(T, np.log(A[::step, ::step, c][m] + 1), rcond=None)[0]
        acc = np.zeros((H, W), np.float32); k = 0
        for i in range(deg + 1):
            for j in range(deg + 1 - i):
                acc += co[k] * X ** i * Yy ** j; k += 1
        o[..., c] = np.exp(acc) - 1
    return o


bgm = valid & ~near
V = fit(bgm)
low = ~valid
k15 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
bgm = bgm | (low & (Y > (V @ LUM) * 0.8) & ~(cv2.dilate(((Y < (V @ LUM) * 0.75) & low).astype(np.uint8), k15) > 0))
V = fit(bgm)
# local paper level (the blotches) near the figure
wgt = bgm.astype(np.float32)
num = cv2.GaussianBlur((A / V) * wgt[..., None], (0, 0), 18); den = cv2.GaussianBlur(wgt, (0, 0), 18)
loc = np.where(den[..., None] > 0.02, num / np.maximum(den, 1e-4)[..., None], 1.0)
P = V * (1 + (loc - 1) * np.clip(den / 0.3, 0, 1)[..., None])

# ---------------------------------------------------------------- the figure's matte
alpha = sstep(m2, 0.12, 0.88)
# below bio2's bottom edge (the last streaks of the splash): a darkness matte from the picture itself
rel = cv2.GaussianBlur(1 - (D @ LUM) / (P @ LUM), (0, 0), 0.6)
ad = sstep(rel, 0.2, 0.5)
rows = np.arange(H)[:, None]
lowreg = np.zeros((H, W), np.float32); lowreg[1098:, :680] = 1
alpha = np.maximum(alpha * (1 - np.clip((rows - 1110) / 6, 0, 1)), ad * lowreg * np.clip((rows - 1098) / 10, 0, 1))
alpha[:, :3] = 0

# ---------------------------------------------------------------- its colours: flattened, denoised, ink up to the edge
F = D / P * REF
solid = cv2.erode((alpha > 0.985).astype(np.uint8), k3) > 0
dark = solid & ((F @ LUM) < 0.42 * 150)
col = np.where(dark[..., None], F, 0).astype(np.float32); known = dark.copy()
for _ in range(6):
    kk = np.ones((3, 3), np.float32)
    s_ = cv2.filter2D(np.where(known[..., None], col, 0), -1, kk); c_ = cv2.filter2D(known.astype(np.float32), -1, kk)
    new = (~known) & (c_ > 0)
    col[new] = s_[new] / c_[new][:, None]; known |= new
col = np.where(known[..., None], col, INK)
warm = sstep((F[..., 2] / np.maximum(F[..., 0], 1)) / (REF[2] / REF[0]), 1.12, 1.3)   # tan and cream stay
F = np.where((~solid)[..., None], col + (F - col) * warm[..., None], F)

# ---------------------------------------------------------------- the puppet's pieces (source pixels)
PIV = dict(
    shoulder=(338, 405), elbow=(312, 525), grip=(270, 720), hip=(462, 596), knee=(690, 648), toe=(535, 878),
    farhip=(468, 640), fartoe=(392, 1002), girlfoot=(188, 1064),
    # the girl: her skirt swings about the waist, her legs come out from under it, her hair and syringe arm fly
    gwaist=(200, 826), ghip=(212, 935), gshoulder=(148, 752), gtailL=(188, 718), gtailLtip=(156, 642),
    gtailR=(214, 708), gtailRtip=(196, 620), ghead=(215, 760), gneck=(214, 798),
    origin=(392, 1002),
)
POLY = dict(
    thigh=[(470, 549), (598, 549), (602, 538), (745, 538), (745, 656), (652, 654), (630, 645), (600, 638), (560, 638),
           (520, 640), (490, 640), (470, 636), (462, 600), (462, 570)],
    shin=[(652, 656), (745, 658), (745, 700), (735, 738), (700, 745), (668, 738), (655, 760), (650, 800), (640, 832),
          (615, 858), (585, 862), (565, 870), (548, 892), (535, 896), (520, 890), (505, 872), (492, 848), (478, 820),
          (463, 788), (445, 778), (425, 775), (422, 740), (428, 705), (445, 696), (470, 686), (500, 668), (540, 652),
          (600, 640), (630, 646)],
    far=[(350, 800), (353, 790), (380, 788), (418, 788), (440, 792), (462, 782), (478, 810), (492, 835), (505, 855),
         (514, 870), (500, 876), (478, 884), (476, 905), (452, 912), (446, 930), (434, 960), (418, 982), (400, 992),
         (382, 998), (360, 1003), (349, 985), (348, 940), (349, 900), (349, 860), (349, 830)],
    arm=[(292, 432), (300, 398), (325, 380), (352, 378), (378, 395), (385, 430), (380, 480), (366, 540), (366, 600),
         (374, 650), (362, 695), (350, 712), (330, 722), (305, 733), (285, 734), (262, 728), (245, 716), (232, 705),
         (223, 685), (221, 650), (226, 612), (238, 588), (262, 555), (280, 500)],
    girl=[(116, 428), (130, 428), (136, 520), (142, 560), (152, 585), (162, 600), (170, 640), (180, 612), (200, 608),
          (222, 618), (224, 650), (222, 690), (232, 704), (246, 706), (262, 708), (288, 716), (292, 742), (280, 760),
          (270, 785), (262, 800), (275, 815), (292, 833), (303, 846), (318, 862), (328, 885), (326, 902), (310, 912),
          (285, 937), (262, 952), (245, 978), (232, 988), (228, 990), (224, 1020), (214, 1050), (210, 1072),
          (170, 1072), (166, 1040), (170, 1010), (172, 990), (150, 990), (128, 986), (108, 975), (88, 955),
          (68, 932), (50, 905), (48, 885), (60, 866), (85, 838), (120, 822), (150, 815), (158, 800), (150, 780),
          (138, 760), (128, 735), (125, 702), (100, 702), (90, 682), (90, 640), (96, 622), (110, 616), (110, 590),
          (106, 575), (116, 560), (116, 500)],
    # his forearm and glove, from the dial at the elbow down (the elbow lies on the line from shoulder to hand)
    farm=[(292, 512), (312, 498), (348, 500), (366, 516), (368, 560), (366, 600), (374, 650), (362, 695), (350, 712),
          (330, 722), (305, 733), (285, 734), (262, 728), (245, 716), (232, 705), (223, 685), (221, 650), (226, 612),
          (238, 588), (262, 555), (280, 524)],
    gskirt=[(150, 817), (156, 827), (240, 820), (246, 808), (262, 800), (275, 815), (292, 833), (303, 846), (318, 862),
            (328, 885), (326, 902), (310, 912), (285, 937), (262, 952), (245, 978), (232, 988), (228, 992),
            (172, 992), (150, 990), (128, 986), (108, 975), (88, 955), (68, 932), (50, 905), (48, 885), (60, 866),
            (85, 838), (120, 822)],
    gtailL=[(152, 640), (160, 636), (172, 642), (184, 662), (190, 690), (192, 712), (190, 722), (180, 726), (172, 718),
            (166, 712), (158, 710), (154, 700), (153, 680), (154, 660)],
    gtailR=[(188, 614), (206, 612), (218, 620), (221, 640), (221, 668), (222, 690), (224, 704), (218, 714), (206, 712),
            (200, 700), (197, 680), (193, 662), (189, 650), (187, 632)],
    garm=[(112, 428), (132, 428), (140, 560), (152, 585), (151, 640), (151, 690), (153, 720), (163, 742), (160, 756),
          (142, 760), (127, 752), (125, 702), (100, 702), (90, 682), (90, 640), (96, 622), (110, 616), (110, 590),
          (106, 575), (116, 560), (116, 500)],
    gstub=[(158, 822), (238, 816), (236, 854), (160, 854)],
    # her head (face and hair; the pigtails hang on it), turning on the neck
    ghead=[(176, 722), (190, 714), (210, 711), (226, 715), (240, 726), (246, 745), (246, 770), (240, 790), (228, 800),
           (214, 803), (198, 798), (186, 790), (178, 775), (173, 750), (173, 735)],
    # what shows of the body when a piece in front of it moves away: ink
    under_thigh=[(470, 549), (598, 549), (606, 560), (600, 600), (580, 628), (540, 638), (490, 640), (465, 620)],
    under_arm=[(292, 432), (300, 398), (352, 378), (378, 395), (385, 430), (380, 480), (366, 540), (366, 600),
               (372, 648), (340, 652), (300, 640), (245, 618), (226, 598), (255, 560), (280, 500)],
    # the far leg's upper part, hidden behind the near leg in the picture (kept to where that really covers it)
    far_hidden=[(440, 640), (545, 640), (552, 720), (548, 800), (540, 850), (520, 884), (514, 870), (505, 855),
                (492, 835), (478, 810), (462, 782), (440, 792), (434, 740)],
)
MK = {k: poly_mask(v) for k, v in POLY.items()}
gy, gx = np.mgrid[0:H, 0:W].astype(np.float32)
dist = lambda p: np.hypot(gx - p[0], gy - p[1])


def main_component(a, min_area=300):
    """keep the big connected pieces of a matte (drops the loose droplets around it)"""
    n, lab, st, _ = cv2.connectedComponentsWithStats((a > 0.3).astype(np.uint8), connectivity=8)
    keep = st[:, cv2.CC_STAT_AREA] >= min_area; keep[0] = False
    k = cv2.dilate(keep[lab].astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    return a * k


parts = {}
# girl: her leg is light on the splash's dark mass, so it brings a rim of that ink along as its outline
leg = np.zeros((H, W), np.uint8)
leg[988:1072, 166:228] = ((F @ LUM)[988:1072, 166:228] > 95) & (alpha[988:1072, 166:228] > 0.5)
leg = cv2.GaussianBlur(cv2.dilate(leg, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))).astype(np.float32), (0, 0), 1.0)
legzone = (gy > 986).astype(np.float32)
ga = main_component(alpha * MK['girl'] * (1 - legzone) + np.minimum(alpha, leg) * legzone * MK['girl'])
# she comes apart too: body (bodice and the arm up to his hand), head, skirt, a leg (used twice), two pigtails and
# the arm with the syringe. Under the skirt the bodice goes on a little as plain ink.
# (where a piece turns on a pivot it fades in over the piece below, which stays whole there: no paper shows through)
w_tl = MK['gtailL'] * sstep(dist(PIV['gtailL']), 8, 16)
w_tr = MK['gtailR'] * sstep(dist(PIV['gtailR']), 8, 16)
w_ga = MK['garm'] * sstep(dist(PIV['gshoulder']), 16, 30)
top = ga * (1 - MK['gskirt']) * (1 - legzone)
parts['ghead'] = (top * MK['ghead'] * sstep(dist(PIV['gneck']), 3, 12) * (1 - w_tl) * (1 - w_tr), F)
# behind the head the body is plain ink (hair), a little inside the head's own outline where that is open paper
solid = (top > 0.5).astype(np.float32)
under_head = cv2.GaussianBlur(shrink(solid, 4) * grow(MK['ghead'], 2), (0, 0), 0.8) * (dist(PIV['gneck']) > 10)
keep = main_component(top * (1 - MK['ghead'] * sstep(dist(PIV['gneck']), 12, 22)) * (1 - w_tl) * (1 - w_tr) * (1 - w_ga))
stub = MK['gstub'] * (gy > 824)
parts['gbody'] = (np.maximum(np.maximum(keep, MK['gstub']), under_head), np.where(((keep < 0.5) | (stub > 0.5))[..., None], INK, F))
parts['gskirt'] = (ga * MK['gskirt'] * (1 - legzone), F)
parts['gtailL'] = (ga * MK['gtailL'] * sstep(dist(PIV['gtailL']), 1, 8), F)
parts['gtailR'] = (ga * MK['gtailR'] * sstep(dist(PIV['gtailR']), 1, 8), F)
parts['garm'] = (ga * MK['garm'] * sstep(dist(PIV['gshoulder']), 3, 16), F)
# the leg: what shows below the hem, and above it the same cross-section run on up along the leg (hidden by the
# skirt until she kicks)
LEG_TOP, LEG_UP = 992, 96
la = ga * legzone * (gy >= LEG_TOP)
slope = (212 - 186) / (992 - 1062)                          # x per y along the leg (it leans forward going up)
mx_ = (gx - (gy - LEG_TOP) * slope).astype(np.float32)
my_ = np.full_like(gy, LEG_TOP + 2, np.float32)
ext = (gy < LEG_TOP) & (gy >= LEG_TOP - LEG_UP)
la_e = cv2.remap(la, mx_, my_, cv2.INTER_LINEAR) * ext * sstep(gy, LEG_TOP - LEG_UP, LEG_TOP - LEG_UP + 14)
lc_e = cv2.remap(F, mx_, my_, cv2.INTER_LINEAR)
lega = np.where(ext, la_e, la)
legc = np.where(ext[..., None], lc_e, F)
parts['gleg'] = (lega, legc)
dk = INK + (legc - INK) * 0.62                               # the far leg, in shadow
# held arm: fades in from the shoulder, where it barely moves
arm_a = alpha * MK['arm'] * sstep(dist(PIV['shoulder']), 14, 42)
parts['farm'] = (arm_a * MK['farm'], F)
cap = (dist(PIV['elbow']) < 27).astype(np.float32) * MK['arm']          # under the dial the upper arm ends in ink
ua = np.maximum(arm_a * (1 - MK['farm']), cv2.GaussianBlur(cap, (0, 0), 0.8))
parts['uarm'] = (ua, np.where((MK['farm'] > 0.5)[..., None], INK, F))
parts['thigh'] = (alpha * MK['thigh'] * sstep(dist(PIV['hip']), 6, 26), F)
# a piece behind another reaches 3 px under it, so no paper shows through the cut
parts['shin'] = (alpha * grow(MK['shin'], 3), F)
# body: everything else that hangs together with the torso; ink where the arm and the thigh were
sliver = poly_mask([(498, 636), (662, 632), (662, 664), (540, 662), (498, 676)])
rest = alpha * (1 - MK['girl']) * (1 - shrink(MK['shin'], 3)) * (1 - MK['far']) * (1 - sliver) * (gy < 790)
w_arm = MK['arm'] * sstep(dist(PIV['shoulder']), 20, 46)
w_th = MK['thigh'] * sstep(dist(PIV['hip']), 10, 30)
wb = np.maximum(w_arm, w_th)
ba = rest * (1 - wb) + np.maximum(grow(MK['under_arm'], 2) * w_arm, grow(MK['under_thigh'], 2) * w_th)
n, lab, st, _ = cv2.connectedComponentsWithStats((ba > 0.3).astype(np.uint8), connectivity=8)
big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
ba = ba * (cv2.dilate((lab == big).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0)
parts['body'] = (ba, F * (1 - wb[..., None]) + INK * wb[..., None])

# far leg: its upper part is plain ink, exactly where the body and the near leg cover it in the picture
cover = np.maximum(np.maximum(parts['body'][0], parts['shin'][0]), parts['thigh'][0])
cover = shrink((cover > 0.9).astype(np.float32), 2)
fill = cv2.GaussianBlur(MK['far_hidden'] * cover, (0, 0), 0.8)
fa = np.maximum(alpha * grow(MK['far'], 3) * (gy > 775), fill)
parts['far'] = (fa, np.where((shrink(MK['far'], 3) > 0.5)[..., None], F, INK))

# ---------------------------------------------------------------- pack the pieces into an atlas
def pack(items, pad=4):
    """items: name -> (alpha, colour); returns atlas BGRA and rects {name: [ax, ay, w, h, sx, sy]} (shelf packing)"""
    boxes = {}
    for k, (a, c) in items.items():
        ys, xs = np.nonzero(a > 0.004)
        x0, x1, y0, y1 = xs.min() - 2, xs.max() + 3, ys.min() - 2, ys.max() + 3
        boxes[k] = (max(x0, 0), max(y0, 0), min(x1, W), min(y1, H))
    order = sorted(boxes, key=lambda k: -(boxes[k][3] - boxes[k][1]))
    AW = 2048
    x = y = rowh = 0; pos = {}
    for k in order:
        w, h = boxes[k][2] - boxes[k][0], boxes[k][3] - boxes[k][1]
        if x + w + pad > AW:
            x = 0; y += rowh + pad; rowh = 0
        pos[k] = (x, y); x += w + pad; rowh = max(rowh, h)
    AH = y + rowh
    atlas = np.zeros((AH, AW, 4), np.float32)
    rects = {}
    for k in order:
        x0, y0, x1, y1 = boxes[k]; ax, ay = pos[k]
        a, c = items[k]
        atlas[ay:ay + y1 - y0, ax:ax + x1 - x0, :3] = c[y0:y1, x0:x1]
        atlas[ay:ay + y1 - y0, ax:ax + x1 - x0, 3] = a[y0:y1, x0:x1] * 255
        rects[k] = [int(ax), int(ay), int(x1 - x0), int(y1 - y0), int(x0), int(y0)]
    return np.clip(atlas, 0, 255).astype(np.uint8), rects


parts['gleg2'] = (lega, dk)
atlas, rects = pack(parts)
cv2.imwrite(out + '/parts.png', atlas, [cv2.IMWRITE_PNG_COMPRESSION, 9])

# ---------------------------------------------------------------- the picture's own splash: droplets and pieces
# loose droplets: small separate blobs of the matte, right of and above the feet
n, lab, st, cen = cv2.connectedComponentsWithStats((alpha > 0.25).astype(np.uint8), connectivity=8)
drops = {}
cand = []
for i in range(1, n):
    x, y, w, h, area = st[i]
    if 14 <= area <= 420 and max(w, h) <= 34 and min(w, h) >= 4 and w / h < 1.8 and h / w < 1.8 and y < 1090:
        cand.append((area, i))
cand.sort(reverse=True)
for j, (area, i) in enumerate(cand[:28]):
    m = cv2.dilate((lab == i).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    drops['d%02d' % j] = (alpha * m, F)
SPL = dict(
    # the fan of streaks and curls thrown forward by the giant's foot
    fan=[(486, 884), (520, 880), (548, 896), (640, 880), (700, 930), (880, 1030), (900, 1075), (760, 1090),
         (660, 1118), (560, 1128), (470, 1120), (430, 1100), (405, 1060), (425, 1010), (440, 965), (452, 915)],
)
for k, v in SPL.items():
    m = poly_mask(v)
    a = alpha * m * (1 - MK['girl']) * (1 - MK['far']) * (1 - MK['shin'])
    c = F
    drops[k] = (a, c)
datlas, drects = pack(drops)
cv2.imwrite(out + '/drops.png', datlas, [cv2.IMWRITE_PNG_COMPRESSION, 9])

# ---------------------------------------------------------------- the empty paper
# flat = picture / falloff; under the figure: the paper from the far side, turned half round, its crack painted out
hole = cv2.dilate((alpha > 0.01).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25)))
hole[1090:, :700] = cv2.dilate(hole, np.ones((1, 61), np.uint8))[1090:, :700]
flat = D / V
# the paper's crack, traced by hand: it must not show twice
CRACK = [(700, 215), (740, 235), (820, 275), (900, 325), (990, 375), (1030, 400), (1080, 455), (1130, 510),
         (1170, 550), (1240, 605), (1280, 630), (1320, 690), (1350, 750), (1380, 840), (1420, 910), (1460, 960),
         (1500, 1010), (1545, 1065)]
crack = np.zeros((H, W), np.uint8)
cv2.polylines(crack, [np.array(CRACK, np.int32)], False, 1, 15)
f8 = np.clip(flat * 200, 0, 255).astype(np.uint8)
nocrack = cv2.inpaint(f8, crack, 8, cv2.INPAINT_TELEA).astype(np.float32) / 200
donor = nocrack[::-1, ::-1]
donor_ok = (hole[::-1, ::-1] == 0)
# where the donor is itself under the figure (never, for this picture) fall back to the plain paper colour
donor = np.where(donor_ok[..., None], donor, np.median(flat[hole == 0], axis=0))
wh = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 9)[..., None]
wh = np.clip(wh * 1.6, 0, 1)
flatp = flat * (1 - wh) + donor * wh
grain = (A - D) @ LUM                                       # the grain is the same in all three channels
SW, SH = 2560, 1440
paper = cv2.resize(flatp * REF, (SW, 1600), interpolation=cv2.INTER_CUBIC)[80:80 + SH]
cv2.imwrite(out + '/paper.jpg', np.clip(paper, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 93])
vg = cv2.resize(V / REF, (SW // 8, 1600 // 8), interpolation=cv2.INTER_AREA)[10:10 + SH // 8]
vmax = float(vg.max())
cv2.imwrite(out + '/vignette.png', np.clip(vg / vmax * 255, 0, 255).astype(np.uint8))
g = grain[56:56 + 512, 1404:1404 + 512]                    # a corner the crack does not cross
cv2.imwrite(out + '/grain.png', np.clip(g * 3 + 128, 0, 255).astype(np.uint8), [cv2.IMWRITE_PNG_COMPRESSION, 9])

rig = dict(src=[W, H], piv=PIV, parts=rects, drops=drects, vmax=vmax, ref=[int(REF[2]), int(REF[1]), int(REF[0])],
           ink=[int(INK[2]), int(INK[1]), int(INK[0])], grainScale=3, grainSize=512, stage=[SW, SH], paperScale=SW / W, paperCrop=80)
open(out + '/rig.js', 'w').write('// made by tools/prep.py\nwindow.BIO = ' + json.dumps(rig) + ';\n')
print('grain sigma', float(g.std()), 'vmax', vmax, 'atlas', atlas.shape, 'drops', datlas.shape, len(drops))

if dbg:                                                     # each piece on magenta with the pivots, and the puppet whole
    for k, (a, c) in list(parts.items()) + [(k, drops[k]) for k in SPL]:
        o = c * a[..., None] + np.array([255, 0, 255], np.float32) * (1 - a[..., None])
        ys, xs = np.nonzero(a > 0.004)
        o = np.clip(o, 0, 255).astype(np.uint8)
        for p in PIV.values():
            cv2.circle(o, p, 4, (0, 255, 0), -1)
        cv2.imwrite(f'{dbg}/part_{k}.png', o[max(ys.min() - 20, 0):ys.max() + 20, max(xs.min() - 20, 0):xs.max() + 20])
    allp = np.zeros((H, W, 3), np.float32) + np.array([236, 240, 238], np.float32)
    for k in ['far', 'body', 'shin', 'thigh', 'uarm', 'gleg', 'gbody', 'ghead', 'gskirt', 'gtailL', 'gtailR', 'garm', 'farm']:
        a, c = parts[k]
        allp = c * a[..., None] + allp * (1 - a[..., None])
    cv2.imwrite(dbg + '/recomposed.png', np.clip(allp, 0, 255).astype(np.uint8)[:, :1000])
