"""Hidden-Markov map matching of a GPS-like track onto the street network.

Classic Newson & Krumm (2009) formulation: candidates are projections of each track
point onto nearby edges; the emission probability is Gaussian in the projection
distance; the transition probability decays with the difference between the
network route distance and the straight-line distance of consecutive points.
"""
import heapq
import math

import numpy as np
from shapely.geometry import Point

from network import project


def densify(xy, step=10.0):
    out = [xy[0]]
    for a, b in zip(xy[:-1], xy[1:]):
        L = float(np.hypot(*(b - a)))
        n = max(1, int(math.ceil(L / step)))
        for k in range(1, n + 1):
            out.append(a + (b - a) * (k / n))
    return np.array(out)


class Matcher:
    def __init__(self, net, radius=35.0, max_radius=70.0, k=8, sigma=5.0, beta=4.0, jump_penalty=6.0):
        self.net = net
        self.radius = radius
        self.max_radius = max_radius
        self.k = k
        self.sigma = sigma
        self.beta = beta
        self.jump_penalty = jump_penalty
        self.adj = [[] for _ in range(net.n_nodes)]
        for i, (u, v, L, _, _) in enumerate(net.edges):
            self.adj[u].append((v, L, i))
            self.adj[v].append((u, L, i))
        self._sp_cache = {}

    def candidates(self, p):
        pt = Point(p)
        for r in (self.radius, self.max_radius):
            idx = self.net.tree.query(pt.buffer(r))
            cands = []
            for i in idx:
                d, pos, q = project(self.net.edges[i][3], p)
                if d <= r:
                    cands.append((d, int(i), pos, q))
            if cands:
                cands.sort(key=lambda c: c[0])
                return cands[: self.k]
        return []

    def sp(self, src, limit):
        key = (src, limit)
        hit = self._sp_cache.get(key)
        if hit is not None:
            return hit
        dist = {src: 0.0}
        prev = {src: None}
        heap = [(0.0, src)]
        while heap:
            d, u = heapq.heappop(heap)
            if d > dist.get(u, float("inf")) or d > limit:
                continue
            for v, L, e in self.adj[u]:
                nd = d + L
                if nd < dist.get(v, float("inf")) and nd <= limit:
                    dist[v] = nd
                    prev[v] = (u, e)
                    heapq.heappush(heap, (nd, v))
        self._sp_cache[key] = (dist, prev)
        return dist, prev

    def route(self, ca, cb, limit):
        """Network distance between two candidates and the connecting path description."""
        _, ea, pa, _ = ca
        _, eb, pb, _ = cb
        if ea == eb:
            return abs(pb - pa), ("same", ea, pa, pb)
        ua, va, La = self.net.edges[ea][:3]
        ub, vb, Lb = self.net.edges[eb][:3]
        best = (float("inf"), None)
        for end_a, da in ((ua, pa), (va, La - pa)):
            dist, prev = self.sp(end_a, limit)
            for end_b, db in ((ub, pb), (vb, Lb - pb)):
                if end_b in dist:
                    tot = da + dist[end_b] + db
                    if tot < best[0]:
                        best = (tot, ("path", ea, pa, end_a, end_b, eb, pb, limit))
        return best

    def match(self, xy):
        pts = densify(xy, 10.0)
        cands = [self.candidates(p) for p in pts]
        keep = [i for i, c in enumerate(cands) if c]
        pts = pts[keep]
        cands = [cands[i] for i in keep]
        n = len(pts)
        score = [np.array([-0.5 * (c[0] / self.sigma) ** 2 for c in cands[0]])]
        back = [None]
        trans_info = [None]
        for t in range(1, n):
            gc = float(np.hypot(*(pts[t] - pts[t - 1])))
            limit = gc * 4 + 60
            prev_scores = score[-1]
            cur = np.full(len(cands[t]), -np.inf)
            bp = np.zeros(len(cands[t]), dtype=int)
            info = [None] * len(cands[t])
            for j, cb in enumerate(cands[t]):
                em = -0.5 * (cb[0] / self.sigma) ** 2
                for i, ca in enumerate(cands[t - 1]):
                    if not np.isfinite(prev_scores[i]):
                        continue
                    rd, desc = self.route(ca, cb, limit)
                    # Off-network jump: the street data is sometimes disconnected (tunnel
                    # portals, new paths). Follow the straight line at a fixed penalty.
                    jump = float(np.hypot(*(cb[3] - ca[3])))
                    jump_cost = self.jump_penalty + abs(jump - gc) / self.beta
                    if not np.isfinite(rd) or abs(rd - gc) / self.beta > jump_cost:
                        rd, desc = jump, ("jump", ca[3], cb[3])
                        tr = -jump_cost
                    else:
                        tr = -abs(rd - gc) / self.beta
                    s = prev_scores[i] + tr + em
                    if s > cur[j]:
                        cur[j] = s
                        bp[j] = i
                        info[j] = desc
            if not np.isfinite(cur).any():
                # broken chain: restart from emissions only
                cur = np.array([-0.5 * (c[0] / self.sigma) ** 2 for c in cands[t]])
                bp[:] = -1
                info = [("break",)] * len(cands[t])
            score.append(cur)
            back.append(bp)
            trans_info.append(info)
        # backtrack
        j = int(np.argmax(score[-1]))
        seq = []
        for t in range(n - 1, -1, -1):
            seq.append((t, j))
            if t == 0:
                break
            pj = back[t][j]
            if pj < 0:
                pj = int(np.argmax(score[t - 1]))
            j = pj
        seq.reverse()
        return pts, cands, seq, trans_info

    def reconstruct(self, cands, seq, trans_info):
        """Turn the Viterbi sequence into a polyline (xy) with an edge index per vertex."""
        out_xy = []
        out_edge = []

        def add(p, e):
            if out_xy and float(np.hypot(*(np.asarray(p) - out_xy[-1]))) < 0.05:
                out_edge[-1] = e
                return
            out_xy.append(np.asarray(p, dtype=float))
            out_edge.append(e)

        def edge_sub(e, s0, s1):
            piece = self.net.edges[e][3]
            seg = np.hypot(*np.diff(piece, axis=0).T)
            cum = np.concatenate([[0], np.cumsum(seg)])
            if s0 <= s1:
                pts = [_at(piece, cum, s0)] + [piece[i] for i in range(len(cum)) if s0 < cum[i] < s1] + [_at(piece, cum, s1)]
            else:
                pts = [_at(piece, cum, s0)] + [piece[i] for i in range(len(cum) - 1, -1, -1) if s1 < cum[i] < s0] + [_at(piece, cum, s1)]
            return pts

        t0, j0 = seq[0]
        c0 = cands[t0][j0]
        add(c0[3], c0[1])
        for (ta, ja), (tb, jb) in zip(seq[:-1], seq[1:]):
            ca, cb = cands[ta][ja], cands[tb][jb]
            desc = trans_info[tb][jb]
            if desc is None or desc[0] == "break":
                add(cb[3], cb[1])
                continue
            if desc[0] == "jump":
                add(cb[3], cb[1])
                continue
            if desc[0] == "same":
                _, e, pa, pb = desc
                for p in edge_sub(e, pa, pb)[1:]:
                    add(p, e)
                continue
            _, ea, pa, end_a, end_b, eb, pb, limit = desc
            ua, va, La = self.net.edges[ea][:3]
            # leave edge a towards end_a
            target = 0.0 if end_a == ua else La
            for p in edge_sub(ea, pa, target)[1:]:
                add(p, ea)
            # node path end_a -> end_b
            dist, prev = self.sp(end_a, limit)
            path = []
            node = end_b
            while node != end_a:
                u, e = prev[node]
                path.append((u, node, e))
                node = u
            path.reverse()
            for u, v, e in path:
                eu, ev, L = self.net.edges[e][:3]
                if eu == u:
                    pts = edge_sub(e, 0.0, L)
                else:
                    pts = edge_sub(e, L, 0.0)
                for p in pts[1:]:
                    add(p, e)
            ub, vb, Lb = self.net.edges[eb][:3]
            start = 0.0 if end_b == ub else Lb
            for p in edge_sub(eb, start, pb)[1:]:
                add(p, eb)
        return np.array(out_xy), out_edge

