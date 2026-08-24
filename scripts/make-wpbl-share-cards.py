"""Generate the 1200x630 share cards behind og:image on WPBL player pages.

A manual design task, not part of the build or any cron job, exactly like
make-brand-icons.py. Run it when the roster changes, when someone changes club, or
when the art changes, then commit whatever it rewrites.

    pip install Pillow fonttools brotli
    python scripts/make-wpbl-share-cards.py            # every player
    python scripts/make-wpbl-share-cards.py jamie-mackay   # one, while designing

WHY THIS EXISTS. og:image used to be the bundled headshot, which is 512x512, and
functions/wpbl/index.ts asked for it to be shown as a small square thumbnail by setting
twitter:card to "summary". That works on the platforms that read twitter: tags. Bluesky
reads og: only, and drops whatever it is given into one banner slot at roughly 1.91:1, so
a square headshot arrived centre-cropped to the middle 52% of itself: cap clipped, chest
gone. Handing every unfurler an image already at 1200x630 removes the decision from the
platform, which is the only way to fix it for the ones that never asked us.

WHY THE STATS ARE NOT ON IT. The card is a file on disk; the stat line is
og:description, rewritten per request at the edge from live data. Painting ".400/.471"
into the art would freeze a number that changes every night and go stale within a day.
The art carries only what is true for as long as the player is on that roster.

SOURCE OF TRUTH. Team colours are read out of src/wpbl/constants.ts rather than copied
here, because a colour that disagrees with the site is worse than no card. The roster
comes from the same Supabase the site reads, using the anon key from .env.
"""

import json
import os
import re
import sys
import unicodedata
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PORTRAITS = ROOT / "src" / "wpbl" / "portraits"
LOGOS = ROOT / "src" / "wpbl" / "logos"
OUT = ROOT / "src" / "wpbl" / "cards"
CONSTANTS = ROOT / "src" / "wpbl" / "constants.ts"
FONT = ROOT / "scripts" / "fonts" / "InterVariable-full.woff2"

W, H = 1200, 630          # 1.905:1, the shape every large-image card crops to
PAD = 72                  # left margin, and the floor under the footer
SS = 2                    # supersampling, so the logo watermark and the rules stay clean


# ─── Inputs ─────────────────────────────────────────────────────────────────


def slugify(name: str) -> str:
    """The Python twin of slugifyName in src/wpbl/slug.ts.

    It has to agree with that file character for character: the edge function names
    og:image from the TypeScript version, and this script names the file from this one.
    A disagreement is a 404 on the card and a link preview with no image at all.
    """
    stripped = "".join(
        c for c in unicodedata.normalize("NFKD", name) if not unicodedata.combining(c)
    )
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", stripped.lower()))


def env(name: str) -> str:
    """A value from the process, or from .env, which is where this repo keeps them."""
    if os.environ.get(name):
        return os.environ[name]
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        key, _, value = line.partition("=")
        if key.strip() == name:
            return value.strip().strip("'\"")
    raise SystemExit(f"{name} is not set, and .env does not carry it.")


def supabase(query: str) -> list:
    url = f"{env('VITE_SUPABASE_URL').rstrip('/')}/rest/v1/{query}"
    key = env("VITE_SUPABASE_ANON_KEY")
    req = Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urlopen(req, timeout=30) as res:
        return json.loads(res.read())


def team_meta() -> dict:
    """Colours and names, parsed out of the WPBL_TEAMS block in constants.ts.

    Parsed rather than duplicated. The alternative is a second copy of four hex values
    that nothing keeps in step with the site, so the day a club restyles, every share
    card quietly keeps the old identity while every page shows the new one.
    """
    source = CONSTANTS.read_text(encoding="utf-8")
    # The logo imports, so the watermark reads the same file the site does instead of a
    # second mapping of club to filename.
    files = dict(re.findall(r"import\s+(\w+)\s+from\s+'\./logos/([\w.-]+)'", source))
    out = {}
    for entry in re.finditer(r"\{([^{}]*\bcolor:[^{}]*)\}", source):
        body = entry.group(1)
        field = lambda key: (re.search(rf"\b{key}:\s*'([^']*)'", body) or [None, None])[1]
        tid, color = field("id"), field("color")
        if not tid or not color:
            continue
        out[tid] = {
            "city": field("city"),
            "name": field("name"),
            "color": color,
            "secondary": field("secondary"),
            "logo_file": files.get((re.search(r"\blogo:\s*(\w+)", body) or [None, ""])[1], ""),
            # Boston's mark is a finished lockup with its own opaque background, so it
            # cannot be ghosted: tinting it by its alpha paints a solid rectangle across
            # the plate. Those clubs get no watermark rather than a green box.
            "logo_fill": bool(re.search(r"\blogoFill:\s*true", body)),
        }
    if len(out) < 4:
        raise SystemExit(
            f"Only parsed {len(out)} teams out of constants.ts. The WPBL_TEAMS block "
            "changed shape; fix the pattern above rather than hardcoding colours."
        )
    return out


