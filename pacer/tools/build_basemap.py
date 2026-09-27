"""Offline basemap: Overture Maps -> vector tiles -> one PMTiles file.

Layers (Mapbox Vector Tile):
  roads     lines   c=class (motorway primary secondary tertiary minor service path rail),
                    n=name (z14+), t=1 in a tunnel, b=1 on a bridge
  water     polys   the St. Lawrence, the Saint-Charles, lakes, ponds
  waterway  lines   streams and canals
  green     polys   parks, the Plains of Abraham, golf courses, woods
  buildings polys   only within 350 m of the marathon course, zoom 15

Usage: python3 build_basemap.py OVERTURE_DIR COURSE_JSON OUT_PMTILES
"""
import gzip
import json
import math
import sys

import mapbox_vector_tile
import numpy as np
import pyarrow.parquet as pq
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from shapely import wkb
from shapely.affinity import affine_transform
from shapely.geometry import LineString, box, mapping
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

BBOX = (-71.42, 46.71, -71.14, 46.88)
ZMIN, ZMAX = 11, 15
EXTENT = 4096
BUFFER = 80  # tile units
R = 6378137.0
WORLD = 2 * math.pi * R

ROAD_CLASS = {
    "motorway": "motorway", "trunk": "motorway", "primary": "primary", "secondary": "secondary",
    "tertiary": "tertiary", "residential": "minor", "unclassified": "minor", "living_street": "minor",
    "service": "service", "pedestrian": "path", "footway": "path", "cycleway": "path", "path": "path",
    "steps": "path", "track": "path", "bridleway": "path", "unknown": "minor",
}
ROAD_MINZOOM = {"motorway": 11, "primary": 11, "secondary": 12, "tertiary": 12, "minor": 13,
                "service": 14, "path": 14, "rail": 12}
GREEN_LANDUSE = {"park", "recreation", "golf", "cemetery", "horticulture", "winter_sports"}
GREEN_LANDUSE_CLASS = {"grass", "meadow", "village_green"}
GREEN_LAND = {"forest", "grass", "wetland", "shrub"}


def merc(lon, lat):
    x = np.radians(lon) * R
    y = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * R
    return x, y


def to_merc(g):
    return transform(lambda x, y, z=None: merc(np.asarray(x), np.asarray(y)), g)


def tile_bounds(z, x, y):
    size = WORLD / 2 ** z
    minx = -WORLD / 2 + x * size
    maxy = WORLD / 2 - y * size
    return minx, maxy - size, minx + size, maxy


def tiles_for_bbox(z):
    n = 2 ** z
    def tx(lon): return int((lon + 180) / 360 * n)
    def ty(lat):
        return int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    x0, x1 = tx(BBOX[0]), tx(BBOX[2])
    y0, y1 = ty(BBOX[3]), ty(BBOX[1])
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def load(overture, course_json):
    clip = to_merc(box(*BBOX))
    feats = {"roads": [], "water": [], "waterway": [], "green": [], "buildings": []}

    for r in pq.read_table(f"{overture}/segment.parquet").to_pylist():
        if r.get("subclass") in ("sidewalk", "crosswalk"):
            continue
        if r["subtype"] == "rail":
            c = "rail"
        elif r["subtype"] == "road":
            c = ROAD_CLASS.get(r["class"] or "unknown", "minor")
        else:
            continue
        flags = set()
        for rf in r.get("road_flags") or []:
            for v in rf.get("values") or []:
                flags.add(v)
        if c == "rail" and ("is_tunnel" in flags):
            continue
        g = to_merc(wkb.loads(r["geometry"]))
        if not g.intersects(clip):
            continue
        name = (r.get("names") or {}).get("primary") if r.get("names") else None
        props = {"c": c}
        if "is_tunnel" in flags:
            props["t"] = 1
        if "is_bridge" in flags:
            props["b"] = 1
        feats["roads"].append((g, props, ROAD_MINZOOM[c], name))

    for r in pq.read_table(f"{overture}/water.parquet").to_pylist():
        if r["subtype"] in ("human_made", "physical", "spring"):
            continue
        g = to_merc(wkb.loads(r["geometry"]))
        if not g.intersects(clip):
            continue
        if g.geom_type in ("Polygon", "MultiPolygon"):
            feats["water"].append((g.intersection(clip.buffer(2000)), {}, 11, None))
        elif g.geom_type in ("LineString", "MultiLineString"):
            feats["waterway"].append((g, {}, 13, None))

    greens = []
    for r in pq.read_table(f"{overture}/land_use.parquet").to_pylist():
        if r["subtype"] in GREEN_LANDUSE or r["class"] in GREEN_LANDUSE_CLASS:
            g = wkb.loads(r["geometry"])
            if g.geom_type in ("Polygon", "MultiPolygon"):
                greens.append(to_merc(g))
    for r in pq.read_table(f"{overture}/land.parquet").to_pylist():
        if r["subtype"] in GREEN_LAND:
            g = wkb.loads(r["geometry"])
            if g.geom_type in ("Polygon", "MultiPolygon"):
                greens.append(to_merc(g))
    for g in greens:
        if g.intersects(clip) and g.is_valid:
            area = g.area
            feats["green"].append((g, {}, 12 if area > 40000 else 13 if area > 5000 else 14, None))

    # buildings along the marathon course only
    c = json.load(open(course_json))
    lx, ly = merc(np.array([p[1] for p in c["line"]]), np.array([p[0] for p in c["line"]]))
    corridor = LineString(np.column_stack([lx, ly])).buffer(350 / math.cos(math.radians(46.8)))
    ctree_geom = corridor
    for r in pq.read_table(f"{overture}/building.parquet", columns=["geometry"]).to_pylist():
        g = wkb.loads(r["geometry"])
        if g.geom_type not in ("Polygon", "MultiPolygon"):
            continue
        g = to_merc(g)
        if g.intersects(ctree_geom):
            feats["buildings"].append((g, {}, 15, None))
    return feats


