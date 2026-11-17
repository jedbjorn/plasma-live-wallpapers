#!/usr/bin/env python3
"""Generate the helper mask for Night Wind from ../still.jpg (run from repo root or anywhere):
    python3 scenes-src/night-wind/tools/masks.py
Writes scenes-src/night-wind/masks2.png (half resolution, 1500x844, RGB).
(The concept round also wrote masks1.png: figure alpha / cloud region / ink spray. Night Wind doesn't use it.)
  masks2  R = figure, hard edge        G = cape flutter weight      B = cloud interior-ness
          (0 at a cloud's rim, 1 deep inside; lets a cloud shrink from its edges)
The figure / spray / cape outlines are hand-placed polygons in source pixels (3000x1688);
the cloud region is detected from local ink density (blurred image), away from figure, spray and moon.
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
SRC = os.path.join(OUT, 'still.jpg')
W, H = 3000, 1688
MOON = (658, 448)

FIG = [(1758,262),(1772,225),(1800,195),(1850,172),(1905,160),(1960,165),(2010,155),(2065,175),(2125,188),
       (2155,240),(2130,300),(2060,305),(2025,275),(1995,262),(2000,325),(2150,340),(2155,358),(2110,405),
       (2040,440),(2000,480),(2005,535),(2065,560),(2150,605),(2250,635),(2400,620),(2500,548),(2700,550),
       (2760,600),(2800,800),(2780,950),(3000,760),(3000,1688),(1900,1688),(2050,1560),(2200,1400),
       (2275,1260),(2262,1150),(2250,1060),(2235,1010),(2200,965),(2130,890),(2085,830),(2040,770),
       (1985,700),(1968,640),(1960,602),(1900,592),(1850,568),(1830,552),(1790,547),(1760,542),(1700,525),
       (1640,510),(1625,495),(1645,476),(1680,443),(1715,408),(1748,372),(1756,355)]
SPRAY = [(2150,640),(2400,520),(3000,500),(3000,1688),(1750,1688),(1850,1450),(2230,1230),(2290,1000)]
# part of the big cloud hidden behind the hat / staff curl (so it can drift out from behind them)
HIDDEN = [(1750,150),(1830,165),(1850,260),(1820,360),(1760,420),(1690,470),(1690,580),(1560,565),(1400,535),(1375,440),
          (1400,370),(1520,350),(1680,290)]
CAPE = [(2000,545),(2065,560),(2150,605),(2250,635),(2400,620),(2500,548),(2700,550),(2780,620),(2800,800),
        (2760,980),(2600,1080),(2450,1150),(2262,1150),(2235,1010),(2130,890),(2040,770),(1985,700),(1968,620)]

def blur(a, s):
    return np.asarray(Image.fromarray((np.clip(a,0,1)*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(s)), dtype=np.float32)/255
def dilate(a, r):
    return np.asarray(Image.fromarray((a*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2*r+1)), dtype=np.float32)/255
def poly(pts):
    im = Image.new('L', (W, H), 0); ImageDraw.Draw(im).polygon(pts, fill=255); return im

def figure():
    im = poly(FIG); d = ImageDraw.Draw(im)
    d.ellipse((1470-52, 423-52, 1470+52, 423+52), fill=255)                 # staff curl
    d.line([(1500,455),(1575,490),(1625,508)], fill=255, width=28)
    d.line([(1615,500),(1665,548)], fill=255, width=34)
    d.line([(1645,535),(1715,600)], fill=255, width=44)
    d.line([(1640,528),(1700,582),(1900,769),(2012,862),(2240,1052)], fill=255, width=28)   # staff
    d.ellipse((2020,828,2100,915), fill=255)                               # hand
    d.ellipse((1708-30, 318-30, 1708+30, 318+30), fill=255)                # hat ornament
    d.line([(1720,335),(1760,362)], fill=255, width=14)
    return np.asarray(im, dtype=np.float32)/255

def main():
    img = np.asarray(Image.open(SRC).convert('L'), dtype=np.float32)/255
    F = figure()
    S = blur(np.asarray(poly(SPRAY), dtype=np.float32)/255, 30)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    moon = np.hypot(xx-MOON[0], yy-MOON[1]) < 270
    # clouds: local ink density
    dens = blur(img, 12)
    c = (dens > 0.25) & (dilate(F, 6) < 0.5) & (S < 0.5) & ~moon
    c = blur(c.astype(np.float32), 18) > 0.5          # drop star clusters / specks
    c = dilate(c.astype(np.float32), 9)
    c = c * (dilate(F, 3) < 0.5)
    c = np.maximum(c, (np.asarray(poly(HIDDEN), dtype=np.float32)/255) * (dilate(F, 8) > 0.5))
    C = blur(c, 5)
    Fa = blur(F, 2.0) * (1-S) + blur(F, 24) * S
    Fh = blur(F, 1.5)
    # cape flutter weight: grows away from the staff and the shoulder
    d = (xx-1700)*0.657 - (yy-565)*0.754
    ramp = np.clip((d-30)/270, 0, 1); ramp = ramp*ramp*(3-2*ramp)
    ramp *= np.clip((xx-1980)/500, 0, 1)**0.8
    K = blur(np.asarray(poly(CAPE), dtype=np.float32)/255, 28) * ramp
    def save(name, r, g, b):
        a = np.stack([r, g, b], -1); a = (np.clip(a,0,1)*255).astype(np.uint8)
        Image.fromarray(a).resize((W//2, H//2), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
    save('masks2.png', Fh, K, np.clip(blur(c, 30)/0.8, 0, 1)*c)
    if len(sys.argv) > 1:   # debug overlay
        o = np.stack([img*0.6 + 0.4*F, img*0.6 + 0.4*C, img*0.6 + 0.4*K], -1)
        Image.fromarray((np.clip(o,0,1)*255).astype(np.uint8)).save(sys.argv[1])

main()