def font_faces():
    """Inter, from the same file the site serves, at the weights this card uses.

    The repo keeps Inter as woff2, which FreeType will not open, so it is converted in
    memory. Nothing is written: committing a .ttf next to it would be a second copy of
    the typeface to keep in step.
    """
    from fontTools.ttLib import TTFont

    buf = BytesIO()
    src = TTFont(str(FONT))
    src.flavor = None
    src.save(buf)

    def face(size: int, weight: int):
        buf.seek(0)
        f = ImageFont.truetype(BytesIO(buf.read()), size * SS)
        # Axis order is (opsz, wght). Optical size is pinned at its display end: these
        # are headline sizes, and Inter's text-optical shapes look soft blown up.
        f.set_variation_by_axes([32.0, float(weight)])
        return f

    return face


# ─── Colour ─────────────────────────────────────────────────────────────────


def rgb(hex_value: str) -> tuple:
    h = hex_value.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def mix(a: tuple, b: tuple, t: float) -> tuple:
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def luminance(c: tuple) -> float:
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255


def plate(color: tuple, secondary: tuple) -> Image.Image:
    """The background: the club's colour, lifted enough to read as a colour.

    Los Angeles is #000000. Painted literally, its card is a black rectangle that reads
    as a broken image rather than as a design, so every plate is floored at a luminance
    where the eye can still see it is deliberate. The lift is toward the club's own
    secondary, not toward grey, so a lifted plate still looks like that club.
    """
    base = color
    for _ in range(24):
        if luminance(base) >= 0.045:
            break
        base = mix(base, secondary, 0.08)
    base = mix(base, (0, 0, 0), 0.12)

    im = Image.new("RGB", (W * SS, H * SS), base)
    # A soft diagonal wash so the plate is not flat under the cutout. Drawn as a coarse
    # vertical ramp and blurred by the downscale at the end; a per-pixel gradient at 2x
    # costs a second per card for a difference nobody can see.
    top = mix(base, secondary, 0.16)
    draw = ImageDraw.Draw(im)
    steps = 96
    for i in range(steps):
        t = i / (steps - 1)
        y0 = round(H * SS * i / steps)
        y1 = round(H * SS * (i + 1) / steps) + 1
        draw.rectangle([0, y0, W * SS, y1], fill=mix(top, base, t ** 0.65))
    return im


# ─── The card ───────────────────────────────────────────────────────────────


def watermark(im: Image.Image, team: dict, secondary: tuple) -> None:
    """The club mark, ghosted behind the player.

    The logos are transparent knockouts (see constants.ts), so they are recoloured to the
    club's secondary and dropped to a tenth opacity: at full strength the mark competes
    with the face, which is the one thing on the card a reader is meant to recognise.
    """
    logo_path = LOGOS / team["logo_file"]
    if team["logo_fill"] or not team["logo_file"] or not logo_path.exists():
        return
    logo = Image.open(logo_path).convert("RGBA")
    size = round(470 * SS)
    logo = logo.resize((size, size), Image.LANCZOS)
    tint = Image.new("RGBA", logo.size, secondary + (255,))
    tint.putalpha(logo.split()[-1].point(lambda a: round(a * 0.10)))
    im.paste(tint, (round(-70 * SS), round(180 * SS)), tint)


TILE = 470          # the photo panel, right of the text
TILE_RADIUS = 30


