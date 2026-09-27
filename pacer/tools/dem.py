"""Elevation sampling from the AWS Terrain Tiles (Terrarium encoding).

For Canada the tiles are built from the Canadian Digital Elevation Model (~20 m grid,
1 m vertical steps); bilinear sampling of zoom-15 tiles and the smoothing applied later
give a clean road profile.
"""
import math
import os
import urllib.request

import numpy as np
from PIL import Image

URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


class Terrarium:
    def __init__(self, cache_dir, zoom=15):
        self.cache = cache_dir
        self.z = zoom
        os.makedirs(cache_dir, exist_ok=True)
        self.tiles = {}

    def _tile(self, x, y):
        key = (x, y)
        if key not in self.tiles:
            path = os.path.join(self.cache, f"{self.z}_{x}_{y}.png")
            if not os.path.exists(path):
                data = urllib.request.urlopen(URL.format(z=self.z, x=x, y=y), timeout=60).read()
                with open(path, "wb") as f:
                    f.write(data)
            rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
            self.tiles[key] = rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768
        return self.tiles[key]

    def pixel(self, lat, lon):
        n = 2 ** self.z * 256
        px = (lon + 180) / 360 * n
        py = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
        return px - 0.5, py - 0.5  # pixel centres

    def value(self, px, py):
        tx, ty = int(px // 256), int(py // 256)
        return self._tile(tx, ty)[int(py - ty * 256), int(px - tx * 256)]

    def sample(self, lat, lon):
        px, py = self.pixel(lat, lon)
        x0, y0 = math.floor(px), math.floor(py)
        fx, fy = px - x0, py - y0
        v00 = self.value(x0, y0)
        v10 = self.value(x0 + 1, y0)
        v01 = self.value(x0, y0 + 1)
        v11 = self.value(x0 + 1, y0 + 1)
        return (v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy)

    def sample_many(self, lats, lons):
        return np.array([self.sample(a, b) for a, b in zip(lats, lons)])
