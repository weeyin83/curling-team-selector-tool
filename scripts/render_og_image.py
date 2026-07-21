"""
Render og-image.png (1200x630) with Pillow.

We can't rely on cairo / cairosvg / rlPyCairo on Windows (they need
the native cairo DLL which isn't installed), so this script draws
the OG card directly with Pillow — a pure-Python dependency.

Kept as close as reasonably possible to the SVG source in og-image.svg,
but a couple of things (curling-stone highlight ellipse, filter blur on
the handle) are simplified because Pillow doesn't have those primitives.

Re-run this whenever you tweak the design in og-image.svg to keep
og-image.png in sync:

    python scripts/render_og_image.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

REPO = Path(__file__).parent.parent
OUT = REPO / "og-image.png"

W, H = 1200, 630


def load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    """Try Segoe UI (Windows) → Arial → DejaVu Sans → Pillow default."""
    candidates = []
    if bold:
        candidates += ["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"]
    else:
        candidates += ["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"]
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def linear_gradient(size, top, bottom) -> Image.Image:
    """Simple top→bottom gradient."""
    w, h = size
    base = Image.new("RGB", (1, h))
    px = base.load()
    for y in range(h):
        t = y / (h - 1)
        px[0, y] = (
            int(top[0] * (1 - t) + bottom[0] * t),
            int(top[1] * (1 - t) + bottom[1] * t),
            int(top[2] * (1 - t) + bottom[2] * t),
        )
    return base.resize((w, h))


def radial_stone(size: int) -> Image.Image:
    """Radial gradient matching the SVG stone (#a3b1c5 → #4a5b74 → #0f2540)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    cx, cy = size * 0.45, size * 0.35
    max_r = size * 0.7
    for y in range(size):
        for x in range(size):
            dx, dy = x - cx, y - cy
            t = min(max(((dx * dx + dy * dy) ** 0.5) / max_r, 0), 1)
            if t < 0.6:
                u = t / 0.6
                r = int(0xa3 * (1 - u) + 0x4a * u)
                g = int(0xb1 * (1 - u) + 0x5b * u)
                b = int(0xc5 * (1 - u) + 0x74 * u)
            else:
                u = (t - 0.6) / 0.4
                r = int(0x4a * (1 - u) + 0x0f * u)
                g = int(0x5b * (1 - u) + 0x25 * u)
                b = int(0x74 * (1 - u) + 0x40 * u)
            px[x, y] = (r, g, b, 255)
    return img


# --- Build the image ---------------------------------------------------
canvas = linear_gradient((W, H), top=(0x0b, 0x5c, 0xff), bottom=(0x07, 0x2a, 0x7a)).convert("RGBA")
draw = ImageDraw.Draw(canvas, "RGBA")

# Ice sheen
sheen = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(sheen).ellipse([-300, 500, W + 300, 940], fill=(255, 255, 255, int(255 * 0.12)))
sheen = sheen.filter(ImageFilter.GaussianBlur(radius=6))
canvas.alpha_composite(sheen)

# Curling stone
stone_diameter = 420
stone_ellipse_h = int(stone_diameter * 0.75)
stone_img = radial_stone(stone_diameter).resize((stone_diameter, stone_ellipse_h))
stone_mask = Image.new("L", (stone_diameter, stone_ellipse_h), 0)
ImageDraw.Draw(stone_mask).ellipse([0, 0, stone_diameter, stone_ellipse_h], fill=255)
stone_ellipse = stone_img.copy()
stone_ellipse.putalpha(stone_mask)
canvas.alpha_composite(stone_ellipse, (940 - stone_diameter // 2, 410 - stone_ellipse_h // 2))

# Stone highlight
highlight = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(highlight).ellipse([800, 334, 960, 386], fill=(255, 255, 255, int(255 * 0.28)))
highlight = highlight.filter(ImageFilter.GaussianBlur(radius=8))
canvas.alpha_composite(highlight)

# Handle (bar + top plate)
handle = Image.new("RGBA", (W, H), (0, 0, 0, 0))
hd = ImageDraw.Draw(handle)
hd.rounded_rectangle([880, 200, 1000, 270], radius=20, fill=(0xf5, 0x9e, 0x0b, 255))
hd.rounded_rectangle([905, 185, 975, 230], radius=14, fill=(0xfa, 0xcc, 0x15, 255))
handle = handle.filter(ImageFilter.GaussianBlur(radius=1))
canvas.alpha_composite(handle)

# --- Text --------------------------------------------------------------
white = (255, 255, 255, 255)
white_soft = (255, 255, 255, int(255 * 0.85))
white_dim = (255, 255, 255, int(255 * 0.70))

font_h1 = load_font(84, bold=True)
font_sub = load_font(30)
font_chip = load_font(22)
font_foot = load_font(20)

draw.text((80, 150), "Curling", font=font_h1, fill=white)
draw.text((80, 240), "Team Selector", font=font_h1, fill=white)
draw.text((80, 380), "Draw random teams — no envelopes required.", font=font_sub, fill=white_soft)


def chip(x: int, y: int, w: int, h: int, text: str) -> None:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle(
        [x, y, x + w, y + h],
        radius=h // 2,
        fill=(255, 255, 255, int(255 * 0.18)),
        outline=(255, 255, 255, int(255 * 0.35)),
        width=1,
    )
    text_bbox = ld.textbbox((0, 0), text, font=font_chip)
    tw = text_bbox[2] - text_bbox[0]
    th = text_bbox[3] - text_bbox[1]
    ld.text((x + (w - tw) // 2, y + (h - th) // 2 - 2), text, font=font_chip, fill=white)
    canvas.alpha_composite(layer)


chip(80, 470, 300, 52, "· 100% local & private")
chip(400, 470, 260, 52, "· One-click draw")
chip(680, 470, 220, 52, "· Excel import")

draw.text(
    (80, 580),
    "Built for curling clubs — free, no accounts, roster stays private.",
    font=font_foot,
    fill=white_dim,
)

# Flatten and save
final = Image.new("RGB", (W, H), (0x0b, 0x5c, 0xff))
final.paste(canvas.convert("RGB"), (0, 0))
final.save(OUT, "PNG", optimize=True)
print(f"wrote {OUT} ({OUT.stat().st_size} bytes, {W}x{H})")
