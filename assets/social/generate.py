#!/usr/bin/env python3
"""Generate Helicon's social assets (PFPs, headers, banners, OG) in light + dark.

Brand sources: apps/web/src/theme.css tokens (converted OKLCH -> sRGB),
DM Sans Bold for display, Inter + JetBrains Mono from @fontsource-variable
(vendored in fonts/), mark from helicon-logo-black.svg.

Requires: Pillow. System fonts are NOT used, so output is reproducible.
Run:  .venv/bin/python assets/social/generate.py   (from the repo root)
"""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
FONTS = os.path.join(HERE, "fonts")
DOCS_ASSETS = os.path.join(ROOT, "docs", "assets")
MARK_PNG = os.path.join(HERE, "helicon-mark-2048.png")
# Ink bbox of the mark master, px at 2048 (measured from the alpha channel).
MARK_INK = (602, 521, 1444, 1439)
SS = 2  # supersample factor; everything is drawn at 2x then downscaled

LIGHT = dict(
    bg="#FBFCFE", panel="#F2F4F7", card="#FFFFFF",
    fg="#13161B", muted="#4B5056", subtle="#5F646A",
    ring=(19, 22, 27, 30), blue="#0A6DDD",
)
DARK = dict(
    bg="#101113", panel="#0A0C0D", card="#181A1C",
    fg="#EFF0F2", muted="#AEB1B6", subtle="#8F9398",
    ring=(255, 255, 255, 26), blue="#4DA3FF",
)

DISPLAY_FONT = "DMSans-700.ttf"


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(os.path.join(FONTS, name), size * SS)


def mark_ink() -> Image.Image:
    """The mark cropped to its ink box (RGBA)."""
    if os.path.exists(MARK_PNG):
        return Image.open(MARK_PNG).crop(MARK_INK)
    # Fallback: the logo (blue on black) kept beside this script, as an alpha mask.
    logo = os.path.join(HERE, "logo-dark.png")
    im = Image.open(logo).convert("RGBA")
    alpha = im.convert("L").point(lambda v: min(255, v * 2) if v > 16 else 0)
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    layer.putalpha(alpha)
    bbox = layer.getbbox()
    assert bbox, "logo-dark.png has no ink"
    return layer.crop(bbox)


def tinted_mark(width: int, color: str) -> Image.Image:
    """Mark recolored to `color`, `width` css px wide (at SS scale)."""
    ink = mark_ink()
    w, h = ink.size
    target = (width * SS, round(width * SS * h / w))
    alpha = ink.getchannel("A").resize(target, Image.LANCZOS)
    layer = Image.new("RGBA", target, color)
    layer.putalpha(alpha)
    return layer


def canvas(w: int, h: int, bg: str) -> Image.Image:
    return Image.new("RGBA", (w * SS, h * SS), bg)