def _at(piece, cum, s):
    i = int(np.searchsorted(cum, s, side="right") - 1)
    i = min(max(i, 0), len(cum) - 2)
    f = (s - cum[i]) / max(cum[i + 1] - cum[i], 1e-12)
    return piece[i] + (piece[i + 1] - piece[i]) * f


def remove_spurs(xy, edges, max_len=30.0, min_cos=-0.8):
    """Remove short out-and-back artefacts (A -> B -> ~A) produced at intersections.

    A genuine hairpin on the course has long legs, so only spurs whose two legs are
    both shorter than max_len are removed.
    """
    xy = [np.asarray(p, float) for p in xy]
    edges = list(edges)
    changed = True
    while changed:
        changed = False
        i = 1
        while i < len(xy) - 1:
            a = xy[i] - xy[i - 1]
            b = xy[i + 1] - xy[i]
            la, lb = float(np.hypot(*a)), float(np.hypot(*b))
            if la < 1e-6:
                del xy[i]; del edges[i]; changed = True; continue
            if lb < 1e-6:
                del xy[i + 1]; del edges[i + 1]; changed = True; continue
            if la < max_len and lb < max_len and float(a @ b) / (la * lb) < min_cos:
                del xy[i]; del edges[i]; changed = True
                continue
            i += 1
    return np.array(xy), edges
