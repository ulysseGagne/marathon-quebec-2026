"""Step 2 of the course build: official distance along the course.

Certified courses (Athletics Canada / AIMS) are measured along the shortest possible
route a runner could legally take: 30 cm from the kerb, cutting every corner and every
curve. Street centrelines are 1-1.5 % longer than that on a course with this many turns,
and the difference is concentrated in the twisty sections, so a uniform scale factor
would misplace mid-race kilometres by tens of metres.

This step rebuilds the shortest route: a "taut string" pulled tight inside a corridor
around the centreline whose half-width comes from each road's class. Official distance
at any centreline position is the arc length of the taut string at the matching point,
finally scaled by the (small) residual factor that makes start line -> finish line equal
42,195 m exactly.

Output: build/distance.json with, for every centreline vertex (2 m spacing),
lat, lon, centreline arc s, official distance d, racing line lat/lon.
"""
import json
import math
import os
import sys

import numpy as np
from scipy.optimize import minimize

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from network import to_lonlat, to_xy  # noqa: E402

OFFICIAL_M = 42195.0
KERB_M = 0.3

# Full carriageway width (kerb to kerb) by Overture class, metres. Deliberately modest:
# closed lanes, parked cars and cones mean runners rarely get the whole width.
WIDTH = {
    "motorway": 14, "trunk": 14, "primary": 13, "secondary": 11, "tertiary": 9.5,
    "residential": 8, "unclassified": 8, "living_street": 7, "service": 5,
    "pedestrian": 6, "footway": 3, "cycleway": 3, "path": 3, "track": 3, "unknown": 5,
}


def resample(xy, step):
    cum = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(xy, axis=0).T))])
    n = int(cum[-1] // step) + 1
    s = np.linspace(0, cum[-1], n + 1)
    x = np.interp(s, cum, xy[:, 0])
    y = np.interp(s, cum, xy[:, 1])
    idx = np.clip(np.searchsorted(cum, s, side="right") - 1, 0, len(xy) - 2)
    return np.column_stack([x, y]), s, idx


def taut_string(c, half, pinned):
    """Shortest path r_i = c_i + t_i n_i with |t_i| <= half_i (pinned ends)."""
    d = np.gradient(c, axis=0)
    d /= np.maximum(np.hypot(d[:, 0], d[:, 1]), 1e-9)[:, None]
    n = np.column_stack([-d[:, 1], d[:, 0]])
    lo, hi = -half.copy(), half.copy()
    for i in pinned:
        lo[i] = hi[i] = 0.0

    def f(t):
        r = c + t[:, None] * n
        seg = np.diff(r, axis=0)
        L = np.hypot(seg[:, 0], seg[:, 1])
        L = np.maximum(L, 1e-9)
        u = seg / L[:, None]
        g = np.zeros(len(t))
        # dL_i/dt_i = -u_i . n_i ; dL_i/dt_{i+1} = u_i . n_{i+1}
        g[:-1] -= np.einsum("ij,ij->i", u, n[:-1])
        g[1:] += np.einsum("ij,ij->i", u, n[1:])
        return float(L.sum()), g

    t0 = np.zeros(len(c))
    res = minimize(f, t0, jac=True, method="L-BFGS-B", bounds=list(zip(lo, hi)),
                   options={"maxiter": 20000, "maxfun": 40000, "ftol": 1e-12, "gtol": 1e-7})
    return c + res.x[:, None] * n, res


def main(geometry_json, out_json):
    G = json.load(open(geometry_json))
    x, y = to_xy(np.array(G["lon"]), np.array(G["lat"]))
    xy = np.column_stack([x, y])
    cum = np.array(G["s"])
    attrs = G["attrs"]

    c, s, idx = resample(xy, 2.0)
    cls = [attrs[i]["class"] or "unknown" for i in idx]
    flags = [attrs[i]["flags"] for i in idx]
    width = np.array([WIDTH.get(k, 6) for k in cls], float)
    width = np.array([8.0 if "is_tunnel" in f else w for w, f in zip(width, flags)])
    # Road widths change at intersections; take the narrower of neighbours over 10 m so a
    # junction with a wide road doesn't widen the corridor of a narrow one.
    from scipy.ndimage import minimum_filter1d
    width = minimum_filter1d(width, size=5)
    half = np.maximum(width / 2 - KERB_M, 0.3)
    # Inside of a bend: the kerb corner is farther along the bisector than along a normal.
    d = np.gradient(c, axis=0)
    heading = np.unwrap(np.arctan2(d[:, 1], d[:, 0]))
    turn = np.abs(np.gradient(heading)) * 2  # turn over ~4 m
    half = half / np.maximum(np.cos(np.minimum(turn, 1.2) / 2), 0.5)

    i_start = int(np.argmin(np.abs(s - G["s_start"])))
    i_end = len(c) - 1
    pinned = [0, i_start, i_end]
    racing, res = taut_string(c, half, pinned)
    seg = np.hypot(*np.diff(racing, axis=0).T)
    rcum = np.concatenate([[0.0], np.cumsum(seg)])
    raw = rcum[i_end] - rcum[i_start]
    scale = OFFICIAL_M / raw
    dist = (rcum - rcum[i_start]) * scale
    print(f"centreline start->finish {s[i_end] - s[i_start]:.1f} m, shortest route {raw:.1f} m, "
          f"residual scale {scale:.5f}, optimiser: {res.message}")

    lon, lat = to_lonlat(c[:, 0], c[:, 1])
    rlon, rlat = to_lonlat(racing[:, 0], racing[:, 1])
    out = {
        "lat": [round(float(v), 7) for v in lat],
        "lon": [round(float(v), 7) for v in lon],
        "s": [round(float(v), 2) for v in s],
        "d": [round(float(v), 2) for v in dist],
        "rlat": [round(float(v), 7) for v in rlat],
        "rlon": [round(float(v), 7) for v in rlon],
        "i_start": i_start,
        "attr_index": [int(i) for i in idx],
        "attrs": attrs,
        "start_line": G["start_line"],
        "finish_line": G["finish_line"],
        "centreline_m": float(s[i_end] - s[i_start]),
        "shortest_route_m": float(raw),
        "scale": float(scale),
    }
    json.dump(out, open(out_json, "w"))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
