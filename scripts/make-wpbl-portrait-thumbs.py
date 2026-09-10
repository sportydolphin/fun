#!/usr/bin/env python3
"""Build the 128px copy of every bundled headshot, for the sizes they are actually drawn at.

    python scripts/make-wpbl-portrait-thumbs.py            # both folders, only what is missing
    python scripts/make-wpbl-portrait-thumbs.py --force    # rebuild every one

Writes src/wpbl/portraits/thumbs/<slug>.webp and src/wpbl/managers/thumbs/<slug>.webp, which
`wpblPortraitSet` in src/wpbl/portraits.ts hands to PlayerPortrait as the small half of a
`srcset`. Generated art: a hand-edit is lost on the next run, same as the brand icons.

WHY. The bundled headshots are 512 squares, and almost nothing draws them near that: a table
row is 32px, a ballot tile 46, the biggest on the site is the player page's 84. A browser
decodes the file it is given at its natural size, so a 512 square is a megabyte of bitmap
whatever it is painted into, and the fan-award sheet mounts thirty of them at once over a Home
page already holding thirty more. That is tens of megabytes of decoded image to keep, scale and
re-raster on every repaint, for pictures of a face at a size a 128 square covers twice over.

WHY NOT JUST SHRINK THE SOURCE. The 512s are the source for the 1200x630 share cards, where the
photo panel alone is 940px after supersampling (see make-wpbl-share-cards.py), and they are the
only copy of that art we have. So this is a second, smaller rendition rather than a replacement,
and `srcset` is what lets one component ask for the right one: the browser picks by the space
the image is given and the screen it is on, which is a decision no component can make for it.

128 AND NOT 96 OR 64. The player page draws an 84px portrait, the desktop chrome scale takes
that to 118, and a 2x screen wants 236 device pixels for it: past 128 the browser reaches for
the 512 and should. 128 is the size that covers every OTHER surface at 2x with nothing to
spare and nothing wasted.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FOLDERS = [ROOT / "src" / "wpbl" / "portraits", ROOT / "src" / "wpbl" / "managers"]
SIZE = 128


def main() -> None:
    force = "--force" in sys.argv
    built = skipped = 0
    for folder in FOLDERS:
        out = folder / "thumbs"
        out.mkdir(exist_ok=True)
        for src in sorted(folder.glob("*.webp")):
            dest = out / src.name
            # Only when the source is newer, so a rerun after adding one player is instant.
            if not force and dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime:
                skipped += 1
                continue
            im = Image.open(src).convert("RGBA")
            # LANCZOS and the alpha kept: these are cut-outs, and a thumb that lost its
            # transparency would draw a white square inside the club-coloured ring, which is
            # the exact bug the cut-out pass exists to fix.
            im.resize((SIZE, SIZE), Image.LANCZOS).save(dest, "WEBP", quality=82, method=6)
            built += 1
        # A thumb whose source is gone is a file nothing can reach and a name that will confuse
        # the next person to look. The sources are the roster, so this follows a deletion.
        for stale in sorted(out.glob("*.webp")):
            if not (folder / stale.name).exists():
                stale.unlink()
                print(f"removed {stale.relative_to(ROOT)} (no source)")

    total = sum(len(list((f / 'thumbs').glob('*.webp'))) for f in FOLDERS)
    kb = sum(p.stat().st_size for f in FOLDERS for p in (f / 'thumbs').glob('*.webp')) // 1024
    print(f"{built} built, {skipped} already current. {total} thumbs, {kb} KB total.")


if __name__ == "__main__":
    main()
