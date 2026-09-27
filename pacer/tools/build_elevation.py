"""Step 3 of the course build: road-surface elevation along the course.

Terrain elevation is sampled every 10 m of centreline. Where the course is on a bridge
or in a tunnel the terrain model shows the river or the ground above instead of the
road, so those stretches (plus 15 m on either side) are replaced by a straight line
between the road elevations at each end. The result is lightly smoothed (40 m) to
remove the 1 m steps of the source model; grade-level smoothing happens in the pacing
model.
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from dem import Terrarium  # noqa: E402


def gaussian_smooth(y, x, sigma):
    """Gaussian smoothing on a uniform grid, reflecting at the ends."""
    dx = x[1] - x[0]
    k = int(3 * sigma / dx)
    if k < 1:
        return y.copy()
    w = np.exp(-0.5 * (np.arange(-k, k + 1) * dx / sigma) ** 2)
    w /= w.sum()
    pad = np.concatenate([y[k:0:-1], y, y[-2:-k - 2:-1]])
    return np.convolve(pad, w, mode="valid")


def main(distance_json, cache_dir, out_json):
    D = json.load(open(distance_json))
    lat, lon = np.array(D["lat"]), np.array(D["lon"])
    d = np.array(D["d"])
    attrs, ai = D["attrs"], D["attr_index"]
    T = Terrarium(cache_dir)
    grid = np.arange(d[0], d[-1] + 0.01, 10.0)
    glat = np.interp(grid, d, lat)
    glon = np.interp(grid, d, lon)
    raw = T.sample_many(glat, glon)

    structure = np.zeros(len(d), bool)
    for i in range(len(d)):
        f = attrs[ai[i]]["flags"]
        structure[i] = ("is_bridge" in f) or ("is_tunnel" in f)
    gs = np.interp(grid, d, structure.astype(float)) > 0.5
    # widen by 15 m each side
    widened = gs.copy()
    for sh in (1, 2):
        widened[sh:] |= gs[:-sh]
        widened[:-sh] |= gs[sh:]
    ele = raw.copy()
    idx = np.arange(len(grid))
    good = ~widened
    ele[widened] = np.interp(idx[widened], idx[good], raw[good])
    smooth = gaussian_smooth(ele, grid, 20.0)

    runs = []
    cur = None
    for i, w in enumerate(widened):
        if w and cur is None:
            cur = i
        if not w and cur is not None:
            runs.append([round(float(grid[cur]), 1), round(float(grid[i - 1]), 1)])
            cur = None
    out = {"d": [round(float(v), 1) for v in grid],
           "ele": [round(float(v), 2) for v in smooth],
           "raw": [round(float(v), 2) for v in raw],
           "structures": runs}
    json.dump(out, open(out_json, "w"))
    gain = float(np.clip(np.diff(smooth), 0, None).sum())
    print(f"{len(grid)} samples, min {smooth.min():.1f} m, max {smooth.max():.1f} m, "
          f"total climb {gain:.0f} m, structures {runs}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
