#!/usr/bin/env python3
"""Generate placeholder toolbar icons (16/32/48/128) so the extension loads.

These are intentionally plain — a solid accent square with a checkmark — so
nobody mistakes them for final branding. Replace icons/*.png with real
artwork before submitting to the Chrome Web Store (see CLAUDE.md, "Chrome
Web Store" section, store listing assets).

Usage:
    python scripts/make_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ACCENT = (0, 82, 204, 255)  # --accent from the UI spec
MARK = (255, 255, 255, 255)
SIZES = (16, 32, 48, 128)

ROOT = Path(__file__).resolve().parent.parent
ICONS_DIR = ROOT / "icons"


def make_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    radius = max(2, size // 6)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=ACCENT)

    # Simple checkmark, scaled to the icon size.
    stroke = max(1, size // 8)
    p1 = (size * 0.24, size * 0.52)
    p2 = (size * 0.44, size * 0.72)
    p3 = (size * 0.78, size * 0.30)
    draw.line([p1, p2, p3], fill=MARK, width=stroke, joint="curve")

    return img


def main() -> None:
    ICONS_DIR.mkdir(exist_ok=True)
    for size in SIZES:
        path = ICONS_DIR / f"{size}.png"
        make_icon(size).save(path)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
