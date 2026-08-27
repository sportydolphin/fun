"""Regenerate the brand icons in public/ from the logo master.

This is a manual design task, not part of the build or any cron job: run it after
the logo art changes, then commit whatever it rewrites.

    pip install Pillow
    python scripts/make-brand-icons.py

Source of truth is public/logo.png, the 2000x2000 master. Every file below is derived
from it, so the mark only ever has to be redrawn in one place. public/icon.svg is one
of the outputs: it is generated, not hand-written.

The art is a black plate with the dolphin knocked out of it, so it disappears against
a dark tile. The large tiles invert it (white plate, dark dolphin) and set it on the
navy that also serves as theme_color and background_color, which is the same move the
header makes in dark mode.

What each family is for:

  icon-<n>.png           purpose "any": shown as-is, so the mark can run most of the
                         tile's width.
  icon-maskable-<n>.png  purpose "maskable": the launcher may crop this to a circle of
                         80% of the tile, so the mark has to fit that circle. A 1.96:1
                         rectangle inscribed in a circle of diameter 0.8*S is only
                         0.70*S wide, which is why this one looks smaller. That is not
                         a mistake; it is what keeps Android from clipping the fin.
  apple-touch-icon.png   iOS, which will not read an SVG here.
  favicon.ico, icon.svg  the tab strip and Google's results, both around 16px, where
                         the lockup cannot survive and a zoomed dolphin is used instead.
  og-cover.png           the social card.
  play-feature-graphic.png
                         the 1024x500 banner on the Play Store listing. Not served to
                         anyone by the site; it lives here so it regenerates with the
                         rest of the set when the logo changes.
  badge-96.png           the Android notification badge, a stencil cut from the alpha.
"""

from base64 import b64encode
from io import BytesIO

from PIL import Image, ImageDraw, ImageFilter, ImageOps

NAVY = (15, 23, 42, 255)          # #0f172a: theme_color, background_color, the dark shell
BLACK = (0, 0, 0, 255)            # the Play feature graphic only, which is not a shell surface
MASTER = "public/logo.png"
OUT = "public/"


SS = 4                            # supersampling used to antialias the drawn plate corners


def flatten(im: Image.Image) -> Image.Image:
    """The master over white, which is the paper it was drawn on."""
    flat = Image.new("RGB", im.size, (255, 255, 255))
    flat.paste(im, mask=im.split()[-1])
    return flat


