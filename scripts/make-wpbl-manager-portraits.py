#!/usr/bin/env python3
"""Cut the four WPBL managers out of the league's announcement graphics.

    python scripts/make-wpbl-manager-portraits.py            # all four
    python scripts/make-wpbl-manager-portraits.py weeks      # one, by substring

Writes 512x512 WebP with an alpha channel to src/wpbl/managers/<slug>.webp, which is what
wpblManagerPortrait() in src/wpbl/portraits.ts resolves and the awards ballot draws. A
hand-edit of those files is lost on the next run, same as the brand icons.

WHY THIS IS A SCRIPT AND NOT FOUR FILES SOMEBODY ONCE MADE. The league publishes a cut-out
headshot of every player and none of any manager, so these are cropped out of the two posts
that announced the benches. Boston has already changed managers once in a fifteen-game
season; when the next club does it, the work is a new row in MANAGERS rather than an
afternoon rediscovering how the first four were made.

THE FRAMING RULE IS THE POINT. Cropping each face to "looks about right" is what produced
the first version of these, and against a grid of roster headshots they were plainly wrong:
a manager's head filled his circle while the players beside him sat back in theirs. So the
frame is placed by measurement instead. Across 32 bundled roster portraits the league's own
art puts the eyes at .40 of the frame and the chin at .62, head centred, and this reproduces
that: EYE_Y, CHIN_Y and a scale factor per face. Nothing about the source crop matters
beyond containing the whole subject, because the matte makes everything outside them
transparent and the frame is composed afterwards.

THE LANDMARKS ARE TYPED IN, and that is not laziness. OpenCV's cascades find no face at all
on Henley, and on Williams (sunglasses) and Weeks (a profile under a batting helmet) they
report boxes that are not faces. Three numbers read off a gridded render are more reliable
than a detector that is confidently wrong, and they only have to be read once per manager.

Needs `rembg[cpu]`, which is not a project dependency: install it in a throwaway venv rather
than globally. The first run downloads its ONNX models (~400MB) to ~/.u2net.
"""

from __future__ import annotations

import sys
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen

import cv2
import numpy as np
from PIL import Image

try:
    from rembg import new_session, remove
except ImportError:  # pragma: no cover - the message is the whole point
    sys.exit("rembg is missing: python -m venv .venv && .venv/Scripts/pip install 'rembg[cpu]'")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "wpbl" / "managers"

SIZE = 512
EYE_Y, CHIN_Y = 0.40, 0.62      # the roster's own framing, measured. See the header.

# The league's two announcement graphics. Both are 1920x1080.
FOUNDING = ("https://www.womensprobaseballleague.com/wp-content/uploads/2026/07/260729-web-1.jpg",
            "Introducing the Managers, Jul 29 2026")
BOSTON = ("https://www.womensprobaseballleague.com/wp-content/uploads/2026/08/260809-cover.jpg",
          "Boston names Jemile Weeks, Aug 9 2026")

# slug, source, region to matte, (eye y, chin y, head centre x) in SOURCE pixels, models.
#
# THE REGION HAS TO HOLD THE WHOLE PERSON, TOP AND SIDES, and that is the one part of this
# table that is easy to get wrong quietly. Everything outside it is cut away by definition, so
# a region that starts below a batting helmet does not crop the helmet, it DELETES the top of
# it and leaves a flat edge that reads as a haircut. Weeks started at y=150 and did exactly
# that. The sides are the same: a shoulder past the edge becomes a straight vertical cut.
#
# THE BOTTOM IS THE EXCEPTION, and it is deliberate. Both graphics run a title across the
# subject's chest, so there is no more of them to keep: the region stops above the lettering
# (the matte reads "eks" from "Jemile Weeks" as foreground and welds it to his jersey, since
# they touch) and `extend_bottom` carries the last row down instead. It also stops short of
# the diagonal into the next manager's panel.
#
# ONE MODEL EXCEPT FOR WEEKS. `isnet-general-use` reads his green batting helmet as
# background and shaves it off, leaving a manager with no hat on; `u2net_human_seg` keeps it
# and is looser elsewhere, so his alpha is the union of the two.
MANAGERS = [
    ("matt-williams",  FOUNDING, (  60, 0,  620, 650), (254, 429,  314), ["isnet-general-use"]),
    ("rocky-henley",   FOUNDING, ( 540, 0, 1060, 650), (267, 432,  800), ["isnet-general-use"]),
    ("eric-young-sr",  FOUNDING, (1430, 0, 1900, 650), (242, 380, 1665), ["isnet-general-use"]),
    ("jemile-weeks",   BOSTON,   ( 980, 0, 1660, 700), (340, 512, 1309),
     ["isnet-general-use", "u2net_human_seg"]),
]

