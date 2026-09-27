"""Register the official start-area map (runner's guide, page 15) to the street network.

The map is a raster image embedded in guide-coureur.pdf. Its white street lines are
chamfer-matched against Overture road centrelines to find the similarity transform
(scale, rotation, translation) from image pixels to local metres. The result places the
start line and the finish line to within a few metres.

Usage: python3 register_startmap.py OVERTURE_DIR OUT_JSON
"""
import json
import math
import os
import sys

import numpy as np
import pymupdf
from PIL import Image, ImageDraw
from scipy import ndimage, optimize

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from network import Network, to_xy  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
FOOT = ("footway", "cycleway", "path", "steps", "pedestrian", "track", "bridleway")

# Hand-picked control points for the initial guess: image px -> (lat, lon) intersection.
CONTROL = [((325, 180), (46.830066, -71.2435)),     # Avenue du Colisée x Rue Boisclerc
           ((565, 178), (46.830104, -71.237808)),   # 1re Avenue x 18e Rue
           ((400, 645), (46.822283, -71.241733))]   # Rue de la Pointe-aux-Lièvres x Rue Julien


def main(overture_dir, out_json):
    doc = pymupdf.open(os.path.join(REPO, "guide-coureur.pdf"))
    pix = pymupdf.Pixmap(doc, 87)  # the only image on page 15 (index 3)
    im = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].astype(int)
    white = (im[:, :, 0] > 242) & (im[:, :, 1] > 242) & (im[:, :, 2] > 242)
    white[:80, :] = False           # title
    white[630:, :300] = False       # legend
    vs, us = np.nonzero(white)

    net = Network(os.path.join(overture_dir, "segment.parquet"), bbox=(-71.2560, 46.8150, -71.2300, 46.8360))
    roads = [e for e in net.edges if e[4]["class"] not in FOOT]
    allxy = np.vstack([e[3] for e in roads])
    x0, y0 = allxy.min(0) - 50
    x1, y1 = allxy.max(0) + 50
    W, H = int(x1 - x0) + 1, int(y1 - y0) + 1
    canvas = Image.new("L", (W, H), 0)
    dr = ImageDraw.Draw(canvas)
    for e in roads:
        dr.line([(p[0] - x0, y1 - p[1]) for p in e[3]], fill=255, width=3)
    dist = ndimage.distance_transform_edt(~(np.array(canvas) > 0))

    def tf(p, u, v):
        s, th, tx, ty = p
        c, sn = math.cos(th), math.sin(th)
        return s * (c * u + sn * v) + tx, s * (sn * u - c * v) + ty

    def cost(p, sub=4):
        x, y = tf(p, us[::sub], vs[::sub])
        ci, ri = (x - x0).astype(int), (y1 - y).astype(int)
        ok = (ci >= 0) & (ci < W) & (ri >= 0) & (ri < H)
        d = np.full(len(x), 25.0)
        d[ok] = np.minimum(dist[ri[ok], ci[ok]], 25.0)
        return float(np.mean(d))

    A, B = [], []
    for (u, v), (lat, lon) in CONTROL:
        x, y = to_xy(lon, lat)
        A += [[u, v, 1, 0], [-v, u, 0, 1]]
        B += [float(x), float(y)]
    a, b, tx, ty = np.linalg.lstsq(np.array(A, float), np.array(B), rcond=None)[0]
    s, th = math.hypot(a, b), math.atan2(b, a)
    best = None
    for ds in np.linspace(-0.04, 0.04, 5):
        for dth in np.radians(np.linspace(-3, 3, 7)):
            r = optimize.minimize(cost, [s * (1 + ds), th + dth, tx, ty], method="Nelder-Mead",
                                  options={"xatol": 1e-4, "fatol": 1e-3, "maxiter": 2000})
            if best is None or r.fun < best.fun:
                best = r
    r = optimize.minimize(lambda p: cost(p, 1), best.x, method="Nelder-Mead",
                          options={"xatol": 1e-5, "fatol": 1e-4, "maxiter": 4000})
    out = {"params": [float(v) for v in r.x], "mean_distance_m": r.fun,
           "scale_m_per_px": float(r.x[0]), "rotation_deg": math.degrees(r.x[1])}
    json.dump(out, open(out_json, "w"), indent=1)
    print(out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