def silhouette(im: Image.Image) -> Image.Image:
    """The mark's own alpha: everything the plate covers, and nothing outside it.

    Neither of the two obvious shortcuts works on this art. The master's alpha channel is
    empty north and south of the plate but opaque white east and west of it, so it does
    not say where the art stops. Flooding the white background in from a corner leaks:
    the bat runs off the top edge of the plate, and through that gap the flood reaches
    every white pixel of the dolphin and eats the whole design.

    So the plate is redrawn instead. It is a rounded rectangle, and both the box and the
    corner radius can be read off the art: the box is the bounding box of the dark ink,
    and any point on a corner arc pins the radius, since a circle inset by `i` at depth
    `d` into the corner has r = i + d + sqrt(2*i*d). Sampling down the arc and taking the
    median shrugs off the antialiased first few rows. Drawn at 4x and scaled down so the
    corners come out smooth rather than as stairsteps.
    """
    dark = flatten(im).convert("L").point(lambda v: 255 if v < 128 else 0)
    x0, y0, x1, y1 = dark.getbbox()
    px = dark.load()

    radii = []
    for depth in range(8, (y1 - y0) // 4):
        x = x0
        while x < x1 and px[x, y0 + depth] == 0:
            x += 1
        inset = x - x0
        if inset:
            radii.append(inset + depth + (2 * inset * depth) ** 0.5)
    radius = sorted(radii)[len(radii) // 2] if radii else 0

    mask = Image.new("L", ((x1 - x0) * SS, (y1 - y0) * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, mask.width - 1, mask.height - 1), radius=round(radius * SS), fill=255)
    plate = Image.new("L", im.size, 0)
    plate.paste(mask.resize((x1 - x0, y1 - y0), Image.LANCZOS), (x0, y0))
    return plate


def mark() -> Image.Image:
    """The logo cropped to the plate and inverted, ready to sit on a dark tile."""
    im = Image.open(MASTER).convert("RGBA")
    alpha = silhouette(im)
    r, g, b = flatten(im).split()
    inverted = Image.merge("RGBA", (ImageOps.invert(r), ImageOps.invert(g), ImageOps.invert(b), alpha))
    return inverted.crop(alpha.getbbox())


def detail(size: int = 48, zoom: float = 0.88) -> Image.Image:
    """A square tile zoomed into the dolphin, for icon slots too small for the lockup.

    The plate's black is recoloured to the shell navy rather than left at #000, which
    makes the tile continuous with the rest of the icon set and lets the crop run wider
    than the plate: anything past its edge is the same navy, so the seam does not show.
    """
    im = Image.open(MASTER).convert("RGBA")
    x0, y0, x1, y1 = silhouette(im).getbbox()
    ink = flatten(im).convert("L")
    navy = Image.new("RGB", im.size, NAVY[:3])
    recoloured = Image.composite(Image.new("RGB", im.size, (255, 255, 255)), navy, ink)

    half = round((y1 - y0) / 2 / zoom)
    cx, cy = (x0 + x1) // 2 + round((x1 - x0) * 0.03), (y0 + y1) // 2
    square = Image.new("RGB", (half * 2, half * 2), NAVY[:3])
    box = (max(cx - half, x0), max(cy - half, y0), min(cx + half, x1), min(cy + half, y1))
    square.paste(recoloured.crop(box), (box[0] - (cx - half), box[1] - (cy - half)))
    return square.resize((size, size), Image.LANCZOS)


def tile(size: int, art: Image.Image, width_frac: float) -> Image.Image:
    """`art` centered on an opaque navy square of `size`, `width_frac` of it wide."""
    w = round(size * width_frac)
    h = round(w * art.height / art.width)
    out = Image.new("RGBA", (size, size), NAVY)
    out.alpha_composite(art.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2))
    return out


def main() -> None:
    art = mark()

    for size in (192, 512):
        tile(size, art, 0.88).save(f"{OUT}icon-{size}.png")
        tile(size, art, 0.68).save(f"{OUT}icon-maskable-{size}.png")

    # iOS ignores rel="apple-touch-icon" unless it points at a raster, and it will not
    # read the SVG: without this file a saved-to-home-screen tile is a screenshot of the
    # page. iOS rounds the corners itself and never crops as hard as a maskable circle.
    tile(180, art, 0.82).convert("RGB").save(f"{OUT}apple-touch-icon.png")

    # Google's search results read the favicon, and its crawler wants a raster at a
    # multiple of 48px. Modern browsers still prefer the SVG, declared first in index.html.
    #
    # This one is the dolphin rather than the whole lockup. The mark is nearly 2:1, so a
    # square tile of it is a bar a couple of pixels tall once the row is 16px high, and at
    # that size it turns to mush: nothing survives but a grey smudge, in the tab strip and
    # in a Google result alike. Zooming into the plate keeps the dolphin legible, and the
    # plate's own black reads as the tile, so the art is uncropped brand rather than a
    # shrunken one.
    detail().save(f"{OUT}favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    # The same detail as a scalable icon, for browsers that prefer the SVG over the .ico.
    # It is a wrapper around a raster rather than real vector art, so it buys nothing at
    # small sizes; it exists so a browser that picks the SVG shows the same dolphin as one
    # that picks the .ico, instead of the two tabs disagreeing about what the site's icon
    # is. 256px, because every visitor downloads this: the tab strip asks for 16 to 32,
    # a bookmark tile for maybe 128, and base64 costs a third on top of the file.
    buf = BytesIO()
    detail(256).save(buf, format="PNG")
    data = b64encode(buf.getvalue()).decode()
    with open(f"{OUT}icon.svg", "w", encoding="utf-8") as f:
        f.write(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">\n'
            "  <!-- Generated by scripts/make-brand-icons.py from public/logo.png. Do not hand-edit:\n"
            "       the next run of that script overwrites this file. -->\n"
            f'  <image width="512" height="512" href="data:image/png;base64,{data}"/>\n'
            "</svg>\n"
        )

    # The social card: 1200x630 is what Open Graph and Twitter both size for.
    card = Image.new("RGBA", (1200, 630), NAVY)
    w = 840
    h = round(w * art.height / art.width)
    card.alpha_composite(art.resize((w, h), Image.LANCZOS), ((1200 - w) // 2, (630 - h) // 2))
    card.convert("RGB").save(f"{OUT}og-cover.png")

    # The Play Store feature graphic. 1024x500 is fixed by Google and the format must be
    # JPEG or 24-bit PNG with NO alpha, which is why this one is flattened to RGB rather
    # than saved like the tiles. It is wider than the social card (2.05:1 against 1.90:1),
    # so the lockup is held to 64% of the width: Play crops this asset differently across
    # surfaces and overlays a play button on its centre wherever a promo video exists, and
    # anything run to the edges is what gets eaten. The ground is black rather than the
    # shell navy because this one is never seen next to the app: it sits in Play's own
    # chrome, where the navy reads as a washed-out rectangle rather than as our colour.
    feature = Image.new("RGBA", (1024, 500), BLACK)
    w = round(1024 * 0.64)
    h = round(w * art.height / art.width)
    feature.alpha_composite(art.resize((w, h), Image.LANCZOS), ((1024 - w) // 2, (500 - h) // 2))
    feature.convert("RGB").save(f"{OUT}play-feature-graphic.png")

    # The notification badge is flattened to a stencil by the OS, which reads the alpha
    # channel and throws the colours away, so the plate has to drop out and leave only
    # the dolphin. In the original art the dolphin is the white ink, so luminance is the
    # alpha we want. The silhouette is eroded first: the plate's antialiased rim runs
    # from black to white, and left in, that gradient traces a bright outline of the
    # whole plate and the stencil comes out as a box rather than a dolphin.
    src = Image.open(MASTER).convert("RGBA")
    inside = silhouette(src).point(lambda v: 255 if v > 250 else 0).filter(ImageFilter.MinFilter(9))
    alpha = Image.composite(flatten(src).convert("L"), Image.new("L", src.size, 0), inside)
    ink = Image.merge("RGBA", (Image.new("L", src.size, 255),) * 3 + (alpha,)).crop(alpha.getbbox())
    square = Image.new("RGBA", (max(ink.size),) * 2, (0, 0, 0, 0))
    square.alpha_composite(ink, ((square.width - ink.width) // 2, (square.height - ink.height) // 2))
    square.resize((96, 96), Image.LANCZOS).save(f"{OUT}badge-96.png")

    print("wrote icons to", OUT)


if __name__ == "__main__":
    main()
