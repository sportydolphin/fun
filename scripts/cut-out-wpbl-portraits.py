#!/usr/bin/env python3
"""Key the white studio background out of the bundled roster headshots, in place.

    python scripts/cut-out-wpbl-portraits.py            # every file that still needs it
    python scripts/cut-out-wpbl-portraits.py --check    # name them, change nothing
    python scripts/cut-out-wpbl-portraits.py hastings   # one, by substring

WHY THIS EXISTS. `PlayerPortrait` fills its circle with the club's primary colour and draws
the headshot over it, which is the whole design: a roster reads as four clubs rather than as
118 photographs. 53 of the bundled portraits are the league's own cut-outs and get that. The
other 65 are the same photograph with the studio's white left opaque, so they landed as a
white disc inside a club-coloured ring, and a player whose club had never published a cut-out
of her was the only one on the page wearing no colour. Nothing about that is visible to a
type checker or a test that only counts files, which is why it sat there for months.

IN PLACE, AND THE FILE IS ITS OWN SOURCE. This is the opposite of make-wpbl-manager-portraits,
which rebuilds its output from a published graphic every run: there is no upstream to re-fetch
here, the 512 square IS the original, and git is the only copy of what went in. So the pass is
idempotent by construction (a file that already carries alpha is skipped, not re-keyed) and
`--check` exists to see the list before anything is written.

WHY A THRESHOLD AND NOT rembg. A segmentation model is the right tool when the background is a
scene, which is what the manager script is up against. These are seamless white, and against
seamless white a threshold is both better and honest: it cuts exactly the pixels that are the
paper and nothing else, where a model happily shaves off a pale cap or half a blonde ponytail
and gives no sign it did. The two rules below are what make it safe on a white UNIFORM, which
is the case that would otherwise eat somebody's jersey.

RUN IT WHEN A NEW HEADSHOT LANDS. `src/wpbl/__tests__/portraitAlpha.test.ts` fails on any
bundled portrait with no alpha channel, so a white-backed file cannot reach main unnoticed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PORTRAITS = ROOT / "src" / "wpbl" / "portraits"

# The two ends of the ramp, in min(R, G, B).
#
# HI IS "THE PAPER", and it is deliberately high. Every one of these was shot on a blown-out
# white that sits at 255 across the frame, so the only pixels between HI and pure white are the
# anti-aliased edge of the subject. Lowering it to catch a dull background would start catching
# the bright side of a white jersey, which is the one mistake this script must not make.
#
# LO IS WHERE A PIXEL IS TAKEN AS SOLIDLY THE SUBJECT. The gap between them is the whole of the
# soft edge: a strand of hair at 235 keeps about half its opacity instead of being posterised
# into or out of the cut.
HI, LO = 246, 224


def alpha(im: Image.Image) -> np.ndarray:
    """The subject's alpha for a headshot shot on white."""
    v = np.array(im.convert("RGB")).astype(np.int16).min(axis=2)

    # RULE ONE: THE BACKGROUND HAS TO REACH THE TOP OF THE FRAME. Whiteness alone would take a
    # white cap, a white jersey and the whites of somebody's eyes with it. The studio paper is
    # one connected region that always touches the top edge (and, on these crops, the upper
    # sides); a garment is an island inside the subject, however bright it is. Sydney Barry's
    # white cap and the several white uniforms in the roster survive on this rule alone.
    n, label = cv2.connectedComponents((v >= HI).astype(np.uint8), 4)
    h = label.shape[0]
    edge = set(np.unique(label[0])) | set(np.unique(label[: h // 3, 0])) | set(np.unique(label[: h // 3, -1]))
    edge.discard(0)
    bg = np.isin(label, list(edge))

    # RULE TWO: THE RAMP IS APPLIED ONLY BESIDE THE CUT. A pixel at 240 in the middle of a
    # jersey is cotton catching the light and must stay solid; the same value one pixel outside
    # the subject's outline is paper bleeding through the anti-aliasing and must not. Dilating
    # the background by three pixels is what tells those two apart, and it also eats into the
    # white fringe the original encoder left, which against a club colour would otherwise read
    # as a sticker cut out with scissors.
    band = cv2.dilate(bg.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    ramp = np.clip((v - LO) / (HI - LO), 0, 1)
    a = np.where(bg, 0.0, np.where(band, 1 - ramp, 1.0))

    # One pixel of feather, for the reason the manager script gives: a hard edge on a flat
    # colour reads as a cut-out and not as a photograph.
    return (cv2.GaussianBlur(a.astype(np.float32), (3, 3), 0) * 255).astype(np.uint8)


def keyed(path: Path) -> bool:
    """True when this file already carries a cut-out, so the pass has nothing to do."""
    a = np.array(Image.open(path).convert("RGBA"))[:, :, 3]
    return bool(a[0, 0] < 200 and a[0, -1] < 200)


def main() -> None:
    args = [a.lower() for a in sys.argv[1:]]
    check = "--check" in args
    only = [a for a in args if not a.startswith("--")]

    done = skipped = 0
    for path in sorted(PORTRAITS.glob("*.webp")):
        if only and not any(a in path.stem for a in only):
            continue
        if keyed(path):
            skipped += 1
            continue
        im = Image.open(path)
        a = alpha(im)
        # Under a tenth of the frame left standing means the cut ate the player, which is what
        # happens the day the league changes studios and the "white" comes back at 230. Louder
        # than a quiet bad file, since the only way to see one of those is to open the page.
        kept = a.mean() / 255
        if kept < 0.10:
            raise SystemExit(f"{path.stem}: only {kept:.0%} of the frame survived the cut. "
                             "That background is not the usual seamless white; check it by eye.")
        print(f"{path.stem:<32} {'would key' if check else 'keyed'}  subject {kept:.0%} of frame")
        if not check:
            out = Image.fromarray(np.dstack([np.array(im.convert("RGB")), a]), "RGBA")
            out.save(path, "WEBP", quality=82, method=6)
        done += 1

    verb = "to key" if check else "keyed"
    print(f"\n{done} {verb}, {skipped} already cut out.")


if __name__ == "__main__":
    main()
