#!/usr/bin/env python3
"""Split a transparent-background icon sheet into individual PNGs.

Usage:
    python3 scripts/split-icon-sheet.py <sheet.png> --count N [options]

Detects icons via connected components on the alpha channel (works because
the sheet's background is already transparent - icons are just non-transparent
blobs of varying size/position, not necessarily on a regular grid). Crops are
dumped as numbered files in reading order (top-to-bottom, left-to-right) into
a staging folder for you to inspect, rename, and move into place by hand.

# ponytail: alpha threshold / closing kernel / min area below are tuned to
# icons3.png's soft-glow style. A sheet with crisper edges or a different glow
# radius may need different values - pass --alpha-threshold / --min-area /
# --close-kernel to retune rather than editing the defaults.
"""

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def find_icon_boxes(alpha, alpha_threshold, close_kernel, dilate_iters, min_area):
    mask = alpha > alpha_threshold
    if close_kernel > 0:
        struct = np.ones((close_kernel, close_kernel))
        mask = ndimage.binary_closing(mask, structure=struct)
    if dilate_iters > 0:
        mask = ndimage.binary_dilation(mask, iterations=dilate_iters)

    labeled, n = ndimage.label(mask)
    sizes = ndimage.sum(np.ones_like(labeled), labeled, range(1, n + 1))
    boxes = ndimage.find_objects(labeled)
    return [boxes[i] for i in range(n) if sizes[i] > min_area]


def reading_order(boxes, row_tolerance_frac=0.5):
    items = []
    for ys, xs in boxes:
        cy = (ys.start + ys.stop) / 2
        cx = (xs.start + xs.stop) / 2
        h = ys.stop - ys.start
        items.append({"box": (ys, xs), "cy": cy, "cx": cx, "h": h})

    items.sort(key=lambda it: it["cy"])

    rows = []
    for it in items:
        placed = False
        for row in rows:
            if abs(it["cy"] - row["cy"]) < row_tolerance_frac * min(it["h"], row["h"]):
                row["items"].append(it)
                row["cy"] = sum(x["cy"] for x in row["items"]) / len(row["items"])
                placed = True
                break
        if not placed:
            rows.append({"cy": it["cy"], "h": it["h"], "items": [it]})

    rows.sort(key=lambda r: r["cy"])
    ordered = []
    for row in rows:
        ordered.extend(sorted(row["items"], key=lambda it: it["cx"]))
    return [it["box"] for it in ordered]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("sheet", type=Path, help="path to the icon sheet PNG (must have an alpha channel)")
    p.add_argument("--count", type=int, required=True, help="expected number of icons; script errors if it finds a different number")
    p.add_argument("--out", type=Path, default=None, help="output dir for numbered crops (default: <sheet>_split/ next to the sheet)")
    p.add_argument("--pad", type=int, default=10, help="pixels of margin added around each detected box (default: 10)")
    p.add_argument("--alpha-threshold", type=int, default=10, help="alpha value above which a pixel counts as icon content (default: 10)")
    p.add_argument("--close-kernel", type=int, default=15, help="size of the morphological closing kernel used to merge gaps within one icon (default: 15)")
    p.add_argument("--dilate-iters", type=int, default=2, help="dilation iterations applied after closing (default: 2)")
    p.add_argument("--min-area", type=int, default=2000, help="components smaller than this (px) are discarded as noise (default: 2000)")
    args = p.parse_args()

    im = Image.open(args.sheet)
    if im.mode != "RGBA":
        sys.exit(f"error: {args.sheet} has no alpha channel (mode={im.mode}); this script needs a transparent-background sheet")
    alpha = np.array(im.split()[-1]).astype(np.float32)

    boxes = find_icon_boxes(alpha, args.alpha_threshold, args.close_kernel, args.dilate_iters, args.min_area)
    boxes = reading_order(boxes)

    if len(boxes) != args.count:
        print(f"error: found {len(boxes)} icon(s), expected {args.count}. Detected boxes:", file=sys.stderr)
        for ys, xs in boxes:
            print(f"  x=[{xs.start},{xs.stop}) y=[{ys.start},{ys.stop}) w={xs.stop-xs.start} h={ys.stop-ys.start}", file=sys.stderr)
        print("Adjust --alpha-threshold / --min-area / --close-kernel and retry.", file=sys.stderr)
        sys.exit(1)

    out_dir = args.out or args.sheet.with_name(args.sheet.stem + "_split")
    out_dir.mkdir(parents=True, exist_ok=True)

    w, h = im.size
    for i, (ys, xs) in enumerate(boxes, start=1):
        left = max(0, xs.start - args.pad)
        top = max(0, ys.start - args.pad)
        right = min(w, xs.stop + args.pad)
        bottom = min(h, ys.stop + args.pad)
        crop = im.crop((left, top, right, bottom))
        out_path = out_dir / f"{i:02d}.png"
        crop.save(out_path)
        print(f"wrote {out_path} ({crop.width}x{crop.height})")

    print(f"\n{len(boxes)} icons written to {out_dir}/ — inspect, rename, and move the ones you want into art/icons/.")


if __name__ == "__main__":
    main()
