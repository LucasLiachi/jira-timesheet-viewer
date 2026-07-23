#!/usr/bin/env python3
"""Generate the 440x280 small promotional tile for the store listings.

Same icon/brand as make_promo_tile.py, but laid out for the small tile's
tighter, more square-ish canvas: icon centered on top, name and a short
tagline stacked below it, instead of the large tile's side-by-side layout.

Usage:
    python scripts/make_small_tile.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from make_icons import make_icon

W, H = 440, 280
BG = (255, 255, 255, 255)
TITLE = (17, 24, 39, 255)  # near-black navy
SUBTITLE = (87, 96, 105, 255)  # muted gray
ACCENT = (0, 82, 204, 255)  # --accent from the UI spec

FONT_DIR = Path(r"C:\Windows\Fonts")
TITLE_TEXT = "Jira Timesheet Viewer"
SUBTITLE_TEXT = "Read-only worklog viewer"

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "store-assets" / "promo" / "small-tile-440x280.png"

MAX_TEXT_W = 388  # 440 - 2*26 margin


def fit_font(draw, text, path, start_size, min_size, max_w):
    size = start_size
    while size > min_size:
        font = ImageFont.truetype(str(path), size)
        bbox = draw.textbbox((0, 0), text, font=font)
        if bbox[2] - bbox[0] <= max_w:
            return font, bbox
        size -= 1
    font = ImageFont.truetype(str(path), min_size)
    return font, draw.textbbox((0, 0), text, font=font)


def main() -> None:
    canvas = Image.new("RGBA", (W, H), BG)
    draw = ImageDraw.Draw(canvas)

    icon_size = 108
    icon = make_icon(icon_size)
    icon_top = 26
    icon_x = (W - icon_size) // 2
    canvas.alpha_composite(icon, (icon_x, icon_top))

    title_font, title_bbox = fit_font(
        draw, TITLE_TEXT, FONT_DIR / "segoeuib.ttf", start_size=30, min_size=20, max_w=MAX_TEXT_W
    )
    title_h = title_bbox[3] - title_bbox[1]
    title_w = title_bbox[2] - title_bbox[0]
    title_top = icon_top + icon_size + 16
    draw.text(
        ((W - title_w) // 2 - title_bbox[0], title_top - title_bbox[1]),
        TITLE_TEXT,
        font=title_font,
        fill=TITLE,
    )

    sub_font, sub_bbox = fit_font(
        draw, SUBTITLE_TEXT, FONT_DIR / "segoeui.ttf", start_size=17, min_size=13, max_w=MAX_TEXT_W
    )
    sub_h = sub_bbox[3] - sub_bbox[1]
    sub_w = sub_bbox[2] - sub_bbox[0]
    sub_top = title_top + title_h + 10
    draw.text(
        ((W - sub_w) // 2 - sub_bbox[0], sub_top - sub_bbox[1]), SUBTITLE_TEXT, font=sub_font, fill=SUBTITLE
    )

    rule_w = 48
    rule_y = sub_top + sub_h + 14
    draw.rectangle([(W - rule_w) // 2, rule_y, (W + rule_w) // 2, rule_y + 3], fill=ACCENT)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUT_PATH)
    print(f"wrote {OUT_PATH} {canvas.size}")


if __name__ == "__main__":
    main()
