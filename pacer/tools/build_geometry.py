"""Step 1 of the course build: exact street geometry of the 2026 marathon.

Inputs
  - 42km.gpx: the earlier course trace (gpx.studio routing, checked against the official
    2026 map, every point within ~40 m of the official route).
  - guide-coureur.pdf page 15: official start-area map, registered to the street network
    (see register_startmap.py) to locate the start line and the finish line.
  - Overture Maps transportation segments.

Output
  - build/geometry.json: dense polyline from the back of corral 1 to the finish line,
    with the arc position of the start line, and street attributes per vertex.

Corrections applied to the old trace before matching:
  - it began ~110 m after the real start line: the start line and the corral are prepended;
  - through Tunnel Joseph-Samson (km ~10.6-11.1 and ~36.5-37.0) it was a straight line
    through unmapped ground up to 35 m off the tunnel: both passes are forced through the
    tunnel centreline;
  - its last 150 m ran ~15 m beside Avenue du Colisée: the end is re-routed to the finish
    line of the official map.
"""
import json
import math
import os
import re
import sys

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mapmatch import Matcher, remove_spurs, densify  # noqa: E402
from network import Network, to_lonlat, to_xy  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TUNNEL_SEGMENT_NAME = "Tunnel Joseph-Samson"


def load_gpx(path):
    g = open(path, encoding="utf-8").read()
    pts = np.array([(float(a), float(b)) for a, b in
                    re.findall(r'<trkpt lat="([\d.\-]+)" lon="([\d.\-]+)"', g)])
    x, y = to_xy(pts[:, 1], pts[:, 0])
    return np.column_stack([x, y])


def cumlen(xy):
    return np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(xy, axis=0).T))])


def nearest_index(xy, p, lo, hi):
    d = np.hypot(*(xy[lo:hi] - p).T)
    return lo + int(np.argmin(d))


def splice(track, piece, km_lo, km_hi):
    """Replace the part of track nearest to piece's ends (within km range) by piece."""
    cum = cumlen(track)
    lo = int(np.searchsorted(cum, km_lo * 1000))
    hi = int(np.searchsorted(cum, km_hi * 1000))
    i0 = nearest_index(track, piece[0], lo, hi)
    i1 = nearest_index(track, piece[-1], lo, hi)
    assert i0 < i1, (i0, i1)
    return np.vstack([track[:i0], densify(piece, 10.0), track[i1 + 1:]])