def downscale(img: Image.Image) -> Image.Image:
    return img.resize((img.size[0] // SS, img.size[1] // SS),
                      Image.LANCZOS).convert("RGB")


def finish(img: Image.Image, path: str) -> None:
    out = downscale(img)
    out.save(path)
    print("wrote", path, out.size)


def flat_ring(pal: dict) -> tuple[int, int, int]:
    """The translucent theme ring pre-blended over the card fill.

    Thin translucent strokes turn speckled when downscaled, so hairline
    rings are painted after downscaling with this flattened color.
    """
    r, g, b, a = pal["ring"]
    t = a / 255
    card = pal["card"]
    cr, cg, cb = (int(card[i:i + 2], 16) for i in (1, 3, 5))
    return (round(cr + (r - cr) * t), round(cg + (g - cg) * t),
            round(cb + (b - cb) * t))


def wrap(draw: ImageDraw.ImageDraw, s: str, fnt: ImageFont.FreeTypeFont,
         max_w: int) -> list[str]:
    words, lines, cur = s.split(" "), [], ""
    for wd in words:
        trial = f"{cur} {wd}".strip()
        if draw.textlength(trial, font=fnt) <= max_w * SS or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = wd
    if cur:
        lines.append(cur)
    return lines


def check_glyphs(chars: str, names: list[str]) -> None:
    """Fail loudly if any used char is missing from a vendored font.

    Skipped when fontTools is not installed (Pillow alone still generates).
    """
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        print("note: fontTools missing, skipping glyph coverage check")
        return
    for name in names:
        cmap = TTFont(os.path.join(FONTS, name)).getBestCmap()
        missing = sorted({c for c in chars if ord(c) not in cmap})
        assert not missing, f"{name} lacks {missing!r}"


TAGLINE = "Open-source desktop + web client for Muse Code."
README_TAGLINE = "Open-source desktop & web client for Muse Code."


def do_pfp(mode: str, pal: dict, size: int = 1024) -> Image.Image:
    img = canvas(size, size, pal["panel"])
    # Blue mark alone at 54% of the tile, centered; the corners stay well
    # inside X's circular crop (corner radius ~40% < 50%).
    mark = tinted_mark(round(size * 0.54), pal["blue"])
    img.alpha_composite(mark,
                        ((img.size[0] - mark.size[0]) // 2,
                         (img.size[1] - mark.size[1]) // 2))
    path = os.path.join(HERE, f"pfp-{size}-{mode}.png")
    finish(img, path)
    return Image.open(path)


def do_header(mode: str, pal: dict, w: int, h: int, name: str,
              mark_h: int, title_px: int, tag_px: int, pad: int) -> None:
    img = canvas(w, h, pal["bg"])
    d = ImageDraw.Draw(img)
    # Faint oversized mark bleeding off the right edge (flat, ~6% opacity).
    ink_w = MARK_INK[2] - MARK_INK[0]
    ink_h = MARK_INK[3] - MARK_INK[1]
    wm = tinted_mark(round(h * 1.9 * ink_w / ink_h), pal["fg"])
    alpha = wm.getchannel("A").point(lambda v: v * 16 // 255)
    wm.putalpha(alpha)
    img.alpha_composite(wm, (img.size[0] - wm.size[0] + round(0.35 * wm.size[0]),
                             (img.size[1] - wm.size[1]) // 2))
    # Left content block, vertically centered.
    mark = tinted_mark(
        round(mark_h * (MARK_INK[2] - MARK_INK[0]) / (MARK_INK[3] - MARK_INK[1])),
        pal["fg"])
    title_f = font(DISPLAY_FONT, title_px)
    tag_f = font("Inter-500.ttf", tag_px)
    title_bb = d.textbbox((0, 0), "Helicon", font=title_f, anchor="lt")
    title_h = title_bb[3] - title_bb[1]
    tag_bb = d.textbbox((0, 0), TAGLINE, font=tag_f, anchor="lt")
    tag_h = tag_bb[3] - tag_bb[1]
    gap = round(title_px * 0.28 * SS)
    row_h = max(mark.size[1], title_h)
    block_h = row_h + gap + tag_h
    top = (img.size[1] - block_h) // 2
    x = pad * SS
    img.alpha_composite(mark, (x, top + (row_h - mark.size[1]) // 2))
    tx = x + mark.size[0] + round(title_px * 0.32 * SS)
    d.text((tx, top + (row_h - title_h) // 2 - title_bb[1]), "Helicon",
           font=title_f, fill=pal["fg"], anchor="lt")
    ty = top + row_h + gap
    d.text((x, ty - tag_bb[1]), TAGLINE, font=tag_f, fill=pal["muted"],
           anchor="lt")
    finish(img, os.path.join(HERE, f"{name}-{mode}.png"))


def do_linkedin_company(mode: str, pal: dict) -> None:
    w, h, pad = 1128, 191, 64
    img = canvas(w, h, pal["bg"])
    d = ImageDraw.Draw(img)
    mark = tinted_mark(
        round(100 * (MARK_INK[2] - MARK_INK[0]) / (MARK_INK[3] - MARK_INK[1])),
        pal["fg"])
    title_f = font(DISPLAY_FONT, 62)
    tag_f = font("Inter-500.ttf", 24)
    title_bb = d.textbbox((0, 0), "Helicon", font=title_f, anchor="lt")
    tag_bb = d.textbbox((0, 0), TAGLINE, font=tag_f, anchor="lt")
    title_h = title_bb[3] - title_bb[1]
    tag_h = tag_bb[3] - tag_bb[1]
    gap = round(10 * SS)
    # Title + tagline form one text block; the mark is centered on the
    # whole block, then the lockup is centered in the canvas.
    text_h = title_h + gap + tag_h
    block_h = max(mark.size[1], text_h)
    mark_y = (block_h - mark.size[1]) // 2
    text_y = (block_h - text_h) // 2
    top = (img.size[1] - block_h) // 2
    x = pad * SS
    img.alpha_composite(mark, (x, top + mark_y))
    tx = x + mark.size[0] + round(26 * SS)
    d.text((tx, top + text_y - title_bb[1]), "Helicon", font=title_f,
           fill=pal["fg"], anchor="lt")
    d.text((tx, top + text_y + title_h + gap - tag_bb[1]), TAGLINE,
           font=tag_f, fill=pal["muted"], anchor="lt")
    finish(img, os.path.join(HERE, f"linkedin-company-{mode}.png"))


OG_HEADLINE = "Mission control for Muse Code."
OG_SUB = ("Every thread grouped by its project. Read, approve, and resume "
          "anything.")
OG_FEATURES = ("Sidebar-first threads", "Approvals, never bypassed",
               "Windows, macOS and web")
OG_FOOTER = ("Free & open source \u00b7 Unofficial community project \u00b7 "
             "github.com/HarjjotSinghh/helicon")


def do_og(mode: str, pal: dict) -> None:
    w, h, pad = 1200, 630, 84
    img = canvas(w, h, pal["bg"])
    d = ImageDraw.Draw(img)
    col_w = 636  # text column; card sits right of it
    x = pad * SS
    y = 72 * SS
    # Brand row.
    mark = tinted_mark(round(72 * (MARK_INK[2] - MARK_INK[0])
                             / (MARK_INK[3] - MARK_INK[1])), pal["fg"])
    img.alpha_composite(mark, (x, y))
    brand_f = font(DISPLAY_FONT, 52)
    brand_bb = d.textbbox((0, 0), "Helicon", font=brand_f, anchor="lt")
    d.text((x + mark.size[0] + round(20 * SS),
            y + (mark.size[1] - (brand_bb[3] - brand_bb[1])) // 2
            - brand_bb[1]),
           "Helicon", font=brand_f, fill=pal["fg"], anchor="lt")
    y += mark.size[1] + round(26 * SS)
    # Headline (Newsreader display, wraps to two lines).
    head_f = font(DISPLAY_FONT, 64)
    for line in wrap(d, OG_HEADLINE, head_f, col_w):
        bb = d.textbbox((0, 0), line, font=head_f, anchor="lt")
        d.text((x, y - bb[1]), line, font=head_f, fill=pal["fg"], anchor="lt")
        y += (bb[3] - bb[1]) + round(10 * SS)
    y += round(8 * SS)
    # Sub-line.
    sub_f = font("Inter-400.ttf", 27)
    for line in wrap(d, OG_SUB, sub_f, col_w):
        bb = d.textbbox((0, 0), line, font=sub_f, anchor="lt")
        d.text((x, y - bb[1]), line, font=sub_f, fill=pal["muted"],
               anchor="lt")
        y += (bb[3] - bb[1]) + round(9 * SS)
    y += round(12 * SS)
    # Feature list with blue square bullets.
    feat_f = font("Inter-500.ttf", 25)
    for feat in OG_FEATURES:
        bb = d.textbbox((0, 0), feat, font=feat_f, anchor="lt")
        sq = round(13 * SS)
        cy = y + (bb[3] - bb[1]) // 2
        d.rectangle([x, cy - sq // 2, x + sq, cy + sq // 2], fill=pal["blue"])
        d.text((x + sq + round(16 * SS), y - bb[1]), feat, font=feat_f,
               fill=pal["fg"], anchor="lt")
        y += (bb[3] - bb[1]) + round(13 * SS)
    # Footer (mono, must fit one line).
    foot_f = font("JBmono-500.ttf", 20)
    assert d.textlength(OG_FOOTER, font=foot_f) <= (w - 2 * pad) * SS, \
        "OG footer overflow"
    foot_bb = d.textbbox((0, 0), OG_FOOTER, font=foot_f, anchor="lt")
    d.text((x, (h - 40) * SS - (foot_bb[3] - foot_bb[1]) - foot_bb[1]),
           OG_FOOTER, font=foot_f, fill=pal["subtle"], anchor="lt")
    # Card panel with the mark, echoing an app card. The fill is
    # painted at supersample; the hairline ring goes on after downscaling
    # so it stays crisp instead of speckling.
    card = (808, 90, 1116, 540)
    card_box = [v * SS for v in card]
    d.rounded_rectangle(card_box, radius=round(24 * SS), fill=pal["card"])
    card_mark = tinted_mark(
        round((card[3] - card[1]) * 0.46 * (MARK_INK[2] - MARK_INK[0])
              / (MARK_INK[3] - MARK_INK[1])), pal["fg"])
    img.alpha_composite(card_mark,
                        ((card_box[0] + card_box[2] - card_mark.size[0]) // 2,
                         (card_box[1] + card_box[3] - card_mark.size[1]) // 2))
    out = downscale(img)
    ImageDraw.Draw(out).rounded_rectangle(card, radius=24,
                                          outline=flat_ring(pal), width=2)
    path = os.path.join(HERE, f"og-{mode}.png")
    out.save(path)
    print("wrote", path, out.size)


def do_readme_hero(mode: str, pal: dict) -> None:
    """Centered README banner: blue mark, Helicon, tagline. Half the old 800px height."""
    w, h = 1600, 400
    img = canvas(w, h, pal["bg"])
    d = ImageDraw.Draw(img)
    mark = tinted_mark(96, pal["blue"])
    title_f = font(DISPLAY_FONT, 72)
    tag_f = font("Inter-500.ttf", 28)
    title_bb = d.textbbox((0, 0), "Helicon", font=title_f, anchor="lt")
    tag_bb = d.textbbox((0, 0), README_TAGLINE, font=tag_f, anchor="lt")
    title_w = d.textlength("Helicon", font=title_f)
    tag_w = d.textlength(README_TAGLINE, font=tag_f)
    gap1, gap2 = round(18 * SS), round(12 * SS)
    block_h = (mark.size[1] + gap1 + (title_bb[3] - title_bb[1]) + gap2
               + (tag_bb[3] - tag_bb[1]))
    y = (img.size[1] - block_h) // 2
    cx = img.size[0] // 2
    img.alpha_composite(mark, ((img.size[0] - mark.size[0]) // 2, y))
    y += mark.size[1] + gap1
    d.text((cx - title_w // 2, y - title_bb[1]), "Helicon", font=title_f,
           fill=pal["fg"], anchor="lt")
    y += (title_bb[3] - title_bb[1]) + gap2
    d.text((cx - tag_w // 2, y - tag_bb[1]), README_TAGLINE, font=tag_f,
           fill=pal["muted"], anchor="lt")
    finish(img, os.path.join(DOCS_ASSETS, f"readme-hero-{mode}.png"))


ARTICLE_HEAD = ("Harness-locked,", "not terminal-locked.")
ARTICLE_SUB = ("Where the call originates decides what your users pay. "
               "Building a desktop client for Meta's Muse Code.")
# Route label, where it bills, and whether that is the good outcome.
ARTICLE_ROUTES = (
    ("Reimplement the agent loop", "API rates", False),
    ("Generic OpenAI-style client", "API rates", False),
    ("Drive muse serve over MSP", "your plan", True),
)


def do_x_article(mode: str, pal: dict) -> None:
    """5:2 banner for the X article: headline left, the billing routes right."""
    w, h, pad = 1500, 600, 80
    img = canvas(w, h, pal["bg"])
    d = ImageDraw.Draw(img)
    x = pad * SS
    y = round(84 * SS)

    mark_w = round(44 * (MARK_INK[2] - MARK_INK[0]) / (MARK_INK[3] - MARK_INK[1]))
    mark = tinted_mark(mark_w, pal["blue"])
    img.alpha_composite(mark, (x, y))
    brand_f = font(DISPLAY_FONT, 34)
    brand_bb = d.textbbox((0, 0), "Helicon", font=brand_f, anchor="lt")
    d.text((x + mark.size[0] + round(16 * SS),
            y + (mark.size[1] - (brand_bb[3] - brand_bb[1])) // 2 - brand_bb[1]),
           "Helicon", font=brand_f, fill=pal["fg"], anchor="lt")
    y += mark.size[1] + round(44 * SS)

    head_f = font(DISPLAY_FONT, 68)
    for line in ARTICLE_HEAD:
        bb = d.textbbox((0, 0), line, font=head_f, anchor="lt")
        d.text((x, y - bb[1]), line, font=head_f, fill=pal["fg"], anchor="lt")
        y += (bb[3] - bb[1]) + round(16 * SS)
    y += round(14 * SS)

    sub_f = font("Inter-400.ttf", 25)
    for line in wrap(d, ARTICLE_SUB, sub_f, 560):
        bb = d.textbbox((0, 0), line, font=sub_f, anchor="lt")
        d.text((x, y - bb[1]), line, font=sub_f, fill=pal["muted"], anchor="lt")
        y += (bb[3] - bb[1]) + round(10 * SS)

    # Right column: the three routes, with the one that keeps your plan in blue.
    # Ends well clear of the footer line, which sits at h - 56.
    card = (860, 92, 1420, 452)
    card_box = [v * SS for v in card]
    d.rounded_rectangle(card_box, radius=round(22 * SS), fill=pal["card"])
    label_f = font("Inter-500.ttf", 23)
    bill_f = font("JBmono-500.ttf", 19)
    rows_top = card[1] + 46
    row_h = (card[3] - card[1] - 76) / len(ARTICLE_ROUTES)
    for i, (route, bills, good) in enumerate(ARTICLE_ROUTES):
        ry = rows_top + row_h * i
        colour = pal["blue"] if good else pal["subtle"]
        sq = 11
        d.rectangle([(card[0] + 30) * SS, round((ry + 7) * SS),
                     (card[0] + 30 + sq) * SS, round((ry + 7 + sq) * SS)],
                    fill=colour)
        d.text(((card[0] + 30 + sq + 16) * SS, round(ry * SS)), route,
               font=label_f, fill=pal["fg"] if good else pal["muted"],
               anchor="la")
        d.text(((card[0] + 30 + sq + 16) * SS, round((ry + 34) * SS)), bills,
               font=bill_f, fill=colour, anchor="la")
        if i < len(ARTICLE_ROUTES) - 1:
            ly = round((ry + row_h - 22) * SS)
            d.line([(card[0] + 30) * SS, ly, (card[2] - 30) * SS, ly],
                   fill=flat_ring(pal), width=max(1, SS // 2))

    foot_f = font("JBmono-500.ttf", 19)
    foot = "helicon.sh · free & open source · unofficial, not affiliated with Meta"
    assert d.textlength(foot, font=foot_f) <= (w - 2 * pad) * SS, "banner footer overflow"
    foot_bb = d.textbbox((0, 0), foot, font=foot_f, anchor="lt")
    d.text((x, (h - 56) * SS - (foot_bb[3] - foot_bb[1]) - foot_bb[1]), foot,
           font=foot_f, fill=pal["subtle"], anchor="lt")

    out = downscale(img)
    ImageDraw.Draw(out).rounded_rectangle(card, radius=22,
                                          outline=flat_ring(pal), width=2)
    path = os.path.join(HERE, f"x-article-{mode}.png")
    out.save(path)
    print("wrote", path, out.size)


def main() -> None:
    readme_only = "--readme" in sys.argv
    needed = ([DISPLAY_FONT, "Inter-500.ttf"] if readme_only
              else ["Inter-400.ttf", "Inter-500.ttf", DISPLAY_FONT,
                    "JBmono-500.ttf"])
    for name in needed:
        assert os.path.exists(os.path.join(FONTS, name)), f"missing {name}"
    if not os.path.exists(MARK_PNG):
        logo = os.path.join(HERE, "logo-dark.png")
        assert os.path.exists(logo), "missing mark master and logo-dark.png"
    check_glyphs(
        README_TAGLINE + "Helicon" if readme_only else (
            TAGLINE + README_TAGLINE + "Helicon" + OG_HEADLINE + OG_SUB
            + "".join(OG_FEATURES) + OG_FOOTER
            + "".join(ARTICLE_HEAD) + ARTICLE_SUB
            + "".join(r + b for r, b, _ in ARTICLE_ROUTES)),
        needed,
    )
    for mode, pal in (("light", LIGHT), ("dark", DARK)):
        if readme_only:
            do_readme_hero(mode, pal)
            continue
        master = do_pfp(mode, pal, 1024)
        for size in (400, 300):
            small = master.resize((size, size), Image.LANCZOS)
            path = os.path.join(HERE, f"pfp-{size}-{mode}.png")
            small.save(path)
            print("wrote", path, small.size)
        do_header(mode, pal, 1500, 500, "x-header", 150, 118, 35, 120)
        do_header(mode, pal, 1584, 396, "linkedin-personal", 120, 92, 30, 110)
        do_linkedin_company(mode, pal)
        do_og(mode, pal)
        do_x_article(mode, pal)
        do_readme_hero(mode, pal)


if __name__ == "__main__":
    sys.exit(main())
