#!/usr/bin/env python3
"""Generate toolbar/store icons (16/32/48/128) for Jira Timesheet Viewer.

Renders a flat calendar-page mark (accent header strip + checkmark on the
body) in the extension's accent color (see src/panel/panel.css --accent).
Regenerate after any change to the design below:

    python scripts/make_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ACCENT = (0, 82, 204, 255)  # --accent from the UI spec (Jira blue, #0052CC)
WHITE = (255, 255, 255, 255)
SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 8  # render this many times larger, then downsample for anti-aliased edges

ROOT = Path(__file__).resolve().parent.parent
ICONS_DIR = ROOT / "icons"


def make_icon(target_size: int) -> Image.Image:
    size = target_size * SUPERSAMPLE
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    bg_radius = max(2, round(size * 0.22))
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=bg_radius, fill=ACCENT)

    # Calendar page (white), inset from the background square.
    pad = size * 0.16
    page_radius = max(1, round(size * 0.10))
    page_top = size * 0.20
    page_box = [pad, page_top, size - pad, size - pad]
    draw.rounded_rectangle(page_box, radius=page_radius, fill=WHITE)

    # Header strip across the top of the page, same accent as the
    # background, rounded only on its top corners so it reads as a flat
    # calendar header sitting on top of the white body.
    header_bottom = page_top + size * 0.18
    header_box = [pad, page_top, size - pad, header_bottom]
    draw.rounded_rectangle(
        header_box, radius=page_radius, corners=(True, True, False, False), fill=ACCENT
    )

    # Checkmark on the white body, below the header — the "logged" mark.
    stroke = max(1, round(size * 0.09))
    body_mid_y = (header_bottom + (size - pad)) / 2
    p1 = (size * 0.30, body_mid_y)
    p2 = (size * 0.44, body_mid_y + size * 0.11)
    p3 = (size * 0.73, body_mid_y - size * 0.15)
    draw.line([p1, p2, p3], fill=ACCENT, width=stroke, joint="curve")

    return img.resize((target_size, target_size), Image.LANCZOS)


def main() -> None:
    ICONS_DIR.mkdir(exist_ok=True)
    for size in SIZES:
        path = ICONS_DIR / f"{size}.png"
        make_icon(size).save(path)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
