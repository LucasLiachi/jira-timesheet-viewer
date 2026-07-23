#!/usr/bin/env python3
"""Generate the 1400x560 large promotional tile for the store listings.

Reuses the icon design from make_icons.py (rendered directly at the size
needed here, so it stays crisp) next to the extension name and a one-line
value proposition, on a plain white background.

Usage:
    python scripts/make_promo_tile.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from make_icons import make_icon

W, H = 1400, 560
BG = (255, 255, 255, 255)
TITLE = (17, 24, 39, 255)  # near-black navy
SUBTITLE = (87, 96, 105, 255)  # muted gray
ACCENT = (0, 82, 204, 255)  # --accent from the UI spec

FONT_DIR = Path(r"C:\Windows\Fonts")
TITLE_FONT = ImageFont.truetype(str(FONT_DIR / "segoeuib.ttf"), 62)
SUB_FONT = ImageFont.truetype(str(FONT_DIR / "segoeui.ttf"), 30)

TITLE_TEXT = "Jira Timesheet Viewer"
SUBTITLE_TEXT = "See what you logged, by day — read-only, opens Jira to log time."

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "store-assets" / "promo" / "large-tile-1400x560.png"


def main() -> None:
    icon_size = 240
    icon = make_icon(icon_size)

    canvas = Image.new("RGBA", (W, H), BG)
    draw = ImageDraw.Draw(canvas)

    icon_x = 110
    icon_y = (H - icon_size) // 2
    canvas.alpha_composite(icon, (icon_x, icon_y))

    text_x = icon_x + icon_size + 70

    title_bbox = draw.textbbox((0, 0), TITLE_TEXT, font=TITLE_FONT)
    sub_bbox = draw.textbbox((0, 0), SUBTITLE_TEXT, font=SUB_FONT)
    title_h = title_bbox[3] - title_bbox[1]
    sub_h = sub_bbox[3] - sub_bbox[1]
    gap = 22
    block_top = (H - (title_h + gap + sub_h)) // 2

    draw.text((text_x, block_top - title_bbox[1]), TITLE_TEXT, font=TITLE_FONT, fill=TITLE)
    draw.text(
        (text_x, block_top + title_h + gap - sub_bbox[1]), SUBTITLE_TEXT, font=SUB_FONT, fill=SUBTITLE
    )

    rule_y = block_top + title_h + gap // 2
    draw.rectangle([text_x, rule_y - 1, text_x + 64, rule_y + 2], fill=ACCENT)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUT_PATH)
    print(f"wrote {OUT_PATH} {canvas.size}")


if __name__ == "__main__":
    main()
