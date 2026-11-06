#!/usr/bin/env python3
"""Build every bundled WPBL headshot from its source, framed by one rule.

    python scripts/frame-wpbl-portraits.py                 # measure new sources, build, write the manifest
    python scripts/frame-wpbl-portraits.py --check         # report what would change, write nothing
    python scripts/frame-wpbl-portraits.py --force         # re-encode every 512, changed or not
    python scripts/frame-wpbl-portraits.py --sheet a.png   # also draw a contact sheet with each face box

Reads art/wpbl-portraits/<slug>.webp (the photo as it came in, already cut out) and
art/wpbl-portraits/manifest.json, and writes src/wpbl/portraits/<slug>.webp plus, through
make-wpbl-portrait-thumbs.py, its 128 copy. Generated art: a hand-edit of a file in
src/wpbl/portraits is lost on the next run. Change the source or the manifest instead.

WHY. Until Nov 2026 the 512s were cropped once, by hand-run face detection, from whatever photo
the league had, and nothing kept the rule. The roster's faces came from three shoots (the
league's studio day in club uniform, the draft day in a black tee, and a dozen college, national
team and ID photos), so beside each other on Home one face filled its square and the next sat
small with a band of empty color over the cap. The frame draws each file whole, so the only fix
is the file, and the only lasting fix is a rule every new photo goes through.

THE RULE: the face box's center and width at fixed fractions of the frame (RULE below, the
medians of the studio shoot, which is the look the rest is brought to). The scale is clamped,
because a photo that needs more than that is a photo we should replace rather than stretch.

THE MANIFEST is the record a person reviews, keyed by slug:
  box       the face box measured on the source, [center x, center y, width] as fractions
  box_set   a box set by hand, which outranks `box` (the detector misses, or picks a cap)
  kit       what the player wears in the photo: "club", "draft" (the WPBL tee) or "other"
  kit_club  for "club", the club in the photo when it is not obvious from the roster
  note      anything a person should know before replacing the photo
  source_sha, scale, frame, issues   written by this script, read by the test
  build     a digest of everything the 512 was built from, so an unchanged one is not re-encoded
`issues` is what the rule could not fix, and portraitFraming.test.ts holds the list, so a new
photo with a problem fails CI rather than landing quietly on Home.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "art" / "wpbl-portraits"
MANIFEST = SOURCES / "manifest.json"
OUT = ROOT / "src" / "wpbl" / "portraits"
SIZE = 512
QUALITY = 86

# Where the face box lands, as fractions of the frame. Kept in step with portraitFraming.test.ts.
RULE = {"cx": 0.5, "cy": 0.46, "w": 0.41}
# Past these the photo is being bent to fit rather than framed. Above 1.25 the source holds less
# detail than the frame shows (an upscale reads soft beside the studio shots); below 0.8 the face
# was so large in the source that shrinking it opens a band of empty color under the shoulders.
SCALE_MIN, SCALE_MAX = 0.8, 1.25

# The issues the script can find. The test reads the names.
#   no-face     no box measured or set, so the photo was copied unframed
#   upscaled    scaled past 1.12, so the 512 is softer than the source's own pixels
#   clamped     the scale hit a limit, so the face is not at the rule's size
#   gap-under   the subject stops above the bottom edge: a head without shoulders
#   cut-top     the subject runs into the top edge: a cap or hair cut by the frame
#   fringe      a light edge left by the white key, which shows against a dark club color
#   held        kept larger than the rule, since shrinking it would lift the shoulders (see frame)
UPSCALE = 1.12
GAP_COVER = 0.55     # share of the bottom row the subject must cover
TOUCH_COVER = 0.08   # share of the bottom row that means the subject runs off the bottom edge
TOP_COVER = 0.12     # share of the top row the subject may cover
FRINGE_PX = 3000     # light half-transparent pixels, on a 512 scale
CY_MAX = 0.50        # how far down a face may move to keep the shoulders on the bottom edge


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


# Three of OpenCV's bundled frontal-face models, each with the factor that brings its box to a
# common size. `default` draws its box about 12% wider than the two `alt` models (measured on this
# roster, Nov 2026), so taking whichever model answered first made one face 12% smaller than the
# next for no reason in the photo. No downloaded model: these ship inside opencv-python.
CASCADES = [(cv2.CascadeClassifier(cv2.data.haarcascades + n), k) for n, k in (
    ("haarcascade_frontalface_alt2.xml", 1.0),
    ("haarcascade_frontalface_alt.xml", 1.0),
    ("haarcascade_frontalface_default.xml", 0.89),
)]


def measure(im: Image.Image) -> list[float] | None:
    """The face box on a source, or None. A start for a person to check, not the truth, which is
    what `box_set` is for.

    BY AGREEMENT. Each model alone sometimes boxes the chin and neck as a second face, or a cap
    and face together as one big one. Every box from every model is grouped by where it sits, and
    the group the most models agree on is the face: a stray box is one model's mistake, and the
    other two rarely make the same one."""
    rgb = np.array(im.convert("RGB"))
    a = np.array(im)[:, :, 3]
    # Detect on the photo over mid gray, not over the black a transparent pixel decodes to, which
    # puts a hard edge around the hair that the models read as the side of a face.
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    gray = (gray * (a / 255) + 128 * (1 - a / 255)).astype(np.uint8)
    W = im.width
    boxes = []
    for model, k in CASCADES:
        for x, y, w, h in model.detectMultiScale(gray, 1.03, 3, minSize=(W // 5, W // 5)):
            boxes.append(((x + w / 2) / W, (y + h / 2) / W, w * k / W))
    if not boxes:
        return None
    groups: list[list[tuple[float, float, float]]] = []
    for b in boxes:
        for g in groups:
            if abs(g[0][0] - b[0]) < 0.08 and abs(g[0][1] - b[1]) < 0.08:
                g.append(b)
                break
        else:
            groups.append([b])
    # Most support first; on a tie the higher box, since the false one is the chin below the face.
    best = min(groups, key=lambda g: (-len(g), float(np.median([b[1] for b in g]))))
    return [round(float(np.median([b[i] for b in best])), 4) for i in range(3)]


def fringe(im: Image.Image) -> int:
    a = np.array(im.convert("RGBA")).astype(int)
    semi = (a[..., 3] > 20) & (a[..., 3] < 230)
    light = a[..., :3].min(axis=2) > 200
    # Counted on the frame's scale, so a larger source does not read as a worse key.
    return int((semi & light).sum() * (SIZE / im.width) ** 2)


def frame(im: Image.Image, box: list[float] | None) -> tuple[Image.Image, float, list[float] | None, list[str]]:
    """Scale and place the source so its face box lands on RULE. Returns the 512, the scale
    against a 512 source, the face box in the output, and what the rule could not fix."""
    issues: list[str] = []
    src = im.convert("RGBA")
    if box is None:
        return src.resize((SIZE, SIZE), Image.LANCZOS), 1.0, None, ["no-face"]
    cx, cy, w = box
    s = RULE["w"] / w
    if not SCALE_MIN <= s <= SCALE_MAX:
        issues.append("clamped")
        s = min(max(s, SCALE_MIN), SCALE_MAX)
    # Source pixels per output pixel, in 512 terms, so "upscaled" means the same thing whatever
    # size the source is.
    px = s * SIZE / src.width
    if px > UPSCALE:
        issues.append("upscaled")
    # THE SHOULDERS STAY ON THE BOTTOM EDGE. Most sources run the jersey off the bottom of the
    # frame, so shrinking one face even 3% to the rule's size lifts the shoulders and leaves a strip
    # of bare club color under them, which reads far worse than a face a little large. So when a
    # shrink would open that strip, the face first moves down (to CY_MAX) to keep the jersey on the
    # edge, and past that the scale stops shrinking: the face stays larger than the rule ("held").
    #
    # A NECK COUNTS. Any subject that touches the bottom edge is held there, not only a full pair
    # of shoulders: a source cut at the chin (Ayuri Shimano, Olivia Bricker) is an ordinary crop
    # while the cut is the frame's edge, and a floating head with a flat bottom once the rule lifts
    # it into the square. Until Nov 5, 2026 this asked for GAP_COVER, and both floated.
    a_src = np.array(src)[:, :, 3]
    reaches_bottom = (a_src[-2:, :] > 128).any(axis=0).mean() >= TOUCH_COVER
    want_cy = RULE["cy"]
    if reaches_bottom and want_cy + s * (1 - cy) < 1:
        want_cy = min(1 - s * (1 - cy), CY_MAX)
        if want_cy + s * (1 - cy) < 1:
            # Never past the source's own size: a face that sits low in a tight source would
            # otherwise be zoomed further in to keep its jersey down, the opposite of the fix.
            s_need = (1 - want_cy) / (1 - cy)
            s, want_cy = (s_need, want_cy) if s_need <= 1 else (1.0, cy)
            issues = [i for i in issues if i != "clamped"] + ["held"]
        px = s * SIZE / src.width
        issues = [i for i in issues if i != "upscaled"] + (["upscaled"] if px > UPSCALE else [])
    side = round(SIZE * s)  # the source square, drawn at this scale
    scaled = src.resize((side, side), Image.LANCZOS)
    ox = round(RULE["cx"] * SIZE - cx * side)
    # Rounded up, so the half pixel that rounding can lose is never a one-pixel strip under the jersey.
    oy = int(np.ceil(want_cy * SIZE - cy * side))
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    # A plain paste, not a masked one: onto a transparent canvas the source's own alpha is the
    # answer, where a mask would multiply it by itself and thin every soft edge. Paste also clips
    # whatever falls outside the frame, which is most of a zoomed-in source.
    out.paste(scaled, (ox, oy))
    a = np.array(out)[:, :, 3]
    if (a[-2:, :] > 128).any(axis=0).mean() < GAP_COVER:
        issues.append("gap-under")
    if (a[:2, :] > 128).any(axis=0).mean() > TOP_COVER:
        issues.append("cut-top")
    placed = [round((ox + cx * side) / SIZE, 4), round((oy + cy * side) / SIZE, 4), round(w * side / SIZE, 4)]
    return out, round(px, 3), placed, issues


def draft_kit(im: Image.Image) -> bool:
    """The WPBL draft-day tee is near-black across the bottom of the frame. A first guess at
    `kit` for a new entry; a person corrects it in the manifest."""
    a = np.array(im.convert("RGBA").resize((SIZE, SIZE))).astype(int)
    band = a[420:]
    op = band[..., 3] > 200
    return bool(op.any() and (band[..., :3].mean(axis=2)[op] < 70).mean() > 0.6)


def main() -> None:
    args = sys.argv[1:]
    check = "--check" in args
    force = "--force" in args
    sheet = Path(args[args.index("--sheet") + 1]) if "--sheet" in args else None

    manifest = json.loads(MANIFEST.read_text("utf-8")) if MANIFEST.exists() else {}
    players: dict = manifest.get("players", {})
    sources = sorted(SOURCES.glob("*.webp"))
    built = []
    for path in sources:
        slug = path.stem
        im = Image.open(path).convert("RGBA")
        e = players.setdefault(slug, {})
        digest = sha(path)
        # Measure once per source: a new photo is measured, an unchanged one keeps its box, so a
        # rerun never moves a face a person has already looked at.
        if e.get("source_sha") != digest or "box" not in e:
            e["box"] = measure(im)
        e.setdefault("kit", "draft" if draft_kit(im) else "club")
        out, px, placed, issues = frame(im, e.get("box_set") or e.get("box"))
        if fringe(im) > FRINGE_PX:
            issues.append("fringe")
        e.update(source_sha=digest, scale=px, frame=placed, issues=sorted(issues))
        built.append((slug, out, e))
        # Everything the 512 depends on. The encode is about 4s a file at method 6, so a rerun
        # after adding one player writes one file, not 118.
        key = hashlib.sha256(json.dumps(
            [digest, e.get("box_set") or e.get("box"), RULE, SCALE_MIN, SCALE_MAX, CY_MAX, TOUCH_COVER, SIZE, QUALITY]
        ).encode()).hexdigest()[:16]
        dest = OUT / f"{slug}.webp"
        if not check and (e.get("build") != key or not dest.exists() or force):
            out.save(dest, "WEBP", quality=QUALITY, method=6)
            e["build"] = key

    # A manifest entry with no source is a player whose photo was removed on purpose.
    gone = [s for s in players if not (SOURCES / f"{s}.webp").exists()]
    for s in gone:
        del players[s]
    if not check:
        for stale in OUT.glob("*.webp"):
            if not (SOURCES / stale.name).exists():
                stale.unlink()
                print(f"removed {stale.relative_to(ROOT)} (no source)")

    manifest = {"rule": RULE, "players": {k: players[k] for k in sorted(players)}}
    if not check:
        # A box on one line, so a person reading or diffing the file sees a face per few lines.
        text = re.sub(r"\[\s+([^\[\]]*?)\s+\]", lambda m: "[" + re.sub(r"\s+", " ", m.group(1)) + "]",
                      json.dumps(manifest, indent=1, ensure_ascii=False))
        MANIFEST.write_text(text + "\n", "utf-8")
        subprocess.run([sys.executable, str(ROOT / "scripts" / "make-wpbl-portrait-thumbs.py")], check=True)

    with_issues = [(s, e["issues"]) for s, _, e in built if e["issues"]]
    print(f"{len(built)} framed{' (check only)' if check else ''}, {len(with_issues)} with issues:")
    for s, i in with_issues:
        print(f"  {s:<28} {', '.join(i)}")

    if sheet:
        draw_sheet(built, sheet)


def draw_sheet(built, path: Path) -> None:
    """Every face on one gray, with its box: the page a person reads to check the manifest."""
    cell, cols = 128, 12
    rows = -(-len(built) // cols)
    img = Image.new("RGB", (cols * cell, rows * (cell + 14)), (235, 235, 235))
    d = ImageDraw.Draw(img)
    for i, (slug, out, e) in enumerate(built):
        x0, y0 = (i % cols) * cell, (i // cols) * (cell + 14)
        bg = Image.new("RGBA", (SIZE, SIZE), (70, 70, 80, 255))
        bg.alpha_composite(out)
        img.paste(bg.convert("RGB").resize((cell, cell), Image.LANCZOS), (x0, y0))
        if e.get("frame"):
            cx, cy, w = (v * cell for v in e["frame"])
            d.rectangle([x0 + cx - w / 2, y0 + cy - w / 2, x0 + cx + w / 2, y0 + cy + w / 2],
                        outline=(255, 210, 0) if not e.get("box_set") else (0, 220, 255))
        mark = "!" if e["issues"] else ""
        d.text((x0 + 2, y0 + cell + 1), f"{i} {slug[:17]}{mark}", fill=(0, 0, 0))
    img.save(path)


if __name__ == "__main__":
    main()
