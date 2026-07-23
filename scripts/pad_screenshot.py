#!/usr/bin/env python3
"""Compose a narrow UI screenshot onto an exact store-listing canvas.

Chrome Web Store and Edge Add-ons both require screenshots to be exactly
1280x800 or 640x400. The extension's own UI (side panel, popup) is tall and
narrow, so stretching it to that aspect ratio would distort it. This centers
the screenshot on a neutral card background with a soft shadow and rounded
corners instead, at native resolution (scaled up/down to fit, never
distorted).

Usage:
    python scripts/pad_screenshot.py <input.png> <output.png> [--fade PX]

--fade PX: if the source screenshot was cut off mid-content by the capture
viewport (rather than ending cleanly), fade out the bottom PX pixels of the
*source* image instead of showing a hard crop.
"""

import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

CANVAS = (1280, 800)
BG = (238, 242, 247, 255)  # soft neutral background
SHADOW = (15, 23, 42, 70)  # translucent dark, blurred into a drop shadow
RADIUS = 14
MAX_W, MAX_H = 1080, 640  # content box inside the canvas margins


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return mask


def bottom_fade_mask(size, fade_px):
    w, h = size
    mask = Image.new("L", size, 255)
    if fade_px > 0:
        grad = Image.new("L", (1, fade_px))
        for i in range(fade_px):
            grad.putpixel((0, i), round(255 * (1 - i / fade_px)))
        mask.paste(grad.resize((w, fade_px)), (0, h - fade_px))
    return mask


def compose(src_path: Path, out_path: Path, fade_px: int = 0) -> None:
    shot = Image.open(src_path).convert("RGBA")
    scale = min(MAX_W / shot.width, MAX_H / shot.height)
    new_size = (round(shot.width * scale), round(shot.height * scale))
    shot = shot.resize(new_size, Image.LANCZOS)

    canvas = Image.new("RGBA", CANVAS, BG)
    x = (CANVAS[0] - new_size[0]) // 2
    y = (CANVAS[1] - new_size[1]) // 2

    shadow_layer = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    shadow_shape = Image.new("RGBA", new_size, SHADOW)
    shadow_layer.paste(shadow_shape, (x, y + 10), rounded_mask(new_size, RADIUS))
    canvas = Image.alpha_composite(canvas, shadow_layer.filter(ImageFilter.GaussianBlur(16)))

    card = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    mask = rounded_mask(new_size, RADIUS)
    if fade_px:
        mask = ImageChops.multiply(mask, bottom_fade_mask(new_size, round(fade_px * scale)))
    card.paste(shot, (x, y), mask)
    canvas = Image.alpha_composite(canvas, card)

    canvas.convert("RGB").save(out_path)
    print(f"wrote {out_path} {canvas.size}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--fade", type=int, default=0, dest="fade_px")
    args = parser.parse_args()
    compose(args.input, args.output, fade_px=args.fade_px)
