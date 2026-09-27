"""Practice-mode data: a runnable street graph and a coarse elevation grid for Québec City.

practice-graph.bin (little endian)
  'PGR1'
  uint32 nNodes, nEdges, nPts
  int32  nodeLat[nNodes], nodeLon[nNodes]            microdegrees
  uint32 edgeFrom[nEdges], edgeTo[nEdges], edgePt0[nEdges]
  float32 edgeLen[nEdges] (m), edgeCost[nEdges]
  uint16 edgePtN[nEdges]  (+ 2 bytes padding if nEdges is odd)
  int32  ptLat[nPts], ptLon[nPts]                    intermediate vertices, microdegrees

practice-dem.bin
  'PDEM'
  float64 lat0, lon0, dLat, dLon   (grid origin = south-west corner, cell size)
  uint32  nx, ny
  int16   ele[ny][nx]  decimetres
"""
import json
import math
import struct
import sys
from collections import defaultdict

import numpy as np
import pyarrow.parquet as pq
from shapely import wkb

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from dem import Terrarium  # noqa: E402

BBOX = (-71.42, 46.71, -71.14, 46.88)
RUNNABLE = {"primary": 1.12, "secondary": 1.08, "tertiary": 1.03, "residential": 1.0, "unclassified": 1.0,
            "living_street": 1.0, "service": 1.08, "pedestrian": 1.0, "footway": 1.0, "cycleway": 1.0,
            "path": 1.05, "track": 1.15, "steps": 3.0, "unknown": 1.1}
DEST = {"name": "Pavillon Charles-De Koninck (DKN), Université Laval", "lat": 46.781223, "lon": -71.274954}


def haversine(lat1, lon1, lat2, lon2):
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def dp_simplify(coords, tol_m):
    if len(coords) <= 2:
        return coords
    lat0 = coords[0][1]
    kx = 111320 * math.cos(math.radians(lat0))
    ky = 110950
    xy = np.array([((c[0] - coords[0][0]) * kx, (c[1] - coords[0][1]) * ky) for c in coords])
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
        d = np.hypot(seg[:, 0], seg[:, 1]) if L == 0 else np.abs(seg[:, 0] * v[1] - seg[:, 1] * v[0]) / L
        i = int(np.argmax(d))
        if d[i] > tol_m:
            m = a + 1 + i
            keep[m] = True
            stack += [(a, m), (m, b)]
    return [c for c, k in zip(coords, keep) if k]