def build(overture, course_json, out):
    feats = load(overture, course_json)
    for k, v in feats.items():
        print(k, len(v))
    trees = {k: STRtree([f[0] for f in v]) if v else None for k, v in feats.items()}
    writer_tiles = []
    for z in range(ZMIN, ZMAX + 1):
        size = WORLD / 2 ** z
        tol = size / EXTENT * 1.5
        simplified = {}
        for k, v in feats.items():
            simplified[k] = [None] * len(v)
        count = 0
        for (tx, ty) in tiles_for_bbox(z):
            minx, miny, maxx, maxy = tile_bounds(z, tx, ty)
            pad = size * BUFFER / EXTENT
            tb = box(minx - pad, miny - pad, maxx + pad, maxy + pad)
            layers = []
            for k, v in feats.items():
                if trees[k] is None:
                    continue
                out_feats = []
                for i in trees[k].query(tb):
                    g, props, minz, name = v[i]
                    if z < minz:
                        continue
                    if simplified[k][i] is None:
                        simplified[k][i] = g.simplify(tol, preserve_topology=(g.geom_type != "LineString"))
                    sg = simplified[k][i]
                    if sg.is_empty:
                        continue
                    if k in ("water", "green", "buildings") and z < 15 and sg.area < (size / 256) ** 2 * 4:
                        continue
                    try:
                        cg = sg.intersection(tb)
                    except Exception:
                        cg = sg.buffer(0).intersection(tb)
                    if cg.is_empty:
                        continue
                    # to tile units, y down
                    s = EXTENT / size
                    tg = affine_transform(cg, [s, 0, 0, -s, -minx * s, maxy * s])
                    p = dict(props)
                    if name and z >= 14:
                        p["n"] = name
                    out_feats.append({"geometry": tg, "properties": p})
                if out_feats:
                    layers.append({"name": k, "features": out_feats})
            if not layers:
                continue
            data = mapbox_vector_tile.encode(layers, default_options={"extents": EXTENT, "y_coord_down": True})
            writer_tiles.append((zxy_to_tileid(z, tx, ty), gzip.compress(data, 9)))
            count += 1
        print("zoom", z, "tiles", count)
    writer_tiles.sort()
    with open(out, "wb") as f:
        w = Writer(f)
        for tid, data in writer_tiles:
            w.write_tile(tid, data)
        e7 = lambda v: int(round(v * 1e7))
        w.finalize(
            {
                "tile_type": TileType.MVT, "tile_compression": Compression.GZIP,
                "min_zoom": ZMIN, "max_zoom": ZMAX,
                "min_lon_e7": e7(BBOX[0]), "min_lat_e7": e7(BBOX[1]),
                "max_lon_e7": e7(BBOX[2]), "max_lat_e7": e7(BBOX[3]),
                "center_zoom": 13, "center_lon_e7": e7(-71.235), "center_lat_e7": e7(46.805),
            },
            {
                "name": "Québec City pacer basemap",
                "attribution": "© OpenStreetMap contributors, Overture Maps Foundation",
                "vector_layers": [{"id": k, "fields": {}} for k in feats],
            },
        )
    print("tiles", len(writer_tiles), "bytes", sum(len(d) for _, d in writer_tiles))


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2], sys.argv[3])
