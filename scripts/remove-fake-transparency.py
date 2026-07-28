#!/usr/bin/env python3
"""Turn a painted-on checkerboard "transparent" background into real alpha.

Usage:
    python3 scripts/remove-fake-transparency.py <sheet.png> [-o out.png]

Image generators (GPT et al.) often draw the transparency checkerboard into the
pixels instead of writing an alpha channel. This strips it: background pixels
are the near-neutral, near-white ones (both checker shades qualify), either
connected to the image border or forming a hole of at least --min-hole pixels
(so the gap inside a bow goes transparent, but a white eye highlight does not).
Output is RGBA, ready for scripts/split-icon-sheet.py.

# ponytail: hard alpha cut, no feathering - leaves at most ~1px of light fringe
# from the source's antialiasing, invisible at icon display sizes. If a sheet
# ever shows a visible halo, add a 1px alpha ramp along the mask boundary.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def background_mask(rgb, bright_min, sat_tol, min_hole):
    hi = rgb.max(axis=2).astype(np.int16)
    lo = rgb.min(axis=2).astype(np.int16)
    candidate = (lo >= bright_min) & (hi - lo <= sat_tol)

    labeled, n = ndimage.label(candidate)
    border = np.concatenate([labeled[0], labeled[-1], labeled[:, 0], labeled[:, -1]])
    on_border = set(np.unique(border)) - {0}
    sizes = ndimage.sum(np.ones_like(labeled), labeled, range(1, n + 1))
    keep = [i for i in range(1, n + 1) if i in on_border or sizes[i - 1] >= min_hole]
    return np.isin(labeled, keep)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("image", type=Path)
    p.add_argument("-o", "--out", type=Path, default=None, help="output path (default: <image>_alpha.png)")
    p.add_argument("--bright-min", type=int, default=235, help="lowest channel value a background pixel may have (default: 235)")
    p.add_argument("--sat-tol", type=int, default=12, help="max channel spread for a pixel to count as neutral grey (default: 12)")
    p.add_argument("--min-hole", type=int, default=100, help="smallest enclosed background region (px) that still gets cut out (default: 100)")
    args = p.parse_args()

    im = Image.open(args.image).convert("RGB")
    rgb = np.array(im)

    bg = background_mask(rgb, args.bright_min, args.sat_tol, args.min_hole)
    alpha = np.where(bg, 0, 255).astype(np.uint8)

    out = Image.fromarray(np.dstack([rgb, alpha]), mode="RGBA")
    out_path = args.out or args.image.with_name(args.image.stem + "_alpha.png")
    out.save(out_path)
    print(f"wrote {out_path} ({bg.mean() * 100:.1f}% of pixels made transparent)")


if __name__ == "__main__":
    main()
