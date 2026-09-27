"""Step 4: assemble pacer/data/course.json and the course GPX.

course.json holds everything the app needs about the marathon course:
  line      simplified centreline [lat, lon, d] (d = official metres, negative in the corral)
  racing    simplified shortest-route line [lat, lon] (the tangents the certified
            measurement uses)
  profile   road elevation every 10 m of official distance
  tunnels   [d0, d1] where there is no GPS (Tunnel Joseph-Samson, twice)
  exposure  [d0, d1, factor] share of the forecast wind felt at runner height
  aid       official aid-station kilometres (runner's guide p. 22)
  names     [d0, d1, street] for the "you are on" hint
"""
import json
import math
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_elevation import gaussian_smooth  # noqa: E402
from network import to_xy  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
AID_KM = [3.2, 5.8, 8.4, 11.1, 12.6, 15.1, 19.3, 22.9, 24.7, 27.0, 28.9, 32.9, 36.3, 37.4, 40.6]
AID_EXTRA = {15.1: "gel", 27.0: "gel", 24.7: "sponge", 37.4: "oranges"}


def douglas_peucker(xy, tol):
    keep = np.zeros(len(xy), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(xy) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = xy[a], xy[b]
        v = q - p
        L = math.hypot(*v)
        seg = xy[a + 1:b] - p
        if L == 0:
            dist = np.hypot(seg[:, 0], seg[:, 1])
        else:
            dist = np.abs(seg[:, 0] * v[1] - seg[:, 1] * v[0]) / L
        i = int(np.argmax(dist))
        if dist[i] > tol:
            m = a + 1 + i
            keep[m] = True
            stack += [(a, m), (m, b)]
    return np.nonzero(keep)[0]


def exposure_for(name, cls):
    """Share of the 10 m forecast wind felt at runner height (log profile x shelter)."""
    n = name or ""
    if "Tunnel" in n:
        return 0.0
    if n.startswith("Boulevard Champlain") or n.startswith("Impasse des Cageux"):
        return 0.65
    if n in ("Avenue Ontario", "Avenue George-VI", "Avenue Wolfe-Montcalm"):
        return 0.55   # Plains of Abraham, open parkland
    if "Rivière Saint-Charles" in n or "Promenade Samuel" in n:
        return 0.5    # river parkway, some trees
    if n.startswith("Chemin du Foulon") or n.startswith("Rue Champlain") or n.startswith("Route Verte"):
        return 0.4
    if cls in ("footway", "cycleway", "path") and not n:
        return 0.45
    if n.startswith("Grande Allée") or n.startswith("Chemin Saint-Louis") or n.startswith("Boulevard Laurier"):
        return 0.35
    return 0.3        # streets between buildings


def main(scratch, out_dir):
    D = json.load(open(os.path.join(scratch, "distance.json")))
    E = json.load(open(os.path.join(scratch, "elevation.json")))
    lat, lon, d = np.array(D["lat"]), np.array(D["lon"]), np.array(D["d"])
    attrs, ai = D["attrs"], D["attr_index"]

    # --- elevation: average the terrain model with the earlier GPX's elevations ---
    g = open(os.path.join(REPO, "42km.gpx"), encoding="utf-8").read()
    gp = np.array([(float(a), float(b), float(c)) for a, b, c in
                   re.findall(r'<trkpt lat="([\d.\-]+)" lon="([\d.\-]+)">\s*<ele>([\d.\-]+)</ele>', g)])
    x, y = to_xy(lon, lat)
    c = np.column_stack([x, y])
    gx, gy = to_xy(gp[:, 1], gp[:, 0])
    gd, last = [], 0
    for px, py in zip(gx, gy):
        lo, hi = max(0, last - 200), min(len(c), last + 3000)
        j = lo + int(np.argmin(np.hypot(c[lo:hi, 0] - px, c[lo:hi, 1] - py)))
        last = j
        gd.append(d[j])
    gd = np.array(gd)
    grid = np.array(E["d"])
    terr = np.array(E["ele"])
    old = np.interp(grid, gd, gp[:, 2])
    # structures: both sources are wrong over bridges/tunnels; interpolate the old one too
    mask = np.zeros(len(grid), bool)
    for a, b in E["structures"]:
        mask |= (grid >= a) & (grid <= b)
    idx = np.arange(len(grid))
    old[mask] = np.interp(idx[mask], idx[~mask], old[~mask])
    offset = float(np.median(terr - old))
    ele = gaussian_smooth(0.5 * terr + 0.5 * (old + offset), grid, 15.0)

    # --- simplified geometry ---
    keep = douglas_peucker(c, 0.6)
    line = [[round(float(lat[i]), 6), round(float(lon[i]), 6), round(float(d[i]), 1)] for i in keep]
    rx, ry = to_xy(np.array(D["rlon"]), np.array(D["rlat"]))
    rkeep = douglas_peucker(np.column_stack([rx, ry]), 0.6)
    racing = [[round(float(D["rlat"][i]), 6), round(float(D["rlon"][i]), 6), round(float(d[i]), 1)] for i in rkeep]

    # --- runs of attributes along the course ---
    def runs(fn):
        out, cur, start = [], None, None
        for i in range(len(d)):
            v = fn(attrs[ai[i]])
            if v != cur:
                if cur is not None:
                    out.append([round(float(start), 1), round(float(d[i]), 1), cur])
                cur, start = v, d[i]
        out.append([round(float(start), 1), round(float(d[-1]), 1), cur])
        return out

    tunnels = [[a, b] for a, b, v in runs(lambda a: "is_tunnel" in a["flags"]) if v and b - a > 30]
    exposure = runs(lambda a: exposure_for(a["name"], a["class"]))
    names = [r for r in runs(lambda a: a["name"] or "") if r[2]]

    course = {
        "name": "Marathon Beneva de Québec 2026",
        "distance": 42195,
        "gun": "2026-10-04T08:00:00-04:00",
        "start_line": D["start_line"],
        "finish_line": D["finish_line"],
        "line": line,
        "racing": racing,
        "profile": {"d0": float(grid[0]), "step": 10.0, "ele": [round(float(v), 2) for v in ele]},
        "tunnels": tunnels,
        "exposure": exposure,
        "aid": [{"km": k, "extra": AID_EXTRA.get(k)} for k in AID_KM],
        "names": names,
        "meta": {
            "centreline_m": round(D["centreline_m"], 1),
            "shortest_route_m": round(D["shortest_route_m"], 1),
            "distance_scale": round(D["scale"], 6),
            "sources": "Course trace 42km.gpx (checked against the official 2026 map) snapped to Overture Maps "
                       "street centrelines; start and finish lines from the official start-area map; distance "
                       "along the shortest legal route, scaled to the certified 42,195 m; elevation = mean of "
                       "AWS Terrain Tiles (CDEM) and the earlier trace's elevations.",
        },
    }
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "course.json"), "w") as f:
        json.dump(course, f, separators=(",", ":"))

    # --- GPX export (start line -> finish line, 1 point per ~5 m of detail) ---
    pe = np.interp(d, grid, ele)
    pts = [i for i in keep if d[i] >= -0.01]
    gpx = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<gpx version="1.1" creator="marathon-quebec-2026 pacer" xmlns="http://www.topografix.com/GPX/1/1">',
           '  <metadata><name>Marathon Beneva de Québec 2026 – 42,195 km</name>',
           '    <desc>Start line on Rue de l\'Exposition to the finish line on Avenue du Colisée. Street centrelines '
           '(Overture Maps / OpenStreetMap) following the checked 2026 course; elevation in metres.</desc></metadata>',
           '  <trk><name>Marathon Beneva de Québec 2026</name><trkseg>']
    for i in pts:
        gpx.append(f'    <trkpt lat="{lat[i]:.7f}" lon="{lon[i]:.7f}"><ele>{pe[i]:.1f}</ele></trkpt>')
    gpx += ['  </trkseg></trk>', '</gpx>', '']
    with open(os.path.join(out_dir, "marathon-2026.gpx"), "w", encoding="utf-8") as f:
        f.write("\n".join(gpx))
    print(f"line {len(line)} pts, racing {len(racing)} pts, profile {len(ele)}, tunnels {tunnels}, "
          f"elevation offset {offset:.2f} m, gpx {len(pts)} pts")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
