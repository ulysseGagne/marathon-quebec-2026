"""Walkable street network from Overture Maps segments.

Builds an undirected graph whose nodes are Overture connectors and whose edges are
the pieces of each road/path segment between consecutive connectors. Coordinates are
kept in lon/lat plus a local equirectangular metre projection centred on Québec City,
which is accurate to well under 0.1 % over the area we care about.
"""
import math

import numpy as np
import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import LineString
from shapely.strtree import STRtree

LAT0 = 46.80
LON0 = -71.25
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110950.0


def to_xy(lon, lat):
    return ((np.asarray(lon) - LON0) * KX, (np.asarray(lat) - LAT0) * KY)


def to_lonlat(x, y):
    return (np.asarray(x) / KX + LON0, np.asarray(y) / KY + LAT0)


def geodesic_m(lat1, lon1, lat2, lon2):
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _flags_for_range(rules, a, b):
    """Overture road_flags/level_rules entries apply to [between] or the whole segment."""
    out = set()
    for rule in rules or []:
        between = rule.get("between")
        if between is None or (between[0] < b and between[1] > a):
            for v in rule.get("values") or []:
                out.add(v)
    return out


def _level_for_range(rules, a, b):
    lv = 0
    for rule in rules or []:
        between = rule.get("between")
        if between is None or (between[0] < b and between[1] > a):
            lv = rule.get("value") or 0
    return lv


class Network:
    """Undirected graph of runnable ways."""

    def __init__(self, segment_parquet, bbox=None, exclude_classes=()):
        rows = pq.read_table(segment_parquet).to_pylist()
        node_index = {}
        node_xy = []
        edges = []  # (u, v, length_m, coords_xy (n,2), attrs)
        for r in rows:
            if r["subtype"] != "road":
                continue
            if r["class"] in exclude_classes:
                continue
            g = wkb.loads(r["geometry"])
            lon, lat = np.array(g.coords).T
            if bbox is not None:
                x0, y0, x1, y1 = bbox
                if lon.max() < x0 or lon.min() > x1 or lat.max() < y0 or lat.min() > y1:
                    continue
            x, y = to_xy(lon, lat)
            xy = np.column_stack([x, y])
            seglen = np.hypot(np.diff(x), np.diff(y))
            cum = np.concatenate([[0.0], np.cumsum(seglen)])
            total = cum[-1]
            if total <= 0:
                continue
            conns = sorted(r["connectors"] or [], key=lambda c: c["at"])
            if not conns or conns[0]["at"] > 1e-9:
                conns = [{"connector_id": f"{r['id']}@0", "at": 0.0}] + conns
            if conns[-1]["at"] < 1 - 1e-9:
                conns = conns + [{"connector_id": f"{r['id']}@1", "at": 1.0}]
            name = (r.get("names") or {}).get("primary") if r.get("names") else None
            for c0, c1 in zip(conns[:-1], conns[1:]):
                a, b = c0["at"], c1["at"]
                if b - a <= 1e-12:
                    continue
                s0, s1 = a * total, b * total
                piece = _cut(xy, cum, s0, s1)
                ids = []
                for c, pt in ((c0, piece[0]), (c1, piece[-1])):
                    cid = c["connector_id"]
                    if cid not in node_index:
                        node_index[cid] = len(node_xy)
                        node_xy.append(pt)
                    ids.append(node_index[cid])
                length = float(np.hypot(*np.diff(piece, axis=0).T).sum())
                attrs = {
                    "segment": r["id"],
                    "class": r["class"],
                    "subclass": r.get("subclass"),
                    "name": name,
                    "flags": sorted(_flags_for_range(r.get("road_flags"), a, b)),
                    "level": _level_for_range(r.get("level_rules"), a, b),
                }
                edges.append((ids[0], ids[1], length, piece, attrs))
        self.node_xy = np.array(node_xy)
        self.edges = edges
        self.n_nodes = len(node_xy)
        self.lines = [LineString(e[3]) for e in edges]
        self.tree = STRtree(self.lines)
        self._adj = None

    def adjacency(self):
        if self._adj is None:
            from scipy.sparse import coo_matrix
            u = np.array([e[0] for e in self.edges])
            v = np.array([e[1] for e in self.edges])
            w = np.array([max(e[2], 0.01) for e in self.edges])
            # keep the shortest edge between a node pair
            m = coo_matrix((np.concatenate([w, w]), (np.concatenate([u, v]), np.concatenate([v, u]))),
                           shape=(self.n_nodes, self.n_nodes)).tocsr()
            # coo->csr sums duplicates; rebuild with minimum instead
            import collections
            best = collections.defaultdict(lambda: float("inf"))
            self.pair_edge = {}
            for i, (a, b, L, _, _) in enumerate(self.edges):
                key = (min(a, b), max(a, b))
                if L < best[key]:
                    best[key] = L
                    self.pair_edge[key] = i
            rows, cols, vals = [], [], []
            for (a, b), L in best.items():
                rows += [a, b]
                cols += [b, a]
                vals += [max(L, 0.01), max(L, 0.01)]
            m = coo_matrix((vals, (rows, cols)), shape=(self.n_nodes, self.n_nodes)).tocsr()
            self._adj = m
        return self._adj


def _cut(xy, cum, s0, s1):
    """Sub-polyline of xy between arc lengths s0 < s1."""
    out = [_interp(xy, cum, s0)]
    for i in range(len(cum)):
        if s0 < cum[i] < s1:
            out.append(xy[i])
    out.append(_interp(xy, cum, s1))
    return np.array(out)


def _interp(xy, cum, s):
    i = int(np.searchsorted(cum, s, side="right") - 1)
    i = min(max(i, 0), len(cum) - 2)
    f = (s - cum[i]) / max(cum[i + 1] - cum[i], 1e-12)
    return xy[i] + (xy[i + 1] - xy[i]) * f


def project(piece, p):
    """Project point p on polyline piece -> (distance, arc position, point)."""
    best = (float("inf"), 0.0, None)
    acc = 0.0
    for i in range(len(piece) - 1):
        a, b = piece[i], piece[i + 1]
        d = b - a
        L2 = float(d @ d)
        L = math.sqrt(L2)
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, float((p - a) @ d) / L2))
        q = a + d * t
        dist = float(np.hypot(*(p - q)))
        if dist < best[0]:
            best = (dist, acc + t * L, q)
        acc += L
    return best
