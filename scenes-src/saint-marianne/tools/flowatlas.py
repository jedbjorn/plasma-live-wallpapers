"""flowatlas.py STATUE_RGBA VEST_MASK OUT.png N CLIP.mp4 [CLIP.mp4 ...]: turn image-to-video clips of the vest into a
motion atlas (needs OpenCV). Every clip starts from the same still (the CROP of the picture, scaled to 480x832); the first N frames of each are used.
For every frame: where each pixel came from in the still (dense optical flow), and how much lighter or darker the cloth
got there (wrinkle shading). One cell per frame, CELL pixels, COLS per row, clip after clip:
  R, G = 0.5 + flow / (2 * RANGE), flow as a share of the clip's width and height;  B = shading ratio / 2
The clip is the CROP of the statue picture. Its camera wanders a little: the bronze's motion is fitted and undone, and
motion is kept only on the cloth (where it hangs in the still, and wherever yellow cloth has been blown to)."""
import sys, json, subprocess, tempfile, glob
import numpy as np, cv2

statue, vest, out, N = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
clips = sys.argv[5:]
CROP = (10, 736, 960, 1664)             # x, y, w, h in statue-picture pixels (1080 x 2400): the clip's still
CW, CH, COLS, RANGE = 90, 156, 20, 0.10
x, y, w, h = CROP
st = cv2.imread(statue, cv2.IMREAD_UNCHANGED)
SH = st.shape[0]
dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM); dis.setFinestScale(1)
cells, peak = [], 0.0
for clip in clips:
    tmp = tempfile.mkdtemp()
    subprocess.run(['ffmpeg', '-v', 'error', '-i', clip, tmp + '/f%04d.png'], check=True)
    fr = sorted(glob.glob(tmp + '/f*.png'))[:N]
    assert len(fr) == N, f'{clip}: only {len(fr)} frames'
    ref = cv2.imread(fr[0]); H, W = ref.shape[:2]
    refg = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)
    gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    m = cv2.resize(cv2.imread(vest)[y:y + h, x:x + w, 2].astype(np.float32) / 255, (W, H), interpolation=cv2.INTER_AREA)
    alpha = cv2.resize(st[y:y + h, x:x + w, 3].astype(np.float32) / 255, (W, H), interpolation=cv2.INTER_AREA)
    rest = cv2.dilate(m, np.ones((15, 15), np.uint8)) * cv2.dilate(alpha, np.ones((9, 9), np.uint8))   # cloth + a margin, on her
    reach = cv2.dilate(m, np.ones((61, 61), np.uint8))                                                 # as far as it may fly
    bronze = (alpha > 0.95) & (cv2.dilate(m, np.ones((31, 31), np.uint8)) < 0.02)
    bronze &= cv2.erode(bronze.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    P = np.stack([gx[bronze], gy[bronze], np.ones(int(bronze.sum()), np.float32)], axis=1).astype(np.float64)
    drift = []
    for k in range(N):
        cur = cv2.imread(fr[k]); curg = cv2.cvtColor(cur, cv2.COLOR_BGR2GRAY)
        Mt = np.array([[1, 0, 0], [0, 1, 0]], np.float64)       # this frame -> the still, for the bronze
        stab, stabc = curg, cur
        for _ in range(3):
            Q = P[:, :2] + dis.calc(stab, refg, None)[bronze]
            A, *_ = np.linalg.lstsq(P, Q, rcond=None)
            res = np.linalg.norm(P @ A - Q, axis=1)
            keep = res < max(1.0, np.percentile(res, 70))
            A, *_ = np.linalg.lstsq(P[keep], Q[keep], rcond=None)
            Mt = (np.vstack([A.T, [0, 0, 1]]) @ np.vstack([Mt, [0, 0, 1]]))[:2]
            stab = cv2.warpAffine(curg, Mt, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            stabc = cv2.warpAffine(cur, Mt, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        c = np.array([W / 2, H / 2, 1.0])
        drift.append(float(np.hypot(*(Mt @ c - c[:2]))))
        b, g, r = [stabc[..., i].astype(np.float32) for i in range(3)]
        yellow = ((b < 0.5 * r) & (r > 105) & (g > 0.62 * r)).astype(np.float32)
        valid = np.maximum(rest, reach * yellow)
        near = cv2.GaussianBlur(valid, (0, 0), 3)
        flow = dis.calc(stab, refg, None)                         # stab(p) ~ still(p + flow)
        flow = cv2.GaussianBlur(flow * valid[..., None], (0, 0), 2.5) / (cv2.GaussianBlur(valid, (0, 0), 2.5)[..., None] + 0.05)
        flow *= near[..., None]
        warped = cv2.remap(refg, gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_LINEAR).astype(np.float32)
        ratio = (cv2.GaussianBlur(stab.astype(np.float32), (0, 0), 2.0) + 6) / (cv2.GaussianBlur(warped, (0, 0), 2.0) + 6)
        ratio = ratio / cv2.GaussianBlur(ratio, (0, 0), 30)       # wrinkles only, not the clip's overall drift
        ratio = 1 + (np.clip(ratio, 0.55, 1.7) - 1) * near
        f = np.dstack([flow[..., 0] / W, flow[..., 1] / H])
        peak = max(peak, float(np.abs(f).max()))
        cell = np.dstack([0.5 + np.clip(f, -RANGE, RANGE) / (2 * RANGE), ratio / 2])
        cells.append(cv2.resize(cell, (CW, CH), interpolation=cv2.INTER_AREA))
    print(clip, 'camera drift px, every 10th frame:', [round(d, 1) for d in drift[::10]], file=sys.stderr)
rows = -(-len(cells) // COLS)
atlas = np.full((rows * CH, COLS * CW, 3), 0.5, np.float32)
for i, c in enumerate(cells):
    r, q = divmod(i, COLS)
    atlas[r * CH:(r + 1) * CH, q * CW:(q + 1) * CW] = c
cv2.imwrite(out, (np.clip(atlas[..., ::-1], 0, 1) * 255 + 0.5).astype(np.uint8))
print(json.dumps({'clips': len(clips), 'frames': N, 'cols': COLS, 'rows': rows, 'cell': [CW, CH], 'range': RANGE,
                  'crop': [round(v, 5) for v in (x / 1080, y / SH, w / 1080, h / SH)], 'peak': round(peak, 4)}))
