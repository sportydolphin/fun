#!/usr/bin/env python3
"""prepare-fan-photos.py: the local, credential-free first pass of the fan-photo ingest.

    python scripts/prepare-fan-photos.py                 # process the drop folder into staging
    python scripts/prepare-fan-photos.py --force         # re-render even shots already staged
    python scripts/prepare-fan-photos.py --drop DIR --out DIR

Reads a drop folder of fan-submitted photographs and writes a staging folder plus a
manifest.json that scripts/ingest-fan-photos.mjs uploads to R2 and inserts (approved = false).
See docs/FAN_PHOTOS.md for the whole argument; the short version of why this half exists:

  - It holds NO credentials. The pixel work should not sit on the same footing as a
    service-role key, and splitting the passes is what keeps it off this machine's disk.
  - Pillow, like every other image script here (make-brand-icons, make-wpbl-share-cards,
    make-wpbl-portrait-thumbs). Adding `sharp` to do what Pillow already does is the wrong
    trade for a project with ten runtime dependencies.

WHAT IT DOES PER PHOTO
  - Hashes the ORIGINAL bytes (sha256). This is what makes the ingest idempotent and collapses
    two fans sending the same shot into one row, so it is the original file that is hashed, not
    a render (a render is not byte-stable across Pillow versions).
  - STRIPS ALL EXIF. This is not tidiness. A phone photograph carries GPS coordinates and a
    device identifier belonging to the fan who took it, and neither is ours to republish.
    Re-encoding to webp already drops EXIF; converting to RGB and saving with no `exif=`
    argument makes that explicit rather than incidental. Orientation is applied to the pixels
    first (exif_transpose) so a portrait phone shot is upright once its EXIF is gone.
  - Emits the two webp renders the site serves: a card and a larger lightbox render. Their
    dimensions (shared aspect ratio) go in the manifest, because we make the renders here and
    the number that reserves layout space should be the number actually served.
  - Reads EXIF DateTimeOriginal as a SEED for taken_on. A phone photo from this season is
    trustworthy here; the curator still settles it in the review UI.

DROP FOLDER LAYOUT. One subfolder per contributor, because the permission record is per person
and a photo without a recorded grant must not proceed ("a permission nobody can produce later
is not one"). A subfolder with no contributor.json is skipped with a message, as is any loose
file in the drop root.

    <drop>/
      <contributor-slug>/
        contributor.json        # display_name, contact, permission_granted_on,
                                 #   permission_evidence, permission_scope
        beach-day.jpg
        beach-day.note.txt       # optional: the fan's note to the curator
        dugout.jpg

WHAT THE MANIFEST DOES NOT CARRY. Subjects (who is in the photo) and the published caption come
from the review UI, not from here: this pass cannot know a face, and the curator's caption is
the thing being reviewed. The manifest carries only what the CLI actually knows: the bytes, the
renders, the EXIF seed, the contributor, the permission evidence and the fan's note.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DROP = ROOT / "scripts" / "fan-photos-drop"
DEFAULT_OUT = ROOT / "scripts" / "fan-photos-staging"

# The two renders the site serves. Card is what a strip or gallery tile draws (retina-friendly
# at the sizes those surfaces use); full is the lightbox. Neither upscales: a small original
# stays its own size rather than being blown up into a soft render.
CARD_MAX = 800
FULL_MAX = 1600
WEBP_QUALITY = 82

# Pillow reads these without an extra dependency. HEIC (the iPhone default) needs pillow-heif
# and is deliberately not pulled in: it is reported as skipped with a note to export as JPEG,
# rather than silently dropped.
READABLE = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".gif"}

# The keys a contributor.json must carry. display_name and permission_evidence are the two that
# are load-bearing: the credit shown on every card, and the record that the grant can be
# produced later. The rest are optional and pass through.
CONTRIBUTOR_REQUIRED = ("display_name", "permission_evidence")
CONTRIBUTOR_KEYS = (
    "display_name", "contact", "permission_granted_on", "permission_evidence", "permission_scope",
)


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def exif_taken_on(im: Image.Image) -> str | None:
    """DateTimeOriginal as YYYY-MM-DD, or None. A seed the curator settles, never the last word."""
    try:
        exif = im.getexif()
    except Exception:
        return None
    # 36867 = DateTimeOriginal, 306 = DateTime (fallback). EXIF spells it "YYYY:MM:DD HH:MM:SS".
    raw = exif.get(36867) or exif.get(306)
    if not raw or not isinstance(raw, str):
        return None
    try:
        return datetime.strptime(raw.strip()[:10], "%Y:%m:%d").date().isoformat()
    except ValueError:
        return None


def render(im: Image.Image, max_side: int, dest: Path) -> tuple[int, int]:
    """Write one webp render, scaled so its longest side is at most max_side, never upscaled.
    Returns the render's (width, height). Saved with NO exif argument, so the strip is total."""
    w, h = im.size
    scale = min(1.0, max_side / max(w, h))
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    out = im if size == im.size else im.resize(size, Image.LANCZOS)
    out.save(dest, "WEBP", quality=WEBP_QUALITY, method=6)
    return out.size


