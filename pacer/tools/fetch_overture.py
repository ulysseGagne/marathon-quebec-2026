"""Download the Overture Maps layers the pacer needs for greater Québec City.

Writes GeoParquet-like parquet files (WKB geometry) into the given output dir.
Usage: python3 fetch_overture.py OUTDIR
"""
import os
import sys
import time

import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as pafs
import pyarrow.parquet as pq

RELEASE = "2026-09-23.1"
BBOX = (-71.46, 46.69, -71.11, 46.91)  # xmin, ymin, xmax, ymax

LAYERS = {
    "segment": ("transportation", "segment",
                ["id", "names", "subtype", "class", "subclass", "connectors", "road_flags",
                 "road_surface", "level_rules", "access_restrictions", "geometry", "bbox"]),
    "connector": ("transportation", "connector", ["id", "geometry", "bbox"]),
    "water": ("base", "water", ["id", "names", "subtype", "class", "is_intermittent", "geometry", "bbox"]),
    "land_use": ("base", "land_use", ["id", "names", "subtype", "class", "geometry", "bbox"]),
    "land": ("base", "land", ["id", "names", "subtype", "class", "geometry", "bbox"]),
    "land_cover": ("base", "land_cover", ["id", "subtype", "geometry", "bbox"]),
    "infrastructure": ("base", "infrastructure", ["id", "names", "subtype", "class", "geometry", "bbox"]),
    "place": ("places", "place", ["id", "names", "categories", "geometry", "bbox"]),
    "building": ("buildings", "building", ["id", "names", "class", "height", "num_floors", "geometry", "bbox"]),
}


def main(out):
    fs = pafs.S3FileSystem(anonymous=True, region="us-west-2",
                           proxy_options=os.environ.get("HTTPS_PROXY"))
    x0, y0, x1, y1 = BBOX
    for name, (theme, typ, cols) in LAYERS.items():
        target = os.path.join(out, f"{name}.parquet")
        if os.path.exists(target):
            print("skip", name)
            continue
        t = time.time()
        base = f"overturemaps-us-west-2/release/{RELEASE}/theme={theme}/type={typ}/"
        d = ds.dataset(base, filesystem=fs, format="parquet")
        cols = [c for c in cols if c in d.schema.names]
        flt = ((pc.field("bbox", "xmax") > x0) & (pc.field("bbox", "xmin") < x1) &
               (pc.field("bbox", "ymax") > y0) & (pc.field("bbox", "ymin") < y1))
        tbl = d.to_table(columns=cols, filter=flt)
        pq.write_table(tbl, target)
        print(name, tbl.num_rows, "rows", round(time.time() - t, 1), "s")


if __name__ == "__main__":
    main(sys.argv[1])