def main(overture_dir, out_path, startmap_tf):
    seg_path = os.path.join(overture_dir, "segment.parquet")
    tbl = pq.read_table(seg_path)
    keep = [s not in ("sidewalk", "crosswalk") for s in tbl.column("subclass").to_pylist()]
    filtered = os.path.join(overture_dir, "segment_nosidewalk.parquet")
    pq.write_table(tbl.filter(pa.array(keep)), filtered)
    net = Network(filtered, bbox=(-71.31, 46.74, -71.18, 46.84), exclude_classes=("steps",))

    # Official start-area map registration: image px -> local metres (similarity).
    s, th, tx, ty = json.load(open(startmap_tf))["params"]

    def img(u, v):
        c, sn = math.cos(th), math.sin(th)
        return np.array([s * (c * u + sn * v) + tx, s * (sn * u - c * v) + ty])

    start_line = img(97.5, 398.0)    # right end of the corral blocks, where the lines start
    finish_line = img(303.0, 249.0)  # end of the course lines on Avenue du Colisée
    corral = np.array([img(12, 335), img(30, 375), img(47, 398), img(75, 398)])

    track = load_gpx(os.path.join(REPO, "42km.gpx"))

    # Tunnel Joseph-Samson: the underground edge plus its short surface tail at the SE portal.
    tunnel = [e for e in net.edges if e[4]["name"] == TUNNEL_SEGMENT_NAME and "is_tunnel" in e[4]["flags"]]
    assert len(tunnel) == 1, len(tunnel)
    tpiece = tunnel[0][3]
    nw_first = tpiece[0][1] > tpiece[-1][1]  # NW portal is the northern end
    t_nw_se = tpiece if nw_first else tpiece[::-1]
    track = splice(track, t_nw_se, 10.0, 11.6)          # outbound: NW -> SE
    track = splice(track, t_nw_se[::-1], 35.8, 37.4)    # return: SE -> NW

    # Finish: leave Rue Boisclerc onto Avenue du Colisée, straight to the official finish line.
    cum = cumlen(track)
    corner = nearest_index(track, np.array([495.0, 3330.0]), int(np.searchsorted(cum, 41500)), len(track))
    track = np.vstack([track[: corner + 1], densify(np.array([track[corner], finish_line]), 10.0)[1:]])

    guide = np.vstack([corral, start_line, track])
    m = Matcher(net)
    pts, cands, seq, info = m.match(guide)
    jumps = []
    cum_guide = cumlen(pts)
    for tb, jb in seq[1:]:
        d = info[tb][jb]
        if d is not None and d[0] == "jump":
            jumps.append((round(cum_guide[tb] / 1000, 3), round(float(np.hypot(*(d[2] - d[1]))), 1)))
    poly, edges = m.reconstruct(cands, seq, info)
    poly, edges = remove_spurs(poly, edges)

    # Arc positions of the start and finish lines on the matched polyline.
    cum = cumlen(poly)

    def locate(p, lo_frac, hi_frac):
        lo, hi = int(lo_frac * len(poly)), int(hi_frac * len(poly))
        best = (float("inf"), 0.0)
        for i in range(max(lo, 0), min(hi, len(poly) - 1)):
            a, b = poly[i], poly[i + 1]
            d = b - a
            L2 = float(d @ d)
            t = 0.0 if L2 == 0 else max(0.0, min(1.0, float((p - a) @ d) / L2))
            q = a + d * t
            dist = float(np.hypot(*(p - q)))
            if dist < best[0]:
                best = (dist, cum[i] + t * math.sqrt(L2))
        return best

    d_start, s_start = locate(start_line, 0.0, 0.05)
    d_finish, s_finish = locate(finish_line, 0.95, 1.0)
    # trim everything after the finish line
    k = int(np.searchsorted(cum, s_finish))
    fin_pt = poly[k - 1] + (poly[k] - poly[k - 1]) * ((s_finish - cum[k - 1]) / max(cum[k] - cum[k - 1], 1e-9))
    poly = np.vstack([poly[:k], fin_pt])
    edges = edges[:k] + [edges[k - 1]]
    cum = cumlen(poly)

    lon, lat = to_lonlat(poly[:, 0], poly[:, 1])
    attrs = []
    for e in edges:
        a = net.edges[e][4] if e is not None and e >= 0 else {}
        attrs.append({"name": a.get("name"), "class": a.get("class"), "flags": a.get("flags", []),
                      "level": a.get("level", 0), "segment": a.get("segment")})
    out = {
        "lat": [round(float(v), 7) for v in lat],
        "lon": [round(float(v), 7) for v in lon],
        "s": [round(float(v), 2) for v in cum],
        "s_start": round(float(s_start), 2),
        "s_finish": round(float(cum[-1]), 2),
        "start_line": [round(float(v), 7) for v in to_lonlat(*start_line)][::-1],
        "finish_line": [round(float(v), 7) for v in to_lonlat(*finish_line)][::-1],
        "start_snap_m": round(d_start, 1),
        "finish_snap_m": round(d_finish, 1),
        "jumps": jumps,
        "attrs": attrs,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    json.dump(out, open(out_path, "w"))
    print(f"vertices {len(poly)}, start line at s={s_start:.1f} m (snap {d_start:.1f} m), "
          f"finish at s={cum[-1]:.1f} m (snap {d_finish:.1f} m), "
          f"start->finish {cum[-1] - s_start:.1f} m, jumps {jumps}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
