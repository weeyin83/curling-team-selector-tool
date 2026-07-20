"""
Render PWA / home-screen icons with Pillow.

Generates the icon set referenced by manifest.webmanifest and the
apple-touch-icon in the HTML head:

    icons/icon-192.png            (any     — Android home screen)
    icons/icon-512.png            (any     — Android splash + Play Store)
    icons/icon-192-maskable.png   (maskable — Android adaptive icon)
    icons/icon-512-maskable.png   (maskable — larger variant)
    icons/apple-touch-icon-180.png (iOS home screen)

Design matches favicon2.svg and og-image.png — dark-blue brand
gradient with a stylised curling stone (orange handle, radial-shaded
stone body). Maskable variants add ~15% safe-zone padding so Android
can crop them into circles/squircles without clipping the artwork.

Re-run whenever the brand mark changes:

    python scripts/render_pwa_icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

REPO = Path(__file__).parent.parent
OUT_DIR = REPO / "icons"
OUT_DIR.mkdir(exist_ok=True)


def linear_gradient(size, top, bottom) -> Image.Image:
    """Simple top→bottom gradient."""
    w, h = size
    base = Image.new("RGB", (1, h))
    px = base.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        px[0, y] = (
            int(top[0] * (1 - t) + bottom[0] * t),
            int(top[1] * (1 - t) + bottom[1] * t),
            int(top[2] * (1 - t) + bottom[2] * t),
        )
    return base.resize((w, h))


def radial_stone(size: int) -> Image.Image:
    """Radial gradient stone (#6b7d92 → #2f3f56 → #0f2540) matching favicon2.svg."""
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
                r = int(0x6b * (1 - u) + 0x2f * u)
                g = int(0x7d * (1 - u) + 0x3f * u)
                b = int(0x92 * (1 - u) + 0x56 * u)
            else:
                u = (t - 0.6) / 0.4
                r = int(0x2f * (1 - u) + 0x0f * u)
                g = int(0x3f * (1 - u) + 0x25 * u)
                b = int(0x56 * (1 - u) + 0x40 * u)
            px[x, y] = (r, g, b, 255)
    return img


def render_icon(size: int, *, maskable: bool = False, transparent_bg: bool = False) -> Image.Image:
    """
    Render one square icon.

    maskable=True     adds ~15% safe-zone padding around the artwork so
                      Android can crop it into circles/squircles.
    transparent_bg=True gives the icon a transparent background instead
                      of the blue gradient (used for the Apple touch icon
                      only if desired — currently unused).
    """
    canvas_size = size
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))

    # Background: brand blue gradient (or transparent for special cases).
    if not transparent_bg:
        bg = linear_gradient(
            (canvas_size, canvas_size),
            top=(0x0b, 0x5c, 0xff),
            bottom=(0x07, 0x2a, 0x7a),
        ).convert("RGBA")
        canvas.alpha_composite(bg)

    # Safe zone: 80% for normal icons, 68% for maskable (Android crops).
    art_scale = 0.68 if maskable else 0.82
    art_size = int(canvas_size * art_scale)
    art = Image.new("RGBA", (art_size, art_size), (0, 0, 0, 0))
    ad = ImageDraw.Draw(art, "RGBA")

    # Stone body — an ellipse (wider than tall) so it reads as a curling stone.
    stone_w = int(art_size * 0.90)
    stone_h = int(art_size * 0.72)
    stone = radial_stone(stone_w).resize((stone_w, stone_h))
    stone_mask = Image.new("L", (stone_w, stone_h), 0)
    ImageDraw.Draw(stone_mask).ellipse([0, 0, stone_w, stone_h], fill=255)
    stone.putalpha(stone_mask)
    stone_x = (art_size - stone_w) // 2
    stone_y = int(art_size * 0.32)
    art.alpha_composite(stone, (stone_x, stone_y))

    # Highlight on the stone
    highlight = Image.new("RGBA", (art_size, art_size), (0, 0, 0, 0))
    hl_x0 = int(art_size * 0.20)
    hl_y0 = int(art_size * 0.38)
    hl_x1 = int(art_size * 0.52)
    hl_y1 = int(art_size * 0.48)
    ImageDraw.Draw(highlight).ellipse(
        [hl_x0, hl_y0, hl_x1, hl_y1],
        fill=(255, 255, 255, int(255 * 0.28)),
    )
    highlight = highlight.filter(ImageFilter.GaussianBlur(radius=max(1, art_size // 60)))
    art.alpha_composite(highlight)

    # Handle — orange bar and yellow top plate
    handle = Image.new("RGBA", (art_size, art_size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(handle)
    bar_w = int(art_size * 0.28)
    bar_h = int(art_size * 0.14)
    bar_x = (art_size - bar_w) // 2
    bar_y = int(art_size * 0.13)
    hd.rounded_rectangle(
        [bar_x, bar_y, bar_x + bar_w, bar_y + bar_h],
        radius=bar_h // 3,
        fill=(0xf5, 0x9e, 0x0b, 255),
    )
    plate_w = int(bar_w * 0.55)
    plate_h = int(bar_h * 0.60)
    plate_x = (art_size - plate_w) // 2
    plate_y = bar_y - int(plate_h * 0.35)
    hd.rounded_rectangle(
        [plate_x, plate_y, plate_x + plate_w, plate_y + plate_h],
        radius=plate_h // 3,
        fill=(0xfa, 0xcc, 0x15, 255),
    )
    art.alpha_composite(handle)

    # Base shadow under the stone
    shadow = Image.new("RGBA", (art_size, art_size), (0, 0, 0, 0))
    sh_x0 = int(art_size * 0.15)
    sh_y0 = int(art_size * 0.92)
    sh_x1 = int(art_size * 0.85)
    sh_y1 = int(art_size * 0.97)
    ImageDraw.Draw(shadow).ellipse(
        [sh_x0, sh_y0, sh_x1, sh_y1],
        fill=(0, 0, 0, int(255 * 0.25)),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=max(1, art_size // 50)))
    art.alpha_composite(shadow)

    # Centre the artwork on the canvas
    off = (canvas_size - art_size) // 2
    canvas.alpha_composite(art, (off, off))
    return canvas


def save_png(img: Image.Image, name: str) -> None:
    path = OUT_DIR / name
    img.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(REPO)} ({path.stat().st_size} bytes)")


def main() -> None:
    # Standard "any" icons
    save_png(render_icon(192), "icon-192.png")
    save_png(render_icon(512), "icon-512.png")
    # Maskable icons — extra safe-zone padding for Android adaptive crop
    save_png(render_icon(192, maskable=True), "icon-192-maskable.png")
    save_png(render_icon(512, maskable=True), "icon-512-maskable.png")
    # Apple touch icon — iOS uses this on Add to Home Screen
    save_png(render_icon(180), "apple-touch-icon-180.png")


if __name__ == "__main__":
    main()
