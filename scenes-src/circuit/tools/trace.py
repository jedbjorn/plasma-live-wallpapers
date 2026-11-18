#!/usr/bin/env python3
"""Work out when each pixel of the circuit board is drawn, from ../still.jpg (numpy + Pillow only):
    python3 scenes-src/<id>/tools/trace.py
Writes ../reveal.png, same size as the still: R,G = the pixel's draw time as 16 bits (R high byte),
0 = start of the drawing, 65535 = end. B = 255 where the pixel never changes (plain background).

How: threshold the copper (traces, pads) off the flat background, split it into nets (connected
pieces), and in every net measure the distance along the copper from a source pixel (Dijkstra inside
the mask). A net's pixels are drawn at  start + distance / speed, the same speed for all. Pixels next
to the copper (its antialiased edge) take the time of the copper they touch, so the scene can show the
still itself there.

The order: a wave spreads over the board from ORIGIN. A net starts when the wave reaches its nearer end
(the net under the origin starts right there) and grows from that end.
"""
import os, sys, heapq
import numpy as np
from PIL import Image

ORIGIN = (1277, 236)        # the via on the heavy rail
WAVE = 1.6                  # speed of the wave over the board, relative to a tip's along the copper
THR = 96                    # r+g+b above this is copper (background 70..76, copper ~130)
EDGE = 5                    # px around the copper that follow it

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)

def main():
    im = np.asarray(Image.open(os.path.join(OUT, 'still.jpg')).convert('RGB')).astype(np.int32)
    H, W = im.shape[:2]
    mask = im.sum(2) >= THR
    P = W + 2                                   # padded row length; flat indices into a padded grid
    pm = np.zeros((H + 2, P), bool); pm[1:-1, 1:-1] = mask
    flat = pm.ravel().tolist()
    N = len(flat)
    R2 = 2 ** 0.5
    nb = [(-P, 1.0), (P, 1.0), (-1, 1.0), (1, 1.0), (-P - 1, R2), (-P + 1, R2), (P - 1, R2), (P + 1, R2)]

    # nets
    label = [-1] * N
    nets = []
    for i in range(N):
        if flat[i] and label[i] < 0:
            k = len(nets); label[i] = k; st = [i]; px = [i]
            while st:
                j = st.pop()
                for d, _ in nb:
                    q = j + d
                    if flat[q] and label[q] < 0:
                        label[q] = k; st.append(q); px.append(q)
            nets.append(px)
    print(len(nets), 'nets,', int(mask.sum()), 'copper px')

    def geo(sources):
        """distance along the copper from each net's source"""
        dist = [1e18] * N
        hq = [(0.0, s) for s in sources]
        for s in sources: dist[s] = 0.0
        while hq:
            d, j = heapq.heappop(hq)
            if d > dist[j]: continue
            for o, w in nb:
                q = j + o
                if flat[q] and d + w < dist[q]:
                    dist[q] = d + w; heapq.heappush(hq, (d + w, q))
        return dist

    xy = lambda i: (i % P - 1, i // P - 1)
    # the two ends of every net: the pixel farthest from any pixel, and the one farthest from that
    far = lambda dist: [max(px, key=dist.__getitem__) for px in nets]
    e1 = far(geo([px[0] for px in nets]))
    e2 = far(geo(e1))
    T = np.zeros(N)
    ox, oy = ORIGIN
    away = lambda i: ((xy(i)[0] - ox) ** 2 + (xy(i)[1] - oy) ** 2) ** 0.5
    src = []
    for k, px in enumerate(nets):
        s = min(px, key=away)                # the net under the origin starts right there
        src.append(s if away(s) < 30 else min(e1[k], e2[k], key=away))
    dist = geo(src)
    for k, px in enumerate(nets):
        start = away(src[k]) / WAVE
        for i in px: T[i] = start + dist[i]
    T /= T.max()

    T = T.reshape(H + 2, P)
    known = pm.copy()
    for _ in range(EDGE):                        # the copper's edge takes the earliest time next to it
        best = np.full(T.shape, np.inf)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            t = np.where(known, T, np.inf)
            best = np.minimum(best, np.roll(np.roll(t, dy, 0), dx, 1))
        new = ~known & np.isfinite(best)
        T[new] = best[new]; known |= new
    T = T[1:-1, 1:-1]; known = known[1:-1, 1:-1]
    v = np.clip(np.round(T * 65535), 0, 65535).astype(np.uint16)
    out = np.zeros((H, W, 3), np.uint8)
    out[..., 0] = v >> 8; out[..., 1] = v & 255; out[..., 2] = np.where(known, 0, 255)
    Image.fromarray(out).save(os.path.join(OUT, 'reveal.png'), optimize=True)
    print('wrote reveal.png; draw-time quartiles of the copper:', np.quantile(T[mask], [.25, .5, .75]).round(3))

if __name__ == '__main__':
    main()