def build_graph(overture, out_path):
    rows = pq.read_table(f"{overture}/segment.parquet").to_pylist()
    node_id = {}
    node_ll = []
    edges = []
    x0, y0, x1, y1 = BBOX
    for r in rows:
        if r["subtype"] != "road" or r.get("subclass") == "sidewalk":
            continue
        cls = r["class"] or "unknown"
        if cls not in RUNNABLE:
            continue
        flags = set()
        for rf in r.get("road_flags") or []:
            for v in rf.get("values") or []:
                flags.add(v)
        if "is_under_construction" in flags or "is_abandoned" in flags:
            continue
        g = wkb.loads(r["geometry"])
        coords = list(g.coords)
        lons = [c[0] for c in coords]
        lats = [c[1] for c in coords]
        if max(lons) < x0 or min(lons) > x1 or max(lats) < y0 or min(lats) > y1:
            continue
        # cumulative length to split at connectors
        cum = [0.0]
        for a, b in zip(coords[:-1], coords[1:]):
            cum.append(cum[-1] + haversine(a[1], a[0], b[1], b[0]))
        total = cum[-1]
        if total <= 0:
            continue
        conns = sorted(r["connectors"] or [], key=lambda c: c["at"])
        if not conns or conns[0]["at"] > 1e-9:
            conns = [{"connector_id": f"{r['id']}@0", "at": 0.0}] + conns
        if conns[-1]["at"] < 1 - 1e-9:
            conns = conns + [{"connector_id": f"{r['id']}@1", "at": 1.0}]
        for c0, c1 in zip(conns[:-1], conns[1:]):
            s0, s1 = c0["at"] * total, c1["at"] * total
            if s1 - s0 < 0.05:
                continue
            piece = [interp(coords, cum, s0)] + [coords[i] for i in range(len(cum)) if s0 < cum[i] < s1] + [interp(coords, cum, s1)]
            ids = []
            for c, pt in ((c0, piece[0]), (c1, piece[-1])):
                cid = c["connector_id"]
                if cid not in node_id:
                    node_id[cid] = len(node_ll)
                    node_ll.append((pt[1], pt[0]))
                ids.append(node_id[cid])
            length = s1 - s0
            piece = dp_simplify(piece, 1.5)
            edges.append((ids[0], ids[1], length, length * RUNNABLE[cls], piece[1:-1]))
    # largest connected component
    adj = defaultdict(list)
    for i, (u, v, *_rest) in enumerate(edges):
        adj[u].append(v)
        adj[v].append(u)
    seen = {}
    comp = 0
    best = (0, None)
    for n in range(len(node_ll)):
        if n in seen:
            continue
        stack = [n]
        seen[n] = comp
        size = 0
        while stack:
            u = stack.pop()
            size += 1
            for w in adj[u]:
                if w not in seen:
                    seen[w] = comp
                    stack.append(w)
        if size > best[0]:
            best = (size, comp)
        comp += 1
    keep_nodes = [n for n in range(len(node_ll)) if seen[n] == best[1]]
    remap = {n: i for i, n in enumerate(keep_nodes)}
    kept = [(remap[u], remap[v], L, c, pts) for (u, v, L, c, pts) in edges if u in remap and v in remap]
    lat = np.array([node_ll[n][0] for n in keep_nodes])
    lon = np.array([node_ll[n][1] for n in keep_nodes])
    pts_lat, pts_lon, pt0, ptn = [], [], [], []
    for (_, _, _, _, pts) in kept:
        pt0.append(len(pts_lat))
        ptn.append(len(pts))
        for p in pts:
            pts_lon.append(p[0])
            pts_lat.append(p[1])
    n, e, p = len(keep_nodes), len(kept), len(pts_lat)
    with open(out_path, "wb") as f:
        f.write(b"PGR1")
        f.write(struct.pack("<III", n, e, p))
        f.write(np.round(lat * 1e6).astype("<i4").tobytes())
        f.write(np.round(lon * 1e6).astype("<i4").tobytes())
        f.write(np.array([k[0] for k in kept], "<u4").tobytes())
        f.write(np.array([k[1] for k in kept], "<u4").tobytes())
        f.write(np.array(pt0, "<u4").tobytes())
        f.write(np.array([k[2] for k in kept], "<f4").tobytes())
        f.write(np.array([k[3] for k in kept], "<f4").tobytes())
        f.write(np.array(ptn, "<u2").tobytes())
        if e % 2:
            f.write(b"\0\0")
        f.write(np.round(np.array(pts_lat) * 1e6).astype("<i4").tobytes())
        f.write(np.round(np.array(pts_lon) * 1e6).astype("<i4").tobytes())
    print(f"graph: {n} nodes, {e} edges, {p} shape points, components {comp}, kept {best[0]}")


def interp(coords, cum, s):
    for i in range(len(cum) - 1):
        if cum[i] <= s <= cum[i + 1]:
            f = (s - cum[i]) / max(cum[i + 1] - cum[i], 1e-12)
            a, b = coords[i], coords[i + 1]
            return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
    return coords[-1]


def build_dem(cache, out_path, cell_m=40.0):
    x0, y0, x1, y1 = BBOX
    dlat = cell_m / 111195.0
    dlon = cell_m / (111195.0 * math.cos(math.radians((y0 + y1) / 2)))
    nx = int((x1 - x0) / dlon) + 1
    ny = int((y1 - y0) / dlat) + 1
    T = Terrarium(cache, zoom=13)
    grid = np.zeros((ny, nx), np.int16)
    for j in range(ny):
        lat = y0 + j * dlat
        for i in range(nx):
            lon = x0 + i * dlon
            grid[j, i] = int(round(T.sample(lat, lon) * 10))
    with open(out_path, "wb") as f:
        f.write(b"PDEM")
        f.write(struct.pack("<dddd", y0, x0, dlat, dlon))
        f.write(struct.pack("<II", nx, ny))
        f.write(grid.astype("<i2").tobytes())
    print(f"dem: {nx} x {ny} cells of {cell_m} m")


if __name__ == "__main__":
    overture, cache, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    build_graph(overture, f"{out_dir}/practice-graph.bin")
    build_dem(cache, f"{out_dir}/practice-dem.bin")
    json.dump(DEST, open(f"{out_dir}/practice-dest.json", "w"), ensure_ascii=False)