_sessions: dict[str, object] = {}
_sources: dict[str, Image.Image] = {}


def source(src) -> Image.Image:
    url, _ = src
    if url not in _sources:
        req = Request(url, headers={"User-Agent": "sportydolphin.fun/manager-portraits"})
        with urlopen(req, timeout=60) as r:
            _sources[url] = Image.open(BytesIO(r.read())).convert("RGB")
    return _sources[url]


def matte(im: Image.Image, models: list[str]) -> np.ndarray:
    """The subject's alpha: the union of each model's, minus the specks."""
    alpha = None
    for m in models:
        if m not in _sessions:
            _sessions[m] = new_session(m)
        a = np.array(remove(im, session=_sessions[m]))[:, :, 3]
        alpha = a if alpha is None else np.maximum(alpha, a)
    # A blur or a bright cloud can come back as its own island. Anything under 1% of the
    # region is not a person, and dropping it is safer than trusting the largest blob: a
    # cap brim can be a separate component from the face under it.
    hard = (alpha > 16).astype("uint8")
    count, labels, stats, _ = cv2.connectedComponentsWithStats(hard, 8)
    keep = np.zeros_like(hard)
    for k in range(1, count):
        if stats[k, cv2.CC_STAT_AREA] > 0.01 * hard.size:
            keep[labels == k] = 1
    # One pixel of feather. The models hand back a hard edge, which against a flat club
    # colour reads as a sticker.
    return cv2.GaussianBlur((alpha * keep).astype("uint8"), (3, 3), 0)


def extend_bottom(rgba: Image.Image) -> Image.Image:
    """Carry the last row of the subject down, where the graphic cut her off.

    A manager whose chest is behind the graphic's title ends at the region's bottom edge in a
    straight horizontal line. Framed to the roster's rule that edge lands ABOVE the frame's own
    bottom, so she reads as a bust sawn off in mid-air, with club colour under her. The roster
    headshots all run off the bottom of their frame, which is what this reproduces: the pixels
    added are the shirt she is already wearing, and the circle the portrait is drawn in crops
    most of them anyway.

    Only where she was actually truncated. A subject whose whole outline is inside the region
    has no opaque pixels on that last row and nothing is added.
    """
    a = np.array(rgba)
    if (a[-1, :, 3] > 128).sum() == 0:
        return rgba
    # Half the region again is more than the frame can ever show below the cut, so this cannot
    # come up short at any scale the framing rule picks.
    pad = np.repeat(a[-1:, :, :], a.shape[0] // 2, axis=0)
    pad[:, :, 3] = np.where(pad[:, :, 3] > 128, 255, 0)
    return Image.fromarray(np.vstack([a, pad]), "RGBA")


def portrait(region: tuple, marks: tuple, im: Image.Image, models: list[str]) -> Image.Image:
    eye, chin, cx = marks
    cut = im.crop(region)
    rgba = extend_bottom(Image.fromarray(
        np.dstack([np.array(cut), matte(cut, models)]).astype("uint8"), "RGBA"))

    scale = (CHIN_Y - EYE_Y) * SIZE / (chin - eye)          # source px -> frame px
    scaled = rgba.resize((round(rgba.width * scale), round(rgba.height * scale)), Image.LANCZOS)
    # Where the region's own origin lands, once the face is where the rule wants it.
    x = round((region[0] - (cx - 0.5 * SIZE / scale)) * scale)
    y = round((region[1] - (eye - EYE_Y * SIZE / scale)) * scale)

    frame = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    frame.alpha_composite(scaled, (x, y))
    return frame


def main() -> None:
    only = [a.lower() for a in sys.argv[1:]]
    OUT.mkdir(parents=True, exist_ok=True)
    for slug, src, region, marks, models in MANAGERS:
        if only and not any(a in slug for a in only):
            continue
        art = portrait(region, marks, source(src), models)
        path = OUT / f"{slug}.webp"
        art.save(path, "WEBP", quality=82, method=6)
        rows = np.where(np.array(art)[:, :, 3] > 16)[0]
        print(f"{slug:<15} {path.stat().st_size // 1024:>3} KB  "
              f"subject {rows.min() / SIZE:.2f}..{rows.max() / SIZE:.2f} of frame  ({src[1]})")


if __name__ == "__main__":
    main()