def photo(im: Image.Image, portrait_path: Path) -> None:
    """The headshot, as a white tile on the plate.

    A TILE RATHER THAN A CUT-OUT FIGURE BLEEDING OFF THE EDGE, which is the better-looking
    design and cannot be used: only 53 of the 118 bundled headshots are cut out. The other
    65 are the same photograph on an opaque white studio background, and pasted as a
    free-standing figure they land on the plate as a white rectangle with a player in it.
    Backing every portrait with white instead gives one design the whole roster can wear,
    and the cut-out ones lose nothing by it: they were shot on the same white.

    Scaled by the FILE'S FRAME, not by the alpha bounding box, which is the version that
    looks wrong and is right. Every headshot is a 512 square from the same smart crop, so
    the frame is what holds the heads at a common size; a few are cut with less torso and
    a bbox as short as 434, and fitting the bbox enlarged exactly those, which put Maïka
    Dumais a third bigger than her team-mates.
    """
    size = round(TILE * SS)
    art = Image.open(portrait_path).convert("RGBA")
    tile = Image.new("RGBA", art.size, (255, 255, 255, 255))
    tile.alpha_composite(art)
    tile = tile.resize((size, size), Image.LANCZOS)

    x, y = round((W - PAD - TILE) * SS), round(((H - TILE) // 2) * SS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=TILE_RADIUS * SS, fill=255)

    # A shadow under the tile, so it sits on the plate instead of being a hole cut in it.
    # Drawn as a stack of fading rounded rectangles rather than a Gaussian blur: the blur
    # of a 940px layer is most of this script's runtime and the difference is invisible.
    shadow = ImageDraw.Draw(im)
    for i in range(10, 0, -1):
        shade = mix(im.getpixel((x - 40 * SS, y)), (0, 0, 0), 0.04)
        shadow.rounded_rectangle(
            [x - i * SS, y - i * SS + 4 * SS, x + size + i * SS, y + size + i * SS + 4 * SS],
            radius=(TILE_RADIUS + i) * SS, fill=shade,
        )
    im.paste(tile, (x, y), mask)


def wrap(text: str, face, limit: int) -> list:
    """Greedy wrap to `limit` pixels. Long names exist and must not run off the plate."""
    words, lines, line = text.split(), [], ""
    for word in words:
        trial = f"{line} {word}".strip()
        if face.getlength(trial) <= limit or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def card(player: dict, team: dict, face, out_path: Path) -> None:
    color, secondary = rgb(team["color"]), rgb(team["secondary"])
    im = plate(color, secondary)
    watermark(im, team, secondary)
    photo(im, PORTRAITS / f"{player['slug']}.webp")

    draw = ImageDraw.Draw(im)
    # The text column stops short of the tile. A name that runs under the photo is not
    # clipped, it is drawn UNDER it and simply disappears, which is the kind of failure
    # nobody sees until a long name ships.
    limit = round((W - PAD - TILE - PAD - 24) * SS)

    name_face = face(66, 700)
    lines = wrap(player["name"], name_face, limit)
    if len(lines) > 2 or name_face.getlength(max(lines, key=len)) > limit:
        name_face = face(52, 700)
        lines = wrap(player["name"], name_face, limit)

    # Laid out from the bottom up, so the footer keeps its margin and a two-line name
    # grows upward into the empty top of the plate instead of pushing anything off.
    footer_face = face(26, 500)
    meta_face = face(34, 600)
    y = H * SS - PAD * SS - round(footer_face.size)
    draw.text((PAD * SS, y), "sportydolphin.fun", font=footer_face, fill=mix(color, (255, 255, 255), 0.62))

    y -= round(46 * SS)
    meta = " · ".join(x for x in [player.get("position"), team["full"]] if x)
    draw.text((PAD * SS, y - meta_face.size), meta, font=meta_face, fill=(235, 238, 245))

    y -= round(30 * SS)
    for line in reversed(lines):
        y -= round(name_face.size * 1.16)
        draw.text((PAD * SS, y), line, font=name_face, fill=(255, 255, 255))

    # The club's colour as a rule above the name, which is the only place the secondary
    # is used at full strength: as text it fails contrast on two of the four plates.
    y -= round(30 * SS)
    draw.rectangle([PAD * SS, y - round(8 * SS), PAD * SS + round(72 * SS), y], fill=secondary)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    im.resize((W, H), Image.LANCZOS).save(out_path, "WEBP", quality=88, method=6)


# ─── Run ────────────────────────────────────────────────────────────────────


def main() -> None:
    only = {a for a in sys.argv[1:]}
    teams = team_meta()
    face = font_faces()

    rows = supabase("wpbl_players?select=name,position,team_id")
    # A player's club here is "now", which is the right answer for art regenerated when
    # the roster moves, and the reason this script is in the trade checklist rather than
    # in the build: a card left alone after a trade shows the old club forever.
    by_slug = {}
    for row in rows:
        by_slug.setdefault(slugify(row["name"]), row)

    made, skipped = 0, []
    for portrait in sorted(PORTRAITS.glob("*.webp")):
        slug = portrait.stem
        if only and slug not in only:
            continue
        row = by_slug.get(slug)
        team = teams.get((row or {}).get("team_id") or "")
        if not row or not team:
            skipped.append(slug)
            continue
        card(
            {"slug": slug, "name": row["name"], "position": row.get("position")},
            {**team, "full": f"{team['city']} {team['name']}"},
            face,
            OUT / f"{slug}.webp",
        )
        made += 1

    print(f"wrote {made} cards to {OUT.relative_to(ROOT)}")
    if skipped:
        # Named rather than counted: a portrait with no roster row is a player who has
        # left, or a slug that has drifted from the DB spelling, and both want a look.
        print(f"no roster row for {len(skipped)}: {', '.join(skipped)}")


if __name__ == "__main__":
    main()