def load_contributor(folder: Path) -> tuple[dict | None, str | None]:
    """Return (contributor dict, error). A folder with no readable, complete record is skipped."""
    meta = folder / "contributor.json"
    if not meta.exists():
        return None, "no contributor.json (the permission record is mandatory)"
    try:
        data = json.loads(meta.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        return None, f"contributor.json is unreadable: {e}"
    missing = [k for k in CONTRIBUTOR_REQUIRED if not str(data.get(k, "")).strip()]
    if missing:
        return None, f"contributor.json missing {', '.join(missing)}"
    return {k: data.get(k) for k in CONTRIBUTOR_KEYS if data.get(k) not in (None, "")}, None


def main() -> int:
    ap = argparse.ArgumentParser(description="Prepare fan photos into a staging folder + manifest.")
    ap.add_argument("--drop", type=Path, default=DEFAULT_DROP, help="input folder of submissions")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="staging output folder")
    ap.add_argument("--force", action="store_true", help="re-render shots already staged")
    args = ap.parse_args()

    drop: Path = args.drop
    out: Path = args.out
    if not drop.exists():
        print(f"Drop folder does not exist: {drop}\n"
              f"Create it and add one subfolder per contributor (see the header).")
        return 1

    out.mkdir(parents=True, exist_ok=True)

    photos: list[dict] = []
    seen: dict[str, str] = {}   # sha256 -> first source path, to collapse duplicate submissions
    built = skipped = 0
    skips: list[str] = []

    # One subfolder per contributor. A loose file in the drop root has no permission record, so
    # it is reported rather than guessed at.
    loose = [p for p in sorted(drop.iterdir()) if p.is_file()]
    for p in loose:
        skips.append(f"{p.name}: loose file, not inside a contributor folder")

    for folder in sorted(d for d in drop.iterdir() if d.is_dir()):
        contributor, err = load_contributor(folder)
        if err:
            skips.append(f"{folder.name}/: {err}")
            continue
        credit = str(contributor["display_name"]).strip()

        for src in sorted(folder.iterdir()):
            if not src.is_file() or src.name == "contributor.json" or src.suffixes[-1:] == [".txt"]:
                continue
            if src.suffix.lower() not in READABLE:
                skips.append(f"{folder.name}/{src.name}: unsupported type "
                             f"(export HEIC as JPEG)" if src.suffix.lower() in {".heic", ".heif"}
                             else f"{folder.name}/{src.name}: unsupported type {src.suffix}")
                continue

            digest = sha256_of(src)
            rel = f"{folder.name}/{src.name}"
            if digest in seen:
                skips.append(f"{rel}: same bytes as {seen[digest]}, already staged")
                continue
            seen[digest] = rel

            card_file = out / f"{digest}_card.webp"
            full_file = out / f"{digest}_full.webp"
            if not args.force and card_file.exists() and full_file.exists():
                # Already rendered in a previous run; still record it in the manifest.
                with Image.open(full_file) as fim:
                    fw, fh = fim.size
                taken = None
                skipped += 1
            else:
                try:
                    with Image.open(src) as im:
                        taken = exif_taken_on(im)
                        upright = ImageOps.exif_transpose(im).convert("RGB")
                        render(upright, CARD_MAX, card_file)
                        fw, fh = render(upright, FULL_MAX, full_file)
                except Exception as e:  # a corrupt or truncated submission should not stop the batch
                    skips.append(f"{rel}: could not read image ({e})")
                    seen.pop(digest, None)
                    continue
                built += 1

            note_path = folder / (src.stem + ".note.txt")
            note = note_path.read_text(encoding="utf-8").strip() if note_path.exists() else None

            photos.append({
                "source": rel,
                "sha256": digest,
                # Content-addressed R2 prefix: re-uploading the same shot overwrites rather than
                # orphaning. The two renders live at <storage_path>/card.webp and /full.webp.
                "storage_path": digest,
                "card_file": card_file.name,
                "full_file": full_file.name,
                "width": fw,
                "height": fh,
                "taken_on": taken,
                "note": note or None,
                "contributor": contributor,
            })

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "card_max": CARD_MAX,
        "full_max": FULL_MAX,
        "photos": photos,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n{len(photos)} photo(s) in the manifest: {built} rendered, {skipped} already staged.")
    if skips:
        print(f"{len(skips)} skipped:")
        for s in skips:
            print(f"   • {s}")
    print(f"\nStaging: {out}")
    print("Next: scripts/ingest-fan-photos.mjs uploads the renders to R2 and inserts the rows "
          "(approved = false).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
